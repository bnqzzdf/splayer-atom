use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use alsa::pcm::State;
use anyhow::{bail, ensure, Context, Result};
use tracing::warn;

use super::device::AlsaHwEndpoint;
use super::format::{pack_direct_pcm, AlsaPcmFormat};
use super::output::{open_pcm_hw, AlsaPcmConfig};
use super::writer::AlsaFrameWriter;
use crate::direct_pcm::{
    DirectPcmBoundary, DirectPcmConsumer, DirectPcmFormat, DirectPcmLease, DirectPcmPoll,
    DirectPcmSampleFormat, DirectPcmSource, DirectPcmStageHandle,
};

const SOURCE_POLL_INTERVAL: Duration = Duration::from_millis(1);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
const PACK_QUEUE_DEPTH: usize = 4;

struct AlsaDirectPcmState {
    submitted_frames: AtomicU64,
    played_frames: AtomicU64,
    track_base_frame: AtomicU64,
    duration_micros: AtomicU64,
    transition_count: AtomicU64,
    boundary_generation: AtomicU64,
    playing: AtomicBool,
    finished: AtomicBool,
    source_failed: AtomicBool,
    output_failed: AtomicBool,
    stopped: AtomicBool,
}

impl AlsaDirectPcmState {
    fn new(duration_secs: f64) -> Self {
        Self {
            submitted_frames: AtomicU64::new(0),
            played_frames: AtomicU64::new(0),
            track_base_frame: AtomicU64::new(0),
            duration_micros: AtomicU64::new(duration_to_micros(duration_secs)),
            transition_count: AtomicU64::new(0),
            boundary_generation: AtomicU64::new(0),
            playing: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            source_failed: AtomicBool::new(false),
            output_failed: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
        }
    }

    fn reset_timeline(&self, duration_secs: f64) {
        self.submitted_frames.store(0, Ordering::Release);
        self.played_frames.store(0, Ordering::Release);
        self.track_base_frame.store(0, Ordering::Release);
        self.duration_micros
            .store(duration_to_micros(duration_secs), Ordering::Release);
        self.transition_count.store(0, Ordering::Release);
        self.boundary_generation.store(0, Ordering::Release);
        self.finished.store(false, Ordering::Release);
        self.source_failed.store(false, Ordering::Release);
        self.output_failed.store(false, Ordering::Release);
    }

    fn commit_boundary(&self, frame: u64, boundary: DirectPcmBoundary) {
        self.track_base_frame.store(frame, Ordering::Release);
        self.duration_micros
            .store(boundary.duration_micros, Ordering::Release);
        self.boundary_generation
            .store(boundary.generation, Ordering::Release);
        self.transition_count.fetch_add(1, Ordering::AcqRel);
    }
}

#[derive(Clone)]
pub struct AlsaDirectPcmMonitor {
    state: Arc<AlsaDirectPcmState>,
    sample_rate: u32,
}

impl AlsaDirectPcmMonitor {
    pub fn position(&self) -> f64 {
        let played = self.state.played_frames.load(Ordering::Acquire);
        let base = self.state.track_base_frame.load(Ordering::Acquire);
        played.saturating_sub(base) as f64 / f64::from(self.sample_rate)
    }

    pub fn duration(&self) -> f64 {
        self.state.duration_micros.load(Ordering::Acquire) as f64 / 1_000_000.0
    }

    pub fn transition_count(&self) -> u64 {
        self.state.transition_count.load(Ordering::Acquire)
    }

    pub fn boundary_generation(&self) -> u64 {
        self.state.boundary_generation.load(Ordering::Acquire)
    }

    pub fn playing(&self) -> bool {
        self.state.playing.load(Ordering::Acquire)
    }

    pub fn finished(&self) -> bool {
        self.state.finished.load(Ordering::Acquire)
    }

    pub fn source_failed(&self) -> bool {
        self.state.source_failed.load(Ordering::Acquire)
    }

    pub fn output_failed(&self) -> bool {
        self.state.output_failed.load(Ordering::Acquire)
    }

    pub fn failed(&self) -> bool {
        self.source_failed() || self.output_failed()
    }
}

enum WriterCommand {
    Play(mpsc::SyncSender<Result<()>>),
    Pause(mpsc::SyncSender<Result<()>>),
    Reset {
        duration_secs: f64,
        response: mpsc::SyncSender<Result<()>>,
    },
    Stop,
}

enum PreparerCommand {
    Play(mpsc::SyncSender<()>),
    Pause(mpsc::SyncSender<()>),
    Reset(mpsc::SyncSender<()>),
    Stop,
}

