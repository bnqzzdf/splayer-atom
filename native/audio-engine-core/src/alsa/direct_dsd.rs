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
use super::dsd::{open_dsd_hw, pack_grouped_msb_dsd, AlsaDsdConfig, AlsaDsdFormat};
use super::writer::AlsaFrameWriter;
use crate::direct_dsd::{
    DirectDsdBitOrder, DirectDsdBoundary, DirectDsdConsumer, DirectDsdFormat, DirectDsdLease,
    DirectDsdPoll, DirectDsdReader, DirectDsdSource, DirectDsdStageHandle,
};

const SOURCE_POLL_INTERVAL: Duration = Duration::from_millis(1);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
const PACK_QUEUE_DEPTH: usize = 4;

struct AlsaDirectDsdState {
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

impl AlsaDirectDsdState {
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

    fn commit_boundary(&self, frame: u64, boundary: DirectDsdBoundary) {
        self.track_base_frame.store(frame, Ordering::Release);
        self.duration_micros
            .store(boundary.duration_micros, Ordering::Release);
        self.boundary_generation
            .store(boundary.generation, Ordering::Release);
        self.transition_count.fetch_add(1, Ordering::AcqRel);
    }
}

#[derive(Clone)]
pub struct AlsaDirectDsdMonitor {
    state: Arc<AlsaDirectDsdState>,
    bit_rate: u32,
    bits_per_frame: u8,
}

impl AlsaDirectDsdMonitor {
    pub fn position(&self) -> f64 {
        let played = self.state.played_frames.load(Ordering::Acquire);
        let base = self.state.track_base_frame.load(Ordering::Acquire);
        let frames = played.saturating_sub(base);
        frames as f64 * f64::from(self.bits_per_frame) / f64::from(self.bit_rate)
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

#[derive(Debug, Clone, Copy)]
struct PendingBoundary {
    frame: u64,
    boundary: DirectDsdBoundary,
}

struct PackedDsdBlock {
    data: Option<Vec<u8>>,
    frames: usize,
    boundary: Option<DirectDsdBoundary>,
    recycle_tx: mpsc::SyncSender<Vec<u8>>,
}

impl PackedDsdBlock {
    fn data(&self) -> &[u8] {
        self.data.as_deref().unwrap_or_default()
    }
}

impl Drop for PackedDsdBlock {
    fn drop(&mut self) {
        if let Some(mut data) = self.data.take() {
            data.clear();
            let _ = self.recycle_tx.try_send(data);
        }
    }
}

enum PreparedDsdEvent {
    Block(PackedDsdBlock),
    Finished,
    Failed,
    Stopped,
}

struct PackedDsdPreparer {
    command_tx: mpsc::Sender<PreparerCommand>,
    worker: Option<JoinHandle<()>>,
}

impl PackedDsdPreparer {
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
            .context("提交 ALSA DSD preparer 命令失败")?;
        response_rx
            .recv()
            .context("等待 ALSA DSD preparer 命令失败")?;
        Ok(())
    }

    fn stop(&mut self) {
        let _ = self.command_tx.send(PreparerCommand::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for PackedDsdPreparer {
    fn drop(&mut self) {
        self.stop();
    }
}

enum DsdInput {
    Direct(DirectDsdConsumer),
    Packed(mpsc::Receiver<PreparedDsdEvent>),
}

enum DsdInputPoll {
    Block(DsdWriteBlock),
    Pending,
    Finished,
    Failed,
    Stopped,
}

enum DsdWriteBlock {
    Direct(DirectDsdLease),
    Packed(PackedDsdBlock),
}

impl DsdWriteBlock {
    fn data(&self) -> &[u8] {
        match self {
            Self::Direct(value) => value.data(),
            Self::Packed(value) => value.data(),
        }
    }

    fn frames(&self, bits_per_frame: u8) -> Result<usize> {
        match self {
            Self::Direct(value) => frames_from_bits(value.bits_per_channel(), bits_per_frame),
            Self::Packed(value) => Ok(value.frames),
        }
    }

    fn boundary(&self) -> Option<DirectDsdBoundary> {
        match self {
            Self::Direct(value) => value.boundary(),
            Self::Packed(value) => value.boundary,
        }
    }
}

impl DsdInput {
    fn poll(&self) -> DsdInputPoll {
        match self {
            Self::Direct(consumer) => match consumer.poll() {
                DirectDsdPoll::Block(value) => DsdInputPoll::Block(DsdWriteBlock::Direct(value)),
                DirectDsdPoll::Pending => DsdInputPoll::Pending,
                DirectDsdPoll::Finished => DsdInputPoll::Finished,
                DirectDsdPoll::Failed => DsdInputPoll::Failed,
                DirectDsdPoll::Stopped => DsdInputPoll::Stopped,
            },
            Self::Packed(receiver) => match receiver.try_recv() {
                Ok(PreparedDsdEvent::Block(value)) => {
                    DsdInputPoll::Block(DsdWriteBlock::Packed(value))
                }
                Ok(PreparedDsdEvent::Finished) => DsdInputPoll::Finished,
                Ok(PreparedDsdEvent::Failed) => DsdInputPoll::Failed,
                Ok(PreparedDsdEvent::Stopped) => DsdInputPoll::Stopped,
                Err(mpsc::TryRecvError::Empty) => DsdInputPoll::Pending,
                Err(mpsc::TryRecvError::Disconnected) => DsdInputPoll::Failed,
            },
        }
    }

    fn reset(&self) {
        if let Self::Packed(receiver) = self {
            while receiver.try_recv().is_ok() {}
        }
    }
}

pub struct AlsaDirectDsdConnection {
    source: DirectDsdSource,
    source_format: DirectDsdFormat,
    config: AlsaDsdConfig,
    state: Arc<AlsaDirectDsdState>,
    command_tx: mpsc::Sender<WriterCommand>,
    preparer: Option<PackedDsdPreparer>,
    cancel: Arc<AtomicBool>,
    writer: Option<JoinHandle<()>>,
    duration_secs: f64,
}

impl AlsaDirectDsdConnection {
    pub fn open_local_at(
        endpoint: &AlsaHwEndpoint,
        path: &Path,
        duration_secs: f64,
        position_secs: f64,
        auto_play: bool,
    ) -> Result<(Self, f64)> {
        let source_format = DirectDsdReader::open_local(path)?.format();
        let handle = open_dsd_hw(endpoint, source_format)?;
        let config = handle.config();
        let group_bytes = config.format.storage_bytes();
        let (mut source, actual_position) =
            DirectDsdSource::open_local_grouped(path, position_secs, group_bytes)?;
        let actual_position =
            source.set_wire_bit_order_while_paused(DirectDsdBitOrder::MsbFirst, actual_position)?;
        Self::open_source(
            source,
            source_format,
            handle,
            config,
            duration_secs,
            actual_position,
            auto_play,
        )
    }

    pub fn open_local_segment(
        endpoint: &AlsaHwEndpoint,
        path: &Path,
        duration_secs: f64,
        start_frame75: u64,
        end_frame75: Option<u64>,
        auto_play: bool,
    ) -> Result<(Self, f64)> {
        let source_format = DirectDsdReader::open_local(path)?.format();
        let handle = open_dsd_hw(endpoint, source_format)?;
        let config = handle.config();
        let group_bytes = config.format.storage_bytes();
        let (mut source, _) = DirectDsdSource::open_local_segment_grouped(
            path,
            start_frame75,
            end_frame75,
            duration_secs,
            group_bytes,
        )?;
        let actual_position = source.set_wire_bit_order_segment_while_paused(
            DirectDsdBitOrder::MsbFirst,
            start_frame75,
            end_frame75,
            0.0,
        )?;
        Self::open_source(
            source,
            source_format,
            handle,
            config,
            duration_secs,
            actual_position,
            auto_play,
        )
    }

    fn open_source(
        source: DirectDsdSource,
        source_format: DirectDsdFormat,
        handle: super::dsd::AlsaDsdHandle,
        config: AlsaDsdConfig,
        duration_secs: f64,
        actual_position: f64,
        auto_play: bool,
    ) -> Result<(Self, f64)> {
        let state = Arc::new(AlsaDirectDsdState::new(duration_secs));
        let cancel = Arc::new(AtomicBool::new(false));
        let consumer = source.consumer();
        let (input, preparer) = if config.format.needs_word_byte_swap() {
            let (preparer, receiver) =
                spawn_packed_preparer(consumer, source_format, config.format, Arc::clone(&cancel))?;
            (DsdInput::Packed(receiver), Some(preparer))
        } else {
            (DsdInput::Direct(consumer), None)
        };

        let (command_tx, command_rx) = mpsc::channel();
        let writer_state = Arc::clone(&state);
        let writer_cancel = Arc::clone(&cancel);
        let writer = thread::Builder::new()
            .name("alsa-direct-dsd".into())
            .spawn(move || {
                crate::priority::boost_current_audio_thread("alsa-direct-dsd");
                if let Err(error) = run_writer(
                    handle,
                    input,
                    writer_state.as_ref(),
                    writer_cancel.as_ref(),
                    command_rx,
                ) {
                    if writer_cancel.load(Ordering::Acquire) {
                        writer_state.stopped.store(true, Ordering::Release);
                        writer_state.playing.store(false, Ordering::Release);
                        return;
                    }
                    warn!("ALSA direct DSD writer failed: {error:#}");
                    // producer 已明确标记 source failure 时不要再覆盖成设备故障。
                    if !writer_state.source_failed.load(Ordering::Acquire) {
                        writer_state.output_failed.store(true, Ordering::Release);
                    }
                    writer_state.playing.store(false, Ordering::Release);
                }
            })
            .context("启动 ALSA Native DSD writer 失败")?;

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

    pub fn format(&self) -> DirectDsdFormat {
        self.source_format
    }

    pub fn config(&self) -> AlsaDsdConfig {
        self.config
    }

    pub fn monitor(&self) -> AlsaDirectDsdMonitor {
        AlsaDirectDsdMonitor {
            state: Arc::clone(&self.state),
            bit_rate: self.source_format.bit_rate,
            bits_per_frame: self.config.bits_per_channel_frame,
        }
    }

    pub fn stage_handle(&self) -> DirectDsdStageHandle {
        self.source.stage_handle()
    }

    pub fn play(&mut self) -> Result<()> {
        if let Some(preparer) = &self.preparer {
            preparer.play()?;
        }
        if let Err(error) = self.request(WriterCommand::Play) {
            if let Some(preparer) = &self.preparer {
                let _ = preparer.pause();
            }
            return Err(error);
        }
        Ok(())
    }

    pub fn pause(&mut self) -> Result<()> {
        self.request(WriterCommand::Pause)?;
        if let Some(preparer) = &self.preparer {
            preparer.pause()?;
        }
        Ok(())
    }

    pub fn seek_while_paused(&mut self, position_secs: f64) -> Result<f64> {
        ensure!(!self.monitor().playing(), "ALSA Native DSD seek 要求先暂停");
        self.reset_prepared_input()?;
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
        ensure!(!self.monitor().playing(), "ALSA Native DSD seek 要求先暂停");
        self.duration_secs = duration_secs;
        self.reset_prepared_input()?;
        self.reset_writer(duration_secs)?;
        self.source
            .seek_segment_while_paused(start_frame75, end_frame75, position_secs)
    }

    pub fn replace_local_while_paused(
        &mut self,
        path: &Path,
        duration_secs: f64,
    ) -> Result<DirectDsdFormat> {
        ensure!(
            !self.monitor().playing(),
            "ALSA Native DSD handoff 要求先暂停"
        );
        self.reset_prepared_input()?;
        self.reset_writer(duration_secs)?;
        let format = self.source.replace_local_while_paused(path)?;
        ensure!(
            format.bit_rate == self.source_format.bit_rate
                && format.channels == self.source_format.channels,
            "ALSA Native DSD handoff 格式需要重新协商"
        );
        self.source_format = format;
        self.duration_secs = duration_secs;
        Ok(format)
    }

    fn reset_prepared_input(&self) -> Result<()> {
        if let Some(preparer) = &self.preparer {
            preparer.reset()?;
        }
        Ok(())
    }

    fn reset_writer(&self, duration_secs: f64) -> Result<()> {
        let (response_tx, response_rx) = mpsc::sync_channel(0);
        self.command_tx
            .send(WriterCommand::Reset {
                duration_secs,
                response: response_tx,
            })
            .context("提交 ALSA Native DSD reset 失败")?;
        response_rx
            .recv()
            .context("等待 ALSA Native DSD reset 失败")?
    }

    fn request(
        &self,
        command: impl FnOnce(mpsc::SyncSender<Result<()>>) -> WriterCommand,
    ) -> Result<()> {
        let (response_tx, response_rx) = mpsc::sync_channel(0);
        self.command_tx
            .send(command(response_tx))
            .context("提交 ALSA Native DSD 控制命令失败")?;
        response_rx
            .recv()
            .context("等待 ALSA Native DSD 控制命令失败")?
    }
}

impl Drop for AlsaDirectDsdConnection {
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
    consumer: DirectDsdConsumer,
    source_format: DirectDsdFormat,
    target_format: AlsaDsdFormat,
    cancel: Arc<AtomicBool>,
) -> Result<(PackedDsdPreparer, mpsc::Receiver<PreparedDsdEvent>)> {
    let (command_tx, command_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::sync_channel(PACK_QUEUE_DEPTH);
    let (recycle_tx, recycle_rx) = mpsc::sync_channel(PACK_QUEUE_DEPTH + 1);
    let worker_recycle_tx = recycle_tx;
    let worker = thread::Builder::new()
        .name("alsa-dsd-prepare".into())
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
        .context("启动 ALSA Native DSD preparer 失败")?;
    Ok((
        PackedDsdPreparer {
            command_tx,
            worker: Some(worker),
        },
        ready_rx,
    ))
}

fn run_packed_preparer(
    consumer: DirectDsdConsumer,
    source_format: DirectDsdFormat,
    target_format: AlsaDsdFormat,
    cancel: &AtomicBool,
    command_rx: mpsc::Receiver<PreparerCommand>,
    ready_tx: mpsc::SyncSender<PreparedDsdEvent>,
    recycle_tx: mpsc::SyncSender<Vec<u8>>,
    recycle_rx: mpsc::Receiver<Vec<u8>>,
) {
    let mut active = false;
    let mut pending = None;
    loop {
        if cancel.load(Ordering::Acquire) {
            let _ = ready_tx.try_send(PreparedDsdEvent::Stopped);
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
                PreparedDsdEvent::Finished | PreparedDsdEvent::Failed | PreparedDsdEvent::Stopped
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
            DirectDsdPoll::Block(lease) => match prepare_packed_block(
                lease,
                source_format,
                target_format,
                &recycle_tx,
                &recycle_rx,
            ) {
                Ok(value) => Some(PreparedDsdEvent::Block(value)),
                Err(_) => Some(PreparedDsdEvent::Failed),
            },
            DirectDsdPoll::Pending => {
                thread::sleep(SOURCE_POLL_INTERVAL);
                None
            }
            DirectDsdPoll::Finished => Some(PreparedDsdEvent::Finished),
            DirectDsdPoll::Failed => Some(PreparedDsdEvent::Failed),
            DirectDsdPoll::Stopped => Some(PreparedDsdEvent::Stopped),
        };
    }
}

fn apply_preparer_command(
    command: PreparerCommand,
    active: &mut bool,
    pending: &mut Option<PreparedDsdEvent>,
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
    lease: DirectDsdLease,
    source_format: DirectDsdFormat,
    target_format: AlsaDsdFormat,
    recycle_tx: &mpsc::SyncSender<Vec<u8>>,
    recycle_rx: &mpsc::Receiver<Vec<u8>>,
) -> Result<PackedDsdBlock> {
    let frames = frames_from_bits(
        lease.bits_per_channel(),
        target_format.bits_per_channel_frame(),
    )?;
    let expected_bytes = frames
        .checked_mul(usize::from(source_format.channels))
        .and_then(|samples| samples.checked_mul(target_format.storage_bytes()))
        .context("ALSA Native DSD block 长度溢出")?;
    ensure!(
        lease.data().len() == expected_bytes,
        "Native DSD grouped payload 长度与 frame 数不一致"
    );
    let mut data = recycle_rx.try_recv().unwrap_or_default();
    data.resize(expected_bytes, 0);
    let written = pack_grouped_msb_dsd(
        lease.data(),
        source_format.channels,
        target_format,
        &mut data,
    )?;
    ensure!(written == expected_bytes, "ALSA Native DSD pack 长度不一致");
    let block = PackedDsdBlock {
        data: Some(data),
        frames,
        boundary: lease.boundary(),
        recycle_tx: recycle_tx.clone(),
    };
    drop(lease);
    Ok(block)
}

fn run_writer(
    handle: super::dsd::AlsaDsdHandle,
    input: DsdInput,
    state: &AlsaDirectDsdState,
    cancel: &AtomicBool,
    command_rx: mpsc::Receiver<WriterCommand>,
) -> Result<()> {
    let (pcm, config) = handle.into_parts();
    let frame_bytes = usize::from(config.channels)
        .checked_mul(config.format.storage_bytes())
        .context("ALSA Native DSD frame bytes 溢出")?;
    let mut writer = AlsaFrameWriter::from_pcm(pcm, frame_bytes, config.can_pause)?;
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
            let command = command_rx
                .recv()
                .context("ALSA Native DSD 控制通道已关闭")?;
            if handle_command(
                command,
                &mut writer,
                state,
                &mut playing,
                &mut hardware_paused,
                &mut pending_boundaries,
                &input,
                cancel,
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
                cancel,
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
            DsdInputPoll::Block(block) => {
                let submitted_before = state.submitted_frames.load(Ordering::Acquire);
                if let Some(boundary) = block.boundary() {
                    pending_boundaries.push_back(PendingBoundary {
                        frame: submitted_before,
                        boundary,
                    });
                }
                let expected_frames = block.frames(config.bits_per_channel_frame)?;
                let written = writer.write_all(block.data(), || cancel.load(Ordering::Acquire))?;
                ensure!(
                    written == expected_frames,
                    "ALSA Native DSD write frame 数与 source block 不一致"
                );
                state
                    .submitted_frames
                    .fetch_add(written as u64, Ordering::AcqRel);
                update_played(&writer, state, &mut pending_boundaries)?;
            }
            DsdInputPoll::Pending => {
                update_played(&writer, state, &mut pending_boundaries)?;
                thread::sleep(SOURCE_POLL_INTERVAL);
            }
            DsdInputPoll::Finished => {
                drain_to_end(&writer, state, &mut pending_boundaries, cancel)?;
                state.finished.store(true, Ordering::Release);
                state.playing.store(false, Ordering::Release);
                playing = false;
            }
            DsdInputPoll::Failed => {
                state.source_failed.store(true, Ordering::Release);
                bail!("Native DSD producer 失败");
            }
            DsdInputPoll::Stopped => return Ok(()),
        }
    }
}

fn handle_command(
    command: WriterCommand,
    writer: &mut AlsaFrameWriter,
    state: &AlsaDirectDsdState,
    playing: &mut bool,
    hardware_paused: &mut bool,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    input: &DsdInput,
    cancel: &AtomicBool,
) -> Result<bool> {
    match command {
        WriterCommand::Play(response) => {
            let result = (|| {
                ensure!(
                    !state.source_failed.load(Ordering::Acquire)
                        && !state.output_failed.load(Ordering::Acquire),
                    "ALSA Native DSD runtime 已失败"
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
                writer.pause(true).map(|_| *hardware_paused = true)
            } else if writer.can_pause() && writer.state() == State::Paused {
                *hardware_paused = true;
                Ok(())
            } else {
                drain_to_pause(writer, state, pending_boundaries, cancel)
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
                ensure!(!*playing, "ALSA Native DSD reset 要求先暂停");
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
    state: &AlsaDirectDsdState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    cancel: &AtomicBool,
) -> Result<()> {
    drain_stream(writer, state, pending_boundaries, cancel, false)?;
    writer.prepare()
}

fn drain_to_end(
    writer: &AlsaFrameWriter,
    state: &AlsaDirectDsdState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    cancel: &AtomicBool,
) -> Result<()> {
    // 自然 EOF 后 handle 即将释放，不再 prepare；此时 underrun 只表示已提交帧已被硬件吃空。
    drain_stream(writer, state, pending_boundaries, cancel, true)
}

fn drain_stream(
    writer: &AlsaFrameWriter,
    state: &AlsaDirectDsdState,
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
        ensure!(
            !cancel.load(Ordering::Acquire),
            "ALSA Native DSD drain 已取消"
        );
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
                ensure!(Instant::now() < deadline, "ALSA Native DSD drain 超时");
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
            Err(error) => return Err(anyhow::anyhow!(error).context("ALSA Native DSD drain 失败")),
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
    state: &AlsaDirectDsdState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
    submitted: u64,
) {
    state.played_frames.store(submitted, Ordering::Release);
    commit_boundaries(state, pending_boundaries, submitted);
}

fn update_played(
    writer: &AlsaFrameWriter,
    state: &AlsaDirectDsdState,
    pending_boundaries: &mut VecDeque<PendingBoundary>,
) -> Result<()> {
    let submitted = state.submitted_frames.load(Ordering::Acquire);
    let played = match writer.state() {
        State::Prepared | State::Setup | State::Open => state.played_frames.load(Ordering::Acquire),
        State::XRun => bail!("ALSA Native DSD XRUN"),
        _ => played_from_delay(submitted, writer.delay()?),
    };
    let previous = state.played_frames.load(Ordering::Acquire);
    let played = played.max(previous).min(submitted);
    state.played_frames.store(played, Ordering::Release);
    commit_boundaries(state, pending_boundaries, played);
    Ok(())
}

fn commit_boundaries(
    state: &AlsaDirectDsdState,
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

fn frames_from_bits(bits_per_channel: u64, bits_per_frame: u8) -> Result<usize> {
    let width = u64::from(bits_per_frame);
    ensure!(
        width > 0 && bits_per_channel.is_multiple_of(width),
        "Native DSD block 无法完整表达为 ALSA frame"
    );
    usize::try_from(bits_per_channel / width).context("Native DSD frame 数越界")
}

fn played_from_delay(submitted_frames: u64, delay_frames: alsa::pcm::Frames) -> u64 {
    let delay = u64::try_from(delay_frames.max(0)).unwrap_or(u64::MAX);
    submitted_frames.saturating_sub(delay)
}

fn duration_to_micros(duration_secs: f64) -> u64 {
    (duration_secs.max(0.0) * 1_000_000.0)
        .round()
        .clamp(0.0, u64::MAX as f64) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dsd_position_uses_logical_bits_not_alsa_frame_rate_label() {
        let state = Arc::new(AlsaDirectDsdState::new(1.0));
        state.played_frames.store(88_200, Ordering::Release);
        let monitor = AlsaDirectDsdMonitor {
            state,
            bit_rate: 2_822_400,
            bits_per_frame: 32,
        };
        assert!((monitor.position() - 1.0).abs() < f64::EPSILON);
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
    fn frame_count_rejects_partial_dsd_words() {
        assert_eq!(frames_from_bits(64, 32).unwrap(), 2);
        assert!(frames_from_bits(40, 32).is_err());
        assert_eq!(frames_from_bits(40, 8).unwrap(), 5);
    }

    #[test]
    fn monitor_keeps_source_and_output_failures_distinct() {
        let state = Arc::new(AlsaDirectDsdState::new(1.0));
        let monitor = AlsaDirectDsdMonitor {
            state: Arc::clone(&state),
            bit_rate: 2_822_400,
            bits_per_frame: 32,
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
    fn boundary_commits_only_after_dac_side_frame_position_reaches_it() {
        let state = AlsaDirectDsdState::new(1.0);
        let mut pending = VecDeque::from([PendingBoundary {
            frame: 100,
            boundary: DirectDsdBoundary {
                duration_micros: 2_000_000,
                generation: 11,
            },
        }]);
        commit_boundaries(&state, &mut pending, 99);
        assert_eq!(state.transition_count.load(Ordering::Acquire), 0);
        commit_boundaries(&state, &mut pending, 100);
        assert_eq!(state.transition_count.load(Ordering::Acquire), 1);
        assert_eq!(state.track_base_frame.load(Ordering::Acquire), 100);
        assert_eq!(state.boundary_generation.load(Ordering::Acquire), 11);
    }
}