struct PackedPcmBlock {
    data: Option<Vec<u8>>,
    frames: usize,
    boundary: Option<DirectPcmBoundary>,
    recycle_tx: mpsc::SyncSender<Vec<u8>>,
}

impl PackedPcmBlock {
    fn data(&self) -> &[u8] {
        self.data.as_deref().unwrap_or_default()
    }
}

impl Drop for PackedPcmBlock {
    fn drop(&mut self) {
        if let Some(mut data) = self.data.take() {
            data.clear();
            let _ = self.recycle_tx.try_send(data);
        }
    }
}

enum PreparedPcmEvent {
    Block(PackedPcmBlock),
    Finished,
    Failed,
    Stopped,
}

struct PackedPcmPreparer {
    command_tx: mpsc::Sender<PreparerCommand>,
    worker: Option<JoinHandle<()>>,
}

impl PackedPcmPreparer {
    fn play(&self) -> Result<()> {
        self.request(PreparerCommand::Play)
    }

    fn pause(&self) -> Result<()> {
        self.request(PreparerCommand::Pause)
    }

    fn reset(&self) -> Result<()> {
        self.request(PreparerCommand::Reset)
    }

    fn request(&self, command: impl FnOnce(mpsc::SyncSender<()>) -> PreparerCommand) -> Result<()> {
        let (response_tx, response_rx) = mpsc::sync_channel(0);
        self.command_tx
            .send(command(response_tx))
            .context("提交 ALSA PCM preparer 命令失败")?;
        response_rx
            .recv()
            .context("等待 ALSA PCM preparer 命令失败")?;
        Ok(())
    }

    fn stop(&mut self) {
        let _ = self.command_tx.send(PreparerCommand::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for PackedPcmPreparer {
    fn drop(&mut self) {
        self.stop();
    }
}

enum PcmInput {
    Direct(DirectPcmConsumer),
    Packed(mpsc::Receiver<PreparedPcmEvent>),
}

enum PcmInputPoll {
    Block(PcmWriteBlock),
    Pending,
    Finished,
    Failed,
    Stopped,
}

enum PcmWriteBlock {
    Direct(DirectPcmLease),
    Packed(PackedPcmBlock),
}

impl PcmWriteBlock {
    fn data(&self) -> &[u8] {
        match self {
            Self::Direct(value) => value.data(),
            Self::Packed(value) => value.data(),
        }
    }

    fn sample_frames(&self) -> usize {
        match self {
            Self::Direct(value) => value.sample_frames(),
            Self::Packed(value) => value.frames,
        }
    }

    fn boundary(&self) -> Option<DirectPcmBoundary> {
        match self {
            Self::Direct(value) => value.boundary(),
            Self::Packed(value) => value.boundary,
        }
    }
}

impl PcmInput {
    fn poll(&self) -> PcmInputPoll {
        match self {
            Self::Direct(consumer) => match consumer.poll() {
                DirectPcmPoll::Block(value) => PcmInputPoll::Block(PcmWriteBlock::Direct(value)),
                DirectPcmPoll::Pending => PcmInputPoll::Pending,
                DirectPcmPoll::Finished => PcmInputPoll::Finished,
                DirectPcmPoll::Failed => PcmInputPoll::Failed,
                DirectPcmPoll::Stopped => PcmInputPoll::Stopped,
            },
            Self::Packed(receiver) => match receiver.try_recv() {
                Ok(PreparedPcmEvent::Block(value)) => {
                    PcmInputPoll::Block(PcmWriteBlock::Packed(value))
                }
                Ok(PreparedPcmEvent::Finished) => PcmInputPoll::Finished,
                Ok(PreparedPcmEvent::Failed) => PcmInputPoll::Failed,
                Ok(PreparedPcmEvent::Stopped) => PcmInputPoll::Stopped,
                Err(mpsc::TryRecvError::Empty) => PcmInputPoll::Pending,
                Err(mpsc::TryRecvError::Disconnected) => PcmInputPoll::Failed,
            },
        }
    }

    fn reset(&self) {
        if let Self::Packed(receiver) = self {
            while receiver.try_recv().is_ok() {}
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct PendingBoundary {
    frame: u64,
    boundary: DirectPcmBoundary,
}

/// Strict PCM 的 ALSA transport。
///
/// 源 storage 与 ALSA slot 一致时保持零拷贝；需要 S24/S24_3/S32 无损整数适配时，
/// 由独立的有界 preparer 完成，writer 只负责提交已准备好的 frame。
pub struct AlsaDirectPcmConnection {
    source: DirectPcmSource,
    source_format: DirectPcmFormat,
    config: AlsaPcmConfig,
    state: Arc<AlsaDirectPcmState>,
    command_tx: mpsc::Sender<WriterCommand>,
    preparer: Option<PackedPcmPreparer>,
    cancel: Arc<AtomicBool>,
    writer: Option<JoinHandle<()>>,
    duration_secs: f64,
}

impl AlsaDirectPcmConnection {
    pub fn open_local_at(
        endpoint: &AlsaHwEndpoint,
        path: &Path,
        duration_secs: f64,
        position_secs: f64,
        auto_play: bool,
    ) -> Result<(Self, f64)> {
        let (source, actual_position) = DirectPcmSource::open_local_at(path, position_secs)?;
        Self::open_source(endpoint, source, duration_secs, actual_position, auto_play)
    }

    pub fn open_local_segment(
        endpoint: &AlsaHwEndpoint,
        path: &Path,
        duration_secs: f64,
        start_frame75: u64,
        end_frame75: Option<u64>,
        auto_play: bool,
    ) -> Result<(Self, f64)> {
        let (source, actual_position) =
            DirectPcmSource::open_local_segment(path, start_frame75, end_frame75)?;
        Self::open_source(endpoint, source, duration_secs, actual_position, auto_play)
    }

    fn open_source(
        endpoint: &AlsaHwEndpoint,
        source: DirectPcmSource,
        duration_secs: f64,
        actual_position: f64,
        auto_play: bool,
    ) -> Result<(Self, f64)> {
        let source_format = source.format();
        source.set_duration(duration_secs);
        let handle = open_pcm_hw(endpoint, source_format)?;
        let config = handle.config();

        let state = Arc::new(AlsaDirectPcmState::new(duration_secs));
        let cancel = Arc::new(AtomicBool::new(false));
        let consumer = source.consumer();
        let (input, preparer) = if zero_copy_transport(source_format, config.format) {
            (PcmInput::Direct(consumer), None)
        } else {
            let (preparer, receiver) =
                spawn_packed_preparer(consumer, source_format, config.format, Arc::clone(&cancel))?;
            (PcmInput::Packed(receiver), Some(preparer))
        };
        let (command_tx, command_rx) = mpsc::channel();
        let writer_state = Arc::clone(&state);
        let writer_cancel = Arc::clone(&cancel);
        let writer = thread::Builder::new()
            .name("alsa-direct-pcm".into())
            .spawn(move || {
                if let Err(error) = run_writer(
                    handle,
                    input,
                    writer_state.as_ref(),
                    writer_cancel.as_ref(),
                    command_rx,
                ) {
                    warn!("ALSA direct PCM writer failed: {error:#}");
                    // producer 已明确标记 source failure 时不要再覆盖成设备故障。
                    if !writer_state.source_failed.load(Ordering::Acquire) {
                        writer_state.output_failed.store(true, Ordering::Release);
                    }
                    writer_state.playing.store(false, Ordering::Release);
                }
            })
            .context("启动 ALSA direct PCM writer 失败")?;

        let mut connection = Self {
            source,
            source_format,
            config,
            state,
            command_tx,
            preparer,
            cancel,
            writer: Some(writer),
            duration_secs,
        };
        if auto_play {
            connection.play()?;
        }
        Ok((connection, actual_position))
    }

    pub fn format(&self) -> DirectPcmFormat {
        self.source_format
    }

    pub fn exact_pcm(&self) -> bool {
        self.source.exact_integer_source()
    }

    pub fn config(&self) -> AlsaPcmConfig {
        self.config
    }

    pub fn monitor(&self) -> AlsaDirectPcmMonitor {
        AlsaDirectPcmMonitor {
            state: Arc::clone(&self.state),
            sample_rate: self.source_format.sample_rate,
        }
    }

    pub fn stage_handle(&self) -> DirectPcmStageHandle {
        self.source.stage_handle()
    }

    pub fn play(&mut self) -> Result<()> {
        if let Some(preparer) = &self.preparer {
            preparer.play()?;
        }
        if let Err(error) = self.request(|response| WriterCommand::Play(response)) {
            if let Some(preparer) = &self.preparer {
                let _ = preparer.pause();
            }
            return Err(error);
        }
        Ok(())
    }

    pub fn pause(&mut self) -> Result<()> {
        self.request(|response| WriterCommand::Pause(response))?;
        if let Some(preparer) = &self.preparer {
            preparer.pause()?;
        }
        Ok(())
    }

    pub fn seek_while_paused(&mut self, position_secs: f64) -> Result<f64> {
        ensure!(!self.monitor().playing(), "ALSA direct PCM seek 要求先暂停");
        if let Some(preparer) = &self.preparer {
            preparer.reset()?;
        }
        self.reset_writer(self.duration_secs)?;
        self.source.seek_while_paused(position_secs)
    }

    pub fn seek_segment_while_paused(
        &mut self,
        start_frame75: u64,
        end_frame75: Option<u64>,
        position_secs: f64,
        duration_secs: f64,
    ) -> Result<f64> {
        ensure!(!self.monitor().playing(), "ALSA direct PCM seek 要求先暂停");
        self.duration_secs = duration_secs;
        if let Some(preparer) = &self.preparer {
            preparer.reset()?;
        }
        self.reset_writer(duration_secs)?;
        self.source
            .seek_segment_while_paused(start_frame75, end_frame75, position_secs)
    }

    pub fn replace_local_while_paused(
        &mut self,
        path: &Path,
        duration_secs: f64,
    ) -> Result<DirectPcmFormat> {
        ensure!(
            !self.monitor().playing(),
            "ALSA direct PCM handoff 要求先暂停"
        );
        if let Some(preparer) = &self.preparer {
            preparer.reset()?;
        }
        self.reset_writer(duration_secs)?;
        let format = self.source.replace_local_while_paused(path)?;
        ensure!(
            format.sample_rate == self.source_format.sample_rate
                && format.channels == self.source_format.channels
                && format.valid_bits == self.source_format.valid_bits
                && format.storage_bits == self.source_format.storage_bits
                && format.sample_format == self.source_format.sample_format,
            "ALSA direct PCM handoff 格式需要重新协商"
        );
        self.source_format = format;
        self.duration_secs = duration_secs;
        Ok(format)
    }

    fn reset_writer(&self, duration_secs: f64) -> Result<()> {
        let (response_tx, response_rx) = mpsc::sync_channel(0);
        self.command_tx
            .send(WriterCommand::Reset {
                duration_secs,
                response: response_tx,
            })
            .context("提交 ALSA direct PCM reset 失败")?;
        response_rx
            .recv()
            .context("等待 ALSA direct PCM reset 失败")?
    }

    fn request(
        &self,
        command: impl FnOnce(mpsc::SyncSender<Result<()>>) -> WriterCommand,
    ) -> Result<()> {
        let (response_tx, response_rx) = mpsc::sync_channel(0);
        self.command_tx
            .send(command(response_tx))
            .context("提交 ALSA direct PCM 控制命令失败")?;
        response_rx
            .recv()
            .context("等待 ALSA direct PCM 控制命令失败")?
    }
}

impl Drop for AlsaDirectPcmConnection {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        if let Some(preparer) = &mut self.preparer {
            preparer.stop();
        }
        let _ = self.command_tx.send(WriterCommand::Stop);
        if let Some(writer) = self.writer.take() {
            let _ = writer.join();
        }
    }
}

fn spawn_packed_preparer(
    consumer: DirectPcmConsumer,
    source_format: DirectPcmFormat,
    target_format: AlsaPcmFormat,
    cancel: Arc<AtomicBool>,
) -> Result<(PackedPcmPreparer, mpsc::Receiver<PreparedPcmEvent>)> {
    let (command_tx, command_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::sync_channel(PACK_QUEUE_DEPTH);
    let (recycle_tx, recycle_rx) = mpsc::sync_channel(PACK_QUEUE_DEPTH + 1);
    let worker_recycle_tx = recycle_tx.clone();
    let worker = thread::Builder::new()
        .name("alsa-pcm-prepare".into())
        .spawn(move || {
            run_packed_preparer(
                consumer,
                source_format,
                target_format,
                cancel.as_ref(),
                command_rx,
                ready_tx,
                worker_recycle_tx,
                recycle_rx,
            );
        })
        .context("启动 ALSA PCM preparer 失败")?;
    Ok((
        PackedPcmPreparer {
            command_tx,
            worker: Some(worker),
        },
        ready_rx,
    ))
}

fn run_packed_preparer(
    consumer: DirectPcmConsumer,
    source_format: DirectPcmFormat,
    target_format: AlsaPcmFormat,
    cancel: &AtomicBool,
    command_rx: mpsc::Receiver<PreparerCommand>,
    ready_tx: mpsc::SyncSender<PreparedPcmEvent>,
    recycle_tx: mpsc::SyncSender<Vec<u8>>,
    recycle_rx: mpsc::Receiver<Vec<u8>>,
) {
    let mut active = false;
    let mut pending = None;
    loop {
        if cancel.load(Ordering::Acquire) {
            let _ = ready_tx.try_send(PreparedPcmEvent::Stopped);
            return;
        }

        while let Ok(command) = command_rx.try_recv() {
            if apply_preparer_command(command, &mut active, &mut pending) {
                return;
            }
        }

        if !active {
            match command_rx.recv_timeout(Duration::from_millis(20)) {
                Ok(command) => {
                    if apply_preparer_command(command, &mut active, &mut pending) {
                        return;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
            continue;
        }

        if let Some(event) = pending.take() {
            let terminal = matches!(
                &event,
                PreparedPcmEvent::Finished | PreparedPcmEvent::Failed | PreparedPcmEvent::Stopped
            );
            match ready_tx.try_send(event) {
                Ok(()) => {
                    if terminal {
                        active = false;
                    }
                }
                Err(mpsc::TrySendError::Full(event)) => {
                    pending = Some(event);
                    thread::sleep(SOURCE_POLL_INTERVAL);
                }
                Err(mpsc::TrySendError::Disconnected(_)) => return,
            }
            continue;
        }

        pending = match consumer.poll() {
            DirectPcmPoll::Block(lease) => match prepare_packed_block(
                lease,
                source_format,
                target_format,
                &recycle_tx,
                &recycle_rx,
            ) {
                Ok(value) => Some(PreparedPcmEvent::Block(value)),
                Err(_) => Some(PreparedPcmEvent::Failed),
            },
            DirectPcmPoll::Pending => {
                thread::sleep(SOURCE_POLL_INTERVAL);
                None
            }
            DirectPcmPoll::Finished => Some(PreparedPcmEvent::Finished),
            DirectPcmPoll::Failed => Some(PreparedPcmEvent::Failed),
            DirectPcmPoll::Stopped => Some(PreparedPcmEvent::Stopped),
        };
    }
}

fn apply_preparer_command(
    command: PreparerCommand,
    active: &mut bool,
    pending: &mut Option<PreparedPcmEvent>,
) -> bool {
    match command {
        PreparerCommand::Play(response) => {
            *active = true;
            let _ = response.send(());
            false
        }
        PreparerCommand::Pause(response) => {
            *active = false;
            let _ = response.send(());
            false
        }
        PreparerCommand::Reset(response) => {
            *active = false;
            *pending = None;
            let _ = response.send(());
            false
        }
        PreparerCommand::Stop => true,
    }
}

fn prepare_packed_block(
    lease: DirectPcmLease,
    source_format: DirectPcmFormat,
    target_format: AlsaPcmFormat,
    recycle_tx: &mpsc::SyncSender<Vec<u8>>,
    recycle_rx: &mpsc::Receiver<Vec<u8>>,
) -> Result<PackedPcmBlock> {
    let expected_bytes = lease
        .sample_frames()
        .checked_mul(usize::from(source_format.channels))
        .and_then(|samples| samples.checked_mul(target_format.storage_bytes()))
        .context("ALSA packed PCM block 长度溢出")?;
    let mut data = recycle_rx.try_recv().unwrap_or_default();
    data.resize(expected_bytes, 0);
    let stats = pack_direct_pcm(source_format, lease.data(), target_format, &mut data)?;
    ensure!(
        stats.bytes == expected_bytes,
        "ALSA packed PCM 输出长度与 frame 数不一致"
    );
    if stats.quantized && stats.clipped {
        warn!("ALSA direct Float32→integer 表示适配发生 clipping/sanitize");
    }
    let block = PackedPcmBlock {
        data: Some(data),
        frames: lease.sample_frames(),
        boundary: lease.boundary(),
        recycle_tx: recycle_tx.clone(),
    };
    drop(lease);
    Ok(block)
}

fn run_writer(
    handle: super::output::AlsaPcmHandle,
    input: PcmInput,
    state: &AlsaDirectPcmState,
    cancel: &AtomicBool,
    command_rx: mpsc::Receiver<WriterCommand>,
) -> Result<()> {
    let mut writer = AlsaFrameWriter::new(handle)?;
    let mut playing = false;
    let mut hardware_paused = false;
    let mut pending_boundaries = VecDeque::new();

    loop {
        if cancel.load(Ordering::Acquire) {
            let _ = writer.drop_stream();
            state.stopped.store(true, Ordering::Release);
            state.playing.store(false, Ordering::Release);
            return Ok(());
        }

        if !playing {
            let command = command_rx.recv().context("ALSA writer 控制通道已关闭")?;
            if handle_command(
                command,
                &mut writer,
                state,
                &mut playing,
                &mut hardware_paused,
                &mut pending_boundaries,
                &input,
            )? {
                return Ok(());
            }
            continue;
        }

        while let Ok(command) = command_rx.try_recv() {
            if handle_command(
                command,
                &mut writer,
                state,
                &mut playing,
                &mut hardware_paused,
                &mut pending_boundaries,
                &input,
            )? {
                return Ok(());
            }
            if !playing {
                break;
            }
        }
        if !playing {
            continue;
        }

        match input.poll() {
            PcmInputPoll::Block(block) => {
                let submitted_before = state.submitted_frames.load(Ordering::Acquire);
                if let Some(boundary) = block.boundary() {
                    pending_boundaries.push_back(PendingBoundary {
                        frame: submitted_before,
                        boundary,
                    });
                }
                let expected_frames = block.sample_frames();
                let written = writer.write_all(block.data(), || cancel.load(Ordering::Acquire))?;
                ensure!(
                    written == expected_frames,
                    "ALSA write frame 数与 Direct block 不一致"
                );
                state
                    .submitted_frames
                    .fetch_add(written as u64, Ordering::AcqRel);
                update_played(&writer, state, &mut pending_boundaries)?;
            }
            PcmInputPoll::Pending => {
                update_played(&writer, state, &mut pending_boundaries)?;
                thread::sleep(SOURCE_POLL_INTERVAL);
            }
            PcmInputPoll::Finished => {
                drain_to_end(&writer, state, &mut pending_boundaries, cancel)?;
                state.finished.store(true, Ordering::Release);
                state.playing.store(false, Ordering::Release);
                playing = false;
            }
            PcmInputPoll::Failed => {
                state.source_failed.store(true, Ordering::Release);
                bail!("Direct PCM producer 失败");
            }
            PcmInputPoll::Stopped => return Ok(()),
        }
    }
}

fn handle_command(
    command: WriterCommand,
    writer: &mut AlsaFrameWriter,
    state: &AlsaDirectPcmState,
    playing: &mut bool,
    hardware_paused: &mut bool,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    input: &PcmInput,
) -> Result<bool> {
    match command {
        WriterCommand::Play(response) => {
            let result = (|| {
                ensure!(
                    !state.source_failed.load(Ordering::Acquire)
                        && !state.output_failed.load(Ordering::Acquire),
                    "ALSA Direct PCM runtime 已失败"
                );
                if *hardware_paused {
                    writer.pause(false)?;
                    *hardware_paused = false;
                }
                state.finished.store(false, Ordering::Release);
                state.playing.store(true, Ordering::Release);
                *playing = true;
                Ok(())
            })();
            let failed = result.is_err();
            let _ = response.send(result);
            if failed {
                state.output_failed.store(true, Ordering::Release);
                return Ok(true);
            }
        }
        WriterCommand::Pause(response) => {
            let result = if !*playing {
                Ok(())
            } else if writer.can_pause() && writer.state() == State::Running {
                writer.pause(true).map(|_| {
                    *hardware_paused = true;
                })
            } else if writer.can_pause() && writer.state() == State::Paused {
                *hardware_paused = true;
                Ok(())
            } else {
                drain_to_pause(writer, state, pending_boundaries)
            };
            if result.is_ok() {
                *playing = false;
                state.playing.store(false, Ordering::Release);
            } else {
                state.output_failed.store(true, Ordering::Release);
            }
            let failed = result.is_err();
            let _ = response.send(result);
            if failed {
                return Ok(true);
            }
        }
        WriterCommand::Reset {
            duration_secs,
            response,
        } => {
            let result = (|| {
                ensure!(!*playing, "ALSA reset 要求先暂停");
                writer.drop_stream()?;
                writer.prepare()?;
                *hardware_paused = false;
                pending_boundaries.clear();
                input.reset();
                state.reset_timeline(duration_secs);
                Ok(())
            })();
            let failed = result.is_err();
            let _ = response.send(result);
            if failed {
                state.output_failed.store(true, Ordering::Release);
                return Ok(true);
            }
        }
        WriterCommand::Stop => {
            let _ = writer.drop_stream();
            state.stopped.store(true, Ordering::Release);
            state.playing.store(false, Ordering::Release);
            return Ok(true);
        }
    }
    Ok(false)
}

fn drain_to_pause(
    writer: &AlsaFrameWriter,
    state: &AlsaDirectPcmState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
) -> Result<()> {
    drain_pcm(
        writer,
        state,
        pending_boundaries,
        &AtomicBool::new(false),
        false,
    )?;
    writer.prepare()
}

fn drain_to_end(
    writer: &AlsaFrameWriter,
    state: &AlsaDirectPcmState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    cancel: &AtomicBool,
) -> Result<()> {
    // 自然 EOF 后 handle 即将释放，不再 prepare；此时 underrun 只表示已提交帧已被硬件吃空。
    drain_pcm(writer, state, pending_boundaries, cancel, true)
}

fn drain_pcm(
    writer: &AlsaFrameWriter,
    state: &AlsaDirectPcmState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    cancel: &AtomicBool,
    terminal_eof: bool,
) -> Result<()> {
    let submitted = state.submitted_frames.load(Ordering::Acquire);
    let played = state.played_frames.load(Ordering::Acquire);
    if submitted <= played {
        return Ok(());
    }
    if writer.state() == State::Prepared {
        writer.start()?;
    }

    let deadline = Instant::now() + DRAIN_TIMEOUT;
    loop {
        ensure!(!cancel.load(Ordering::Acquire), "ALSA drain 已取消");
        if terminal_eof && terminal_drain_state_is_complete(writer.state()) {
            complete_terminal_drain(state, pending_boundaries, submitted);
            return Ok(());
        }
        match writer.drain_once() {
            Ok(()) => {
                complete_terminal_drain(state, pending_boundaries, submitted);
                return Ok(());
            }
            Err(error) if terminal_eof && terminal_drain_xrun_is_complete(error.errno()) => {
                complete_terminal_drain(state, pending_boundaries, submitted);
                return Ok(());
            }
            Err(error) if matches!(error.errno(), libc::EAGAIN | libc::EINTR) => {
                // 非阻塞 drain 在曲末常先返回 EAGAIN；等待期间设备可能正好进入
                // XRUN。自然 EOF 不再读取 delay，避免把“最后一帧已播放完”误判成
                // 输出故障。暂停 drain 仍保持原来的严格 XRUN 处理。
                if !terminal_eof {
                    update_played(writer, state, pending_boundaries)?;
                }
                ensure!(Instant::now() < deadline, "ALSA drain 超时");
                match writer.wait(100) {
                    Ok(_) => {}
                    Err(_error)
                        if terminal_eof && terminal_drain_state_is_complete(writer.state()) =>
                    {
                        complete_terminal_drain(state, pending_boundaries, submitted);
                        return Ok(());
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(anyhow::anyhow!(error).context("ALSA drain 失败")),
        }
    }
}

fn terminal_drain_xrun_is_complete(errno: i32) -> bool {
    errno == libc::EPIPE
}

fn terminal_drain_state_is_complete(state: State) -> bool {
    matches!(state, State::Setup | State::XRun)
}

fn complete_terminal_drain(
    state: &AlsaDirectPcmState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    submitted: u64,
) {
    state.played_frames.store(submitted, Ordering::Release);
    commit_boundaries(state, pending_boundaries, submitted);
}

fn update_played(
    writer: &AlsaFrameWriter,
    state: &AlsaDirectPcmState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
) -> Result<()> {
    let submitted = state.submitted_frames.load(Ordering::Acquire);
    let played = match writer.state() {
        State::Prepared | State::Setup | State::Open => state.played_frames.load(Ordering::Acquire),
        State::XRun => bail!("ALSA XRUN"),
        _ => played_from_delay(submitted, writer.delay()?),
    };
    let previous = state.played_frames.load(Ordering::Acquire);
    let played = played.max(previous).min(submitted);
    state.played_frames.store(played, Ordering::Release);
    commit_boundaries(state, pending_boundaries, played);
    Ok(())
}

fn commit_boundaries(
    state: &AlsaDirectPcmState,
    pending: &mut VecDeque<PendingBoundary>,
    played_frames: u64,
) {
    while pending
        .front()
        .is_some_and(|boundary| boundary.frame <= played_frames)
    {
        let boundary = pending.pop_front().expect("front 已确认存在");
        state.commit_boundary(boundary.frame, boundary.boundary);
    }
}

fn played_from_delay(submitted_frames: u64, delay_frames: alsa::pcm::Frames) -> u64 {
    let delay = u64::try_from(delay_frames.max(0)).unwrap_or(u64::MAX);
    submitted_frames.saturating_sub(delay)
}

fn zero_copy_transport(source: DirectPcmFormat, target: AlsaPcmFormat) -> bool {
    matches!(
        (source.sample_format, target),
        (DirectPcmSampleFormat::Signed16, AlsaPcmFormat::S16Le)
            | (DirectPcmSampleFormat::Signed32, AlsaPcmFormat::S32Le)
            | (DirectPcmSampleFormat::Float32, AlsaPcmFormat::F32Le)
    )
}

fn duration_to_micros(duration_secs: f64) -> u64 {
    (duration_secs.max(0.0) * 1_000_000.0)
        .round()
        .clamp(0.0, u64::MAX as f64) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::direct_pcm::DirectPcmMemoryPath;

    fn source_format(sample_format: DirectPcmSampleFormat, valid_bits: u8) -> DirectPcmFormat {
        DirectPcmFormat {
            sample_rate: 48_000,
            channels: 2,
            valid_bits,
            storage_bits: match sample_format {
                DirectPcmSampleFormat::Signed16 => 16,
                DirectPcmSampleFormat::Signed32 => 32,
                DirectPcmSampleFormat::Float32 => 32,
            },
            sample_format,
            memory_path: DirectPcmMemoryPath::ZeroCopyPacked,
        }
    }

    #[test]
    fn zero_copy_path_only_accepts_identical_storage_slots() {
        assert!(zero_copy_transport(
            source_format(DirectPcmSampleFormat::Signed16, 16),
            AlsaPcmFormat::S16Le
        ));
        assert!(zero_copy_transport(
            source_format(DirectPcmSampleFormat::Signed32, 24),
            AlsaPcmFormat::S32Le
        ));
        assert!(!zero_copy_transport(
            source_format(DirectPcmSampleFormat::Signed32, 24),
            AlsaPcmFormat::S24_3Le
        ));
        assert!(zero_copy_transport(
            source_format(DirectPcmSampleFormat::Float32, 32),
            AlsaPcmFormat::F32Le
        ));
    }

    #[test]
    fn terminal_eof_accepts_only_xrun_as_completed_drain() {
        assert!(terminal_drain_xrun_is_complete(libc::EPIPE));
        assert!(!terminal_drain_xrun_is_complete(libc::ESTRPIPE));
        assert!(!terminal_drain_xrun_is_complete(libc::EIO));
    }

    #[test]
    fn terminal_eof_accepts_setup_or_xrun_as_completed_state() {
        assert!(terminal_drain_state_is_complete(State::Setup));
        assert!(terminal_drain_state_is_complete(State::XRun));
        assert!(!terminal_drain_state_is_complete(State::Prepared));
        assert!(!terminal_drain_state_is_complete(State::Running));
        assert!(!terminal_drain_state_is_complete(State::Suspended));
    }

    #[test]
    fn played_frames_are_submitted_minus_nonnegative_delay() {
        assert_eq!(played_from_delay(1_000, 250), 750);
        assert_eq!(played_from_delay(1_000, -10), 1_000);
        assert_eq!(played_from_delay(100, 500), 0);
    }

    #[test]
    fn monitor_keeps_source_and_output_failures_distinct() {
        let state = Arc::new(AlsaDirectPcmState::new(1.0));
        let monitor = AlsaDirectPcmMonitor {
            state: Arc::clone(&state),
            sample_rate: 48_000,
        };
        assert!(!monitor.failed());

        state.source_failed.store(true, Ordering::Release);
        assert!(monitor.source_failed());
        assert!(!monitor.output_failed());

        state.source_failed.store(false, Ordering::Release);
        state.output_failed.store(true, Ordering::Release);
        assert!(!monitor.source_failed());
        assert!(monitor.output_failed());
    }

    #[test]
    fn boundary_commits_only_after_played_position_reaches_it() {
        let state = AlsaDirectPcmState::new(1.0);
        let mut pending = VecDeque::from([PendingBoundary {
            frame: 480,
            boundary: DirectPcmBoundary {
                duration_micros: 2_000_000,
                generation: 7,
            },
        }]);
        commit_boundaries(&state, &mut pending, 479);
        assert_eq!(state.transition_count.load(Ordering::Acquire), 0);
        commit_boundaries(&state, &mut pending, 480);
        assert_eq!(state.transition_count.load(Ordering::Acquire), 1);
        assert_eq!(state.track_base_frame.load(Ordering::Acquire), 480);
        assert_eq!(state.boundary_generation.load(Ordering::Acquire), 7);
        assert_eq!(state.duration_micros.load(Ordering::Acquire), 2_000_000);
    }

    #[test]
    fn preparer_pause_preserves_pending_but_reset_discards_it() {
        let mut active = true;
        let mut pending = Some(PreparedPcmEvent::Finished);
        let (pause_tx, pause_rx) = mpsc::sync_channel(0);
        let waiter = std::thread::spawn(move || pause_rx.recv().unwrap());
        assert!(!apply_preparer_command(
            PreparerCommand::Pause(pause_tx),
            &mut active,
            &mut pending,
        ));
        waiter.join().unwrap();
        assert!(!active);
        assert!(matches!(pending, Some(PreparedPcmEvent::Finished)));

        let (reset_tx, reset_rx) = mpsc::sync_channel(0);
        let waiter = std::thread::spawn(move || reset_rx.recv().unwrap());
        assert!(!apply_preparer_command(
            PreparerCommand::Reset(reset_tx),
            &mut active,
            &mut pending,
        ));
        waiter.join().unwrap();
        assert!(pending.is_none());
    }
}
