use std::sync::Arc;
use std::thread::JoinHandle;
#[cfg(feature = "diretta")]
use std::time::{Duration, Instant};

use ffmpeg_audio::HttpCancelHandle;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use tracing::{info, warn};

use crate::direct_runtime::{DirectFormat, DirectPlayback};
use crate::player::{self, AlsaPlaybackMode, InnerPlayer, PlayerEvent, PlayerState, SeekTake};
use crate::{audio_output, decoder, diretta, media_probe};

use super::IntoNapiResult;

/// async seek 阶段 2 的输出
enum SeekOutcome {
    /// seek 成功 + 已启动新解码线程
    Resumed {
        shared: Arc<crate::shared::Shared>,
        handle: JoinHandle<crate::decoder::DecoderData>,
        processed_stage: crate::decoder::ProcessedStageHandle,
    },
    /// seek 失败，需要 fallback 到完整 load
    Fallback,
}

/// load 被更新的 load/stop 取代时的标准错误标签与文案
const LOAD_SUPERSEDED_REASON: &str = "[Cancelled] load 已被更新的 load 取代";

#[derive(Clone)]
enum DirectLoadTarget {
    Alsa(String),
    Diretta(String),
}

impl DirectLoadTarget {
    fn is_diretta(&self) -> bool {
        matches!(self, Self::Diretta(_))
    }
}

#[cfg(feature = "diretta")]
const DIRECT_START_TIMEOUT: Duration = Duration::from_secs(2);

/// Diretta full reconnect 的 Target/DAC 格式稳定窗口。
/// 仅替换现存 DirectPlayback 时使用；同格式 staged/gapless 不经过此路径。
#[cfg(feature = "diretta")]
const DIRECT_FULL_RECONNECT_STABILIZATION: Duration = Duration::from_millis(800);

#[cfg(feature = "diretta")]
fn wait_for_direct_start(
    playback: &DirectPlayback,
    load_token: &Arc<std::sync::atomic::AtomicU64>,
    token: u64,
) -> anyhow::Result<bool> {
    let deadline = Instant::now() + DIRECT_START_TIMEOUT;
    loop {
        if load_token.load(std::sync::atomic::Ordering::Acquire) != token {
            anyhow::bail!(LOAD_SUPERSEDED_REASON);
        }
        if playback.failed() {
            anyhow::bail!("[Direct] Diretta 音源在首块消费前失败");
        }
        if playback.position() > playback.seek_base() {
            return Ok(true);
        }
        if playback.finished() {
            anyhow::bail!("[Direct] Diretta 音源在首块消费前结束");
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(feature = "diretta")]
fn open_verified_direct_playback(
    selector: &str,
    source: &str,
    duration_secs: f64,
    auto_play: bool,
    load_token: &Arc<std::sync::atomic::AtomicU64>,
    token: u64,
    cue_start_frame75: Option<u64>,
    cue_end_frame75: Option<u64>,
) -> anyhow::Result<DirectPlayback> {
    let mut playback = DirectPlayback::open_local(
        selector,
        source,
        duration_secs,
        0.0,
        auto_play,
        cue_start_frame75,
        cue_end_frame75,
    )?;
    if !auto_play {
        return Ok(playback);
    }
    match wait_for_direct_start(&playback, load_token, token) {
        Ok(true) => Ok(playback),
        Ok(false) => {
            let _ = playback.pause();
            drop(playback);
            anyhow::bail!("[Device] Diretta 连接未开始消费音频");
        }
        Err(error) => {
            let _ = playback.pause();
            drop(playback);
            Err(error)
        }
    }
}

fn open_direct_playback(
    target: &DirectLoadTarget,
    source: &str,
    duration_secs: f64,
    auto_play: bool,
    load_token: &Arc<std::sync::atomic::AtomicU64>,
    token: u64,
    cue_start_frame75: Option<u64>,
    cue_end_frame75: Option<u64>,
    fft: Arc<crate::fft::FftAnalyzer>,
) -> anyhow::Result<DirectPlayback> {
    match target {
        DirectLoadTarget::Alsa(selector) => DirectPlayback::open_alsa_local(
            selector,
            source,
            duration_secs,
            0.0,
            auto_play,
            cue_start_frame75,
            cue_end_frame75,
            fft,
        ),
        DirectLoadTarget::Diretta(selector) => {
            #[cfg(feature = "diretta")]
            {
                open_verified_direct_playback(
                    selector,
                    source,
                    duration_secs,
                    auto_play,
                    load_token,
                    token,
                    cue_start_frame75,
                    cue_end_frame75,
                )
            }
            #[cfg(not(feature = "diretta"))]
            {
                let _ = (
                    selector,
                    source,
                    duration_secs,
                    auto_play,
                    load_token,
                    token,
                    cue_start_frame75,
                    cue_end_frame75,
                );
                anyhow::bail!("[Direct] 当前 audio-engine 未编译 Diretta Host SDK 支持")
            }
        }
    }
}

/// 判断是否为取消/抢占错误
fn is_cancelled_napi_error(error: &Error) -> bool {
    error.reason.starts_with("[Cancelled]")
}

/// 一条外部歌词，返回给 JS 侧（仅格式和路径，内容按需加载）
#[napi(object)]
pub struct JsExternalLyric {
    /// 格式（如 "lrc", "ttml", "yrc", "qrc"）
    pub format: String,
    /// 文件路径
    pub path: String,
}

/// 歌曲完整元信息，返回给 JS 侧（load 时一次性返回）
#[napi(object)]
pub struct JsMusicMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 注释/副标题
    pub comment: Option<String>,
    /// 时长（秒）
    pub duration: f64,
    /// 播放采样率（重采样后）
    pub sample_rate: u32,
    /// 声道数
    pub channels: u32,
    /// 原始采样率（解码前，用于音质显示）
    pub original_sample_rate: u32,
    /// 位深（bits per sample）
    pub bits_per_sample: u32,
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 编码格式（如 "flac", "mp3", "aac"）
    pub codec: String,
    /// 内嵌歌词（从音频文件 tag 中读取）
    pub embedded_lyric: Option<String>,
    /// 同目录下找到的所有歌词文件
    pub external_lyrics: Vec<JsExternalLyric>,
    /// 封面缩略图路径（300x300，用于前端日常显示）
    pub cover: Option<String>,
}

/// 音频输出设备信息
#[napi(object)]
pub struct JsAudioDevice {
    /// 稳定设备 ID（Atom `alsa:hw:CARD=<id>,DEV=<n>` selector）
    pub id: String,
    /// 显示名
    pub name: String,
    /// Diretta Target 被发现时使用的本机网络接口名
    pub interface_name: Option<String>,
    /// 是否为系统默认设备
    pub is_default: bool,
}

/// FFT 双声道频谱数据
#[napi(object)]
pub struct JsFftData {
    pub ldata: Vec<f64>,
    pub rdata: Vec<f64>,
}

/// 播放器事件，推送给 JS 侧
#[napi(object)]
#[derive(Default)]
pub struct JsPlayerEvent {
    /// 事件类型："stateChanged" | "ended" | "directTrackBoundary" | "processedTrackBoundary" | "sourceError" | "position" | "fftData" | "outputStalled" | "outputFailed"
    #[napi(js_name = "type")]
    pub event_type: String,
    /// 状态（仅 stateChanged 时有值）
    pub state: Option<String>,
    /// 位置（秒，仅 position 时有值）
    pub position: Option<f64>,
    /// 时长（秒，仅 position/*TrackBoundary 时有值）
    pub duration: Option<f64>,
    /// staged generation（仅 *TrackBoundary 时有值）
    pub generation: Option<u32>,
    /// FFT 频谱数据（仅 fftData 时有值，128 个频段，值域 0.0 ~ 1.0）
    pub fft_data: Option<JsFftData>,
}

/// 播放器状态快照
#[napi(object)]
pub struct JsPlayerStatus {
    /// 播放状态："idle" | "playing" | "paused" | "stopped"
    pub state: String,
    /// 当前播放位置（秒）
    pub position: f64,
    /// 总时长（秒）
    pub duration: f64,
    /// 音量（0.0 ~ 1.0）
    pub volume: f64,
    /// 是否已播放完毕
    pub is_finished: bool,
    /// 实际 native 路径：exact-pcm | native-dsd | decoded-pcm | processed-pcm；空闲时无值。
    pub output_path: Option<String>,
    /// 当前 runtime 是否提供只读 PCM FFT；Native DSD / Diretta / 无 runtime 为 false。
    pub fft_available: bool,
}

/// PlayerState → JS 字符串
fn state_to_str(state: PlayerState) -> &'static str {
    match state {
        PlayerState::Idle => "idle",
        PlayerState::Playing => "playing",
        PlayerState::Paused => "paused",
        PlayerState::Stopped => "stopped",
    }
}

/// 音频播放器，通过 napi-rs 暴露给 Node.js
#[napi]
pub struct AudioPlayer {
    inner: Arc<Mutex<InnerPlayer>>,
}

#[napi]
impl AudioPlayer {
    /// 创建新的播放器实例
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = InnerPlayer::new().into_napi()?;
        info!("AudioPlayer 实例已创建");
        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
        })
    }

    /// 设置封面缓存目录（在 load 前调用一次即可）
    #[napi]
    pub fn set_cover_cache_dir(&self, dir: String) {
        self.inner.lock().set_cover_cache_dir(dir);
    }

    /// 注册事件回调，Rust 侧会在状态变化、位置更新、播放结束时主动调用
    #[napi(ts_args_type = "callback: (event: JsPlayerEvent) => void")]
    pub fn on_event(&self, callback: Function<JsPlayerEvent, ()>) -> Result<()> {
        let tsfn = callback
            .build_threadsafe_function()
            .weak::<true>()
            .build()?;

        // 用闭包包裹 tsfn，在内部做 PlayerEvent → JsPlayerEvent 转换
        let emitter: player::EventEmitter = Arc::new(move |event: PlayerEvent| {
            let js_event = match event {
                PlayerEvent::StateChanged { state } => JsPlayerEvent {
                    event_type: "stateChanged".into(),
                    state: Some(state_to_str(state).into()),
                    ..Default::default()
                },
                PlayerEvent::Ended => JsPlayerEvent {
                    event_type: "ended".into(),
                    ..Default::default()
                },
                PlayerEvent::DirectTrackBoundary {
                    duration,
                    generation,
                } => JsPlayerEvent {
                    event_type: "directTrackBoundary".into(),
                    duration: Some(duration),
                    generation: Some(u32::try_from(generation).unwrap_or(u32::MAX)),
                    ..Default::default()
                },
                PlayerEvent::ProcessedTrackBoundary {
                    duration,
                    generation,
                } => JsPlayerEvent {
                    event_type: "processedTrackBoundary".into(),
                    duration: Some(duration),
                    generation: u32::try_from(generation).ok(),
                    ..Default::default()
                },
                PlayerEvent::SourceError => JsPlayerEvent {
                    event_type: "sourceError".into(),
                    ..Default::default()
                },
                PlayerEvent::Position { position, duration } => JsPlayerEvent {
                    event_type: "position".into(),
                    position: Some(position),
                    duration: Some(duration),
                    ..Default::default()
                },
                PlayerEvent::FftData { ldata, rdata } => JsPlayerEvent {
                    event_type: "fftData".into(),
                    fft_data: Some(JsFftData {
                        ldata: ldata.into_iter().map(|v| v as f64).collect(),
                        rdata: rdata.into_iter().map(|v| v as f64).collect(),
                    }),
                    ..Default::default()
                },
                PlayerEvent::OutputStalled => JsPlayerEvent {
                    event_type: "outputStalled".into(),
                    ..Default::default()
                },
                PlayerEvent::OutputFailed => JsPlayerEvent {
                    event_type: "outputFailed".into(),
                    ..Default::default()
                },
            };
            tsfn.call(js_event, ThreadsafeFunctionCallMode::NonBlocking);
        });

        self.inner.lock().set_event_callback(emitter);
        Ok(())
    }

    /// 加载音频源，返回完整元信息（含封面路径和歌词）
    /// @param auto_play - 是否自动播放，false 时加载后立即暂停
    ///
    /// 异步三段式：
    /// 1. 主线程持锁瞬间（微秒级）：take 旧解码线程 handle + 拿参数（cover_dir / 归一化开关）
    /// 2. spawn_blocking 工作线程（**不持有 inner 引用**）：读取音源采样率、协商输出流并启动解码
    /// 3. 主线程持锁瞬间：提交输出流、构造 sink + attach + emit stateChanged
    /// 持锁阶段都是纯内存操作，主线程其它同步 NAPI 调用最多等几微秒，不会被 IO 卡住
    #[napi]
    pub async fn load(
        &self,
        source: String,
        #[napi(ts_arg_type = "boolean")] auto_play: Option<bool>,
        #[napi(ts_arg_type = "number")] cue_start_frame75: Option<u32>,
        #[napi(ts_arg_type = "number")] cue_end_frame75: Option<u32>,
    ) -> Result<JsMusicMetadata> {
        use crate::shared::Shared;

        let auto_play = auto_play.unwrap_or(true);
        info!(source = %source, auto_play, "加载音频源");

        let handle = HttpCancelHandle::new();
        let (
            old_threads,
            token,
            load_token,
            cover_dir,
            normalization_enabled,
            device_id,
            direct_target,
            output_generation,
            failure_callback,
            equalizer,
            tempo,
            fft,
        ) = {
            let mut player = self.inner.lock();
            let device_id = player.selected_device().map(String::from);
            let alsa_processed = player.alsa_playback_mode() == AlsaPlaybackMode::Processed
                && device_id
                    .as_deref()
                    .is_some_and(|value| crate::alsa::device::AlsaHwEndpoint::parse(value).is_ok());
            if alsa_processed && crate::direct_runtime::is_native_dsd_source(&source) {
                return Err(Error::from_reason(
                    "[Mode] Native DSD requires ALSA direct mode".to_string(),
                ));
            }
            let direct_target = device_id.as_deref().and_then(|value| {
                if diretta::selector_target(value).is_some() {
                    Some(DirectLoadTarget::Diretta(value.to_owned()))
                } else if player.alsa_direct_selected() {
                    Some(DirectLoadTarget::Alsa(value.to_owned()))
                } else {
                    None
                }
            });
            if direct_target
                .as_ref()
                .is_some_and(DirectLoadTarget::is_diretta)
            {
                #[cfg(not(feature = "diretta"))]
                return Err(Error::from_reason(
                    "[Direct] 当前 audio-engine 未编译 Diretta Host SDK 支持".to_string(),
                ));
            }
            let (old_threads, token) = player.take_for_async_load(handle.clone());
            let output_generation = player.reserve_output_generation();
            let failure_callback = player.make_failure_callback(output_generation);
            (
                old_threads,
                token,
                player.load_token_handle(),
                player.cover_cache_dir().map(String::from),
                player.is_normalization_enabled(),
                device_id,
                direct_target,
                output_generation,
                failure_callback,
                player.equalizer_handle(),
                player.tempo_handle(),
                player.fft_handle(),
            )
        };

        if let Some(target) = direct_target {
            let source_for_direct = source.clone();
            let load_token_for_direct = Arc::clone(&load_token);
            let cue_start_frame75 = cue_start_frame75.map(u64::from);
            let cue_end_frame75 = cue_end_frame75.map(u64::from);
            let result = tokio::task::spawn_blocking(move || {
                let replacing_diretta_playback = target.is_diretta()
                    && old_threads
                        .direct_playback
                        .as_ref()
                        .is_some_and(DirectPlayback::is_diretta);
                if let Some(h) = old_threads.join_aux() {
                    let _ = h.join();
                }
                #[cfg(feature = "diretta")]
                if replacing_diretta_playback {
                    std::thread::sleep(DIRECT_FULL_RECONNECT_STABILIZATION);
                }
                #[cfg(not(feature = "diretta"))]
                let _ = replacing_diretta_playback;
                if source_for_direct.starts_with("http://")
                    || source_for_direct.starts_with("https://")
                {
                    anyhow::bail!("[Direct] 当前 Direct Lifecycle Gate 仅支持本地 seekable 音源");
                }
                let mut metadata =
                    media_probe::probe_metadata(&source_for_direct, cover_dir.as_deref(), handle)?;
                if load_token_for_direct.load(std::sync::atomic::Ordering::Acquire) != token {
                    anyhow::bail!(LOAD_SUPERSEDED_REASON);
                }
                let playback = open_direct_playback(
                    &target,
                    &source_for_direct,
                    metadata.duration_secs,
                    auto_play,
                    &load_token_for_direct,
                    token,
                    cue_start_frame75,
                    cue_end_frame75,
                    fft,
                )?;
                match playback.format() {
                    DirectFormat::Pcm(format) => {
                        metadata.sample_rate = format.sample_rate;
                        metadata.original_sample_rate = format.sample_rate;
                        metadata.channels = format.channels;
                        metadata.bits_per_sample = u32::from(format.valid_bits);
                    }
                    DirectFormat::Dsd(format) => {
                        metadata.sample_rate = format.bit_rate;
                        metadata.original_sample_rate = format.bit_rate;
                        metadata.channels = format.channels;
                        metadata.bits_per_sample = 1;
                    }
                }
                metadata.duration_secs = playback.duration();
                if load_token_for_direct.load(std::sync::atomic::Ordering::Acquire) != token {
                    anyhow::bail!(LOAD_SUPERSEDED_REASON);
                }
                Ok::<_, anyhow::Error>((metadata, playback))
            })
            .await
            .map_err(|e| Error::from_reason(format!("direct load task join error: {e}")))?;

            let (metadata, playback) = match result {
                Ok(value) => value,
                Err(error) => {
                    let mut player = self.inner.lock();
                    if !player.is_load_token_current(token) {
                        return Err(Error::from_reason(LOAD_SUPERSEDED_REASON));
                    }
                    player.stop();
                    return Err(error).into_napi();
                }
            };

            let returned_meta = {
                let mut player = self.inner.lock();
                player
                    .commit_direct_loaded(token, &source, auto_play, metadata, playback)
                    .into_napi()?
            };
            return match returned_meta {
                Some(meta) => Ok(Self::meta_to_js(meta)),
                None => Err(Error::from_reason(LOAD_SUPERSEDED_REASON)),
            };
        }

        let source_for_decoder = source.clone();

        let result = tokio::task::spawn_blocking(move || {
            if let Some(h) = old_threads.join_aux() {
                let _ = h.join();
            }
            let prepared =
                decoder::prepare_decode(&source_for_decoder, cover_dir.as_deref(), handle)?;
            if load_token.load(std::sync::atomic::Ordering::Acquire) != token {
                anyhow::bail!(LOAD_SUPERSEDED_REASON);
            }
            // 输出采样率协商：音源原始采样率被设备支持时按精确采样率打开
            let output = audio_output::AudioOutput::new(
                device_id.as_deref(),
                Some(prepared.original_sample_rate()),
                Some(prepared.original_channels()),
                output_generation,
                failure_callback,
            )?;
            let shared = Shared::new(output.sample_rate(), output.channels());
            shared.set_normalization_enabled(normalization_enabled);
            equalizer
                .lock()
                .set_output_format(output.sample_rate(), output.channels());
            equalizer.lock().reset_state();
            tempo
                .lock()
                .set_output_format(output.sample_rate(), output.channels());
            tempo.lock().reset();
            let (metadata, decode_handle, cancel, processed_stage) =
                decoder::start_prepared_decode(prepared, Arc::clone(&shared), equalizer, tempo)?;
            Ok::<_, anyhow::Error>((
                metadata,
                decode_handle,
                processed_stage,
                shared,
                output,
                cancel,
            ))
        })
        .await
        .map_err(|e| Error::from_reason(format!("load task join error: {e}")))?;

        let (metadata, decode_handle, processed_stage, shared, output, cancel) = match result {
            Ok(result) => result,
            Err(error) => {
                let mut player = self.inner.lock();
                if !player.is_load_token_current(token) {
                    return Err(Error::from_reason(LOAD_SUPERSEDED_REASON));
                }
                player.clear_pending_load(token);
                return Err(error).into_napi();
            }
        };

        let returned_meta = {
            let mut player = self.inner.lock();
            player
                .commit_loaded(
                    token,
                    &source,
                    auto_play,
                    crate::player::LoadedPlayback {
                        metadata,
                        decode_handle,
                        processed_stage,
                        shared,
                        output,
                        cancel,
                    },
                )
                .into_napi()?
        };

        match returned_meta {
            Some(meta) => Ok(Self::meta_to_js(meta)),
            None => Err(Error::from_reason(LOAD_SUPERSEDED_REASON)),
        }
    }

    /// 内部：将 AudioMetadata 转为 JS 结构
    fn meta_to_js(meta: crate::metadata::AudioMetadata) -> JsMusicMetadata {
        JsMusicMetadata {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            comment: meta.comment,
            duration: meta.duration_secs,
            sample_rate: meta.sample_rate,
            channels: meta.channels as u32,
            original_sample_rate: meta.original_sample_rate,
            bits_per_sample: meta.bits_per_sample,
            bit_rate: meta.bit_rate,
            codec: meta.codec,
            embedded_lyric: meta.embedded_lyric,
            external_lyrics: meta
                .external_lyrics
                .into_iter()
                .map(|l| JsExternalLyric {
                    format: l.format,
                    path: l.path,
                })
                .collect(),
            cover: meta.cover,
        }
    }

    /// 恢复播放。如果已停止或播放结束，自动从头重新加载
    #[napi]
    pub async fn play(&self) -> Result<()> {
        let (revival_source, position) = {
            let mut player = self.inner.lock();
            let pos = player.position();
            let src = player.play().into_napi()?;
            (src, pos)
        };
        if let Some(source) = revival_source {
            let is_remote = source.starts_with("http://") || source.starts_with("https://");
            if let Err(e) = self.load(source, Some(true), None, None).await {
                // 复活加载被更新的 load/stop 取代不是错误：已有更新的操作接管播放
                if is_cancelled_napi_error(&e) {
                    return Ok(());
                }
                // 远端源复活失败（多半 URL 过期）：发 sourceError 交 JS 重解析（命中本地缓存 / 拿新 URL）
                if is_remote {
                    self.inner.lock().emit_source_error();
                    return Ok(());
                }
                return Err(e);
            }
            if position > 0.0 {
                let _ = self.seek(position).await;
            }
        }
        Ok(())
    }

    /// 暂停播放
    #[napi]
    pub fn pause(&self) -> Result<()> {
        self.inner.lock().pause().into_napi()
    }

    /// 输出故障后的恢复暂停：释放失效 runtime，保留当前 source/position 供用户手动恢复。
    #[napi]
    pub fn mark_output_unavailable(&self) {
        self.inner.lock().enter_paused_for_recovery();
    }

    /// 立即暂停播放，用于输出设备切换前阻止短暂串音
    #[napi]
    pub fn pause_immediately(&self) -> Result<()> {
        self.inner.lock().pause_immediately().into_napi()
    }

    /// 停止播放并释放资源
    #[napi]
    pub fn stop(&self) {
        self.inner.lock().stop();
    }

    /// 跳转到指定播放位置（秒）
    ///
    /// 异步三段式：与 load 同样的设计原则
    /// 1. 主线程瞬时持锁：take 旧解码线程 + 拿归一化参数
    /// 2. 工作线程：join 旧线程 → ffmpeg seek → resume_decode 启动新解码线程
    /// 3. 主线程瞬时持锁：attach 新 sink + emit 状态
    /// seek 失败时 fallback 到完整 load
    #[napi]
    pub async fn seek(&self, position: f64) -> Result<()> {
        use crate::shared::Shared;

        let direct_take = {
            let mut player = self.inner.lock();
            player.take_for_async_direct_seek().into_napi()?
        };
        if let Some(take) = direct_take {
            let token = take.token;
            let (playback, seek_result) = tokio::task::spawn_blocking(move || {
                let mut playback = take.playback;
                let result = playback.seek_while_paused(position);
                (playback, result)
            })
            .await
            .map_err(|e| Error::from_reason(format!("direct seek task join error: {e}")))?;

            let mut player = self.inner.lock();
            if !player.is_load_token_current(token) {
                return Ok(());
            }
            if let Err(error) = seek_result {
                player.enter_paused_for_recovery();
                let _ = player.commit_direct_seeked(token, playback).into_napi()?;
                return Err(error).into_napi();
            }
            let committed = player.commit_direct_seeked(token, playback).into_napi()?;
            if !committed {
                info!(
                    position,
                    "Direct seek 已被更新的 load/seek/stop 取代，丢弃结果"
                );
            }
            return Ok(());
        }

        let take = {
            let mut player = self.inner.lock();
            player.take_for_async_seek()
        };
        // 无解码线程：空闲 / 已停止 / 正在异步加载（句柄被 load 取走）。
        // 此时 seek 无意义，且绝不能走回退重载——current_source 仍指向旧曲，
        // 重载会顶掉在途的新歌加载、复活旧曲
        let Some(take) = take else {
            return Ok(());
        };

        let SeekTake {
            old_threads,
            normalization_enabled,
            normalization_gain,
            current_source,
            was_playing,
            original_sample_rate: _,
            output_sample_rate,
            output_channels,
            token,
            equalizer,
            tempo,
        } = take;

        let outcome: SeekOutcome = tokio::task::spawn_blocking(move || {
            let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());
            let mut decoder_data = match decoder_data {
                Some(d) => d,
                None => return SeekOutcome::Fallback,
            };
            if !decoder_data.seek(position) {
                return SeekOutcome::Fallback;
            }
            // 沿用实际输出流采样率，与复用的 DecoderData 重采样器目标一致
            let shared = Shared::new(output_sample_rate, output_channels);
            shared.set_normalization_enabled(normalization_enabled);
            shared.set_normalization_gain(normalization_gain);
            equalizer
                .lock()
                .set_output_format(output_sample_rate, output_channels);
            equalizer.lock().reset_state();
            tempo
                .lock()
                .set_output_format(output_sample_rate, output_channels);
            tempo.lock().reset();
            let (handle, processed_stage) =
                match decoder::resume_decode(decoder_data, Arc::clone(&shared), equalizer, tempo) {
                    Ok(result) => result,
                    Err(err) => {
                        warn!(error = %err, "seek 后启动解码线程失败，回退到重新加载");
                        return SeekOutcome::Fallback;
                    }
                };
            SeekOutcome::Resumed {
                shared,
                handle,
                processed_stage,
            }
        })
        .await
        .map_err(|e| Error::from_reason(format!("seek task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed {
                shared,
                handle,
                processed_stage,
            } => {
                let mut player = self.inner.lock();
                let committed = player
                    .commit_seeked(token, position, shared, handle, processed_stage, None)
                    .into_napi()?;
                if !committed {
                    info!(position, "seek 已被更新的 load/seek/stop 取代，丢弃结果");
                }
                Ok(())
            }
            SeekOutcome::Fallback => {
                // seek 期间已被新的 load/stop 取代时不再回退重载，避免复活旧源
                if !self.inner.lock().is_load_token_current(token) {
                    info!(position, "seek 失败且已被取代，跳过回退重载");
                    return Ok(());
                }
                if let Some(src) = current_source {
                    let is_remote = src.starts_with("http://") || src.starts_with("https://");
                    if let Err(e) = self.load(src, Some(was_playing), None, None).await {
                        if is_cancelled_napi_error(&e) {
                            return Ok(());
                        }
                        // 远端源回退重开失败（多半 URL 过期）：发 sourceError 交 JS 重解析
                        if is_remote {
                            self.inner.lock().emit_source_error();
                            return Ok(());
                        }
                        return Err(e);
                    }
                    Ok(())
                } else {
                    Err(Error::from_reason("seek 失败且无 current_source"))
                }
            }
        }
    }

    /// 只读取音源 metadata，不启动 normal playback/resampler/DSP。
    /// Direct gapless staging 用它提前保留本地歌词/封面 detail。
    #[napi]
    pub async fn probe_metadata(&self, source: String) -> Result<JsMusicMetadata> {
        let cover_dir = self.inner.lock().cover_cache_dir().map(String::from);
        let metadata = tokio::task::spawn_blocking(move || {
            media_probe::probe_metadata(&source, cover_dir.as_deref(), HttpCancelHandle::new())
        })
        .await
        .map_err(|error| Error::from_reason(format!("metadata probe task join error: {error}")))?
        .into_napi()?;
        Ok(Self::meta_to_js(metadata))
    }

    /// 为当前 Direct 播放预备一个同 wire-format 的本地下一音源。
    /// 返回 false 表示当前不是 Direct runtime；格式不兼容等 staging 错误会明确返回。
    #[napi]
    pub async fn stage_direct_next(
        &self,
        source: String,
        duration_secs: f64,
        generation: u32,
        #[napi(ts_arg_type = "number")] cue_start_frame75: Option<u32>,
        #[napi(ts_arg_type = "number")] cue_end_frame75: Option<u32>,
    ) -> Result<bool> {
        let Some(handle) = self.inner.lock().direct_stage_handle() else {
            return Ok(false);
        };
        let staged = tokio::task::spawn_blocking(move || {
            handle.stage_local(
                &source,
                duration_secs,
                u64::from(generation),
                cue_start_frame75.map(u64::from),
                cue_end_frame75.map(u64::from),
            )
        })
        .await
        .map_err(|error| {
            Error::from_reason(format!("direct gapless stage task join error: {error}"))
        })?
        .into_napi()?;
        Ok(staged)
    }

    /// 作废尚未进入音频 ring 的 Direct staged 下一音源。
    #[napi]
    pub fn cancel_direct_next(&self) {
        if let Some(handle) = self.inner.lock().direct_stage_handle() {
            handle.cancel();
        }
    }

    /// 为当前 processed PCM runtime 预备下一音源。
    ///
    /// 返回 null 表示当前没有 processed runtime，或准备结果已被更新的 preload/stop/seek 作废。
    /// source probe、reader 与 resampler 构建在 blocking 线程完成；真正音轨边界不在这里提交。
    #[napi]
    pub async fn stage_processed_next(
        &self,
        source: String,
        generation: u32,
    ) -> Result<Option<JsMusicMetadata>> {
        let (stage_handle, epoch, target_rate, target_channels, cover_dir) = {
            let player = self.inner.lock();
            if !player.processed_gapless_staging_allowed() {
                return Ok(None);
            }
            let Some(stage_handle) = player.processed_stage_handle() else {
                return Ok(None);
            };
            let epoch = stage_handle.begin_stage();
            (
                stage_handle,
                epoch,
                player.output_sample_rate(),
                player.output_channels(),
                player.cover_cache_dir().map(String::from),
            )
        };

        let source_for_stage = source.clone();
        let staged = tokio::task::spawn_blocking(move || {
            decoder::prepare_processed_stage(
                &source_for_stage,
                cover_dir.as_deref(),
                HttpCancelHandle::new(),
                target_rate,
                target_channels,
                u64::from(generation),
            )
        })
        .await
        .map_err(|error| {
            Error::from_reason(format!("processed gapless stage task join error: {error}"))
        })?
        .into_napi()?;
        let metadata = staged.metadata();
        if !stage_handle.stage_if_current(epoch, staged) {
            return Ok(None);
        }
        Ok(Some(Self::meta_to_js(metadata)))
    }

    /// 作废当前 processed next-track staging；不会触碰已经进入当前 decoder 的音轨。
    #[napi]
    pub fn cancel_processed_next(&self) {
        if let Some(handle) = self.inner.lock().processed_stage_handle() {
            handle.cancel();
        }
    }

    /// Core 在 processedTrackBoundary 后确认 authoritative queue/source 已推进。
    #[napi]
    pub fn commit_processed_gapless_boundary(
        &self,
        source: String,
        duration_secs: f64,
    ) -> Result<()> {
        self.inner
            .lock()
            .commit_processed_gapless_boundary(&source, duration_secs)
            .into_napi()
    }

    /// renderer 在 directTrackBoundary 后确认其 queue/media 已推进到实际正在播放的下一首。
    #[napi]
    pub fn commit_direct_gapless_boundary(
        &self,
        source: String,
        duration_secs: f64,
        #[napi(ts_arg_type = "number")] cue_start_frame75: Option<u32>,
        #[napi(ts_arg_type = "number")] cue_end_frame75: Option<u32>,
    ) -> Result<()> {
        self.inner
            .lock()
            .commit_direct_gapless_boundary(
                &source,
                duration_secs,
                cue_start_frame75.map(u64::from),
                cue_end_frame75.map(u64::from),
            )
            .into_napi()
    }

    /// 设置音量（0.0 ~ 1.0）
    #[napi]
    pub fn set_volume(&self, volume: f64) -> Result<()> {
        self.inner.lock().set_volume(volume as f32).into_napi()
    }

    /// 获取当前音量（0.0 ~ 1.0）
    #[napi]
    pub fn get_volume(&self) -> f64 {
        self.inner.lock().volume() as f64
    }

    /// 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用渐变
    #[napi]
    pub fn set_fade_duration(&self, duration_ms: f64) -> Result<()> {
        self.inner
            .lock()
            .set_fade_duration(duration_ms as u64)
            .into_napi()
    }

    /// 获取当前渐变时长（毫秒）
    #[napi]
    pub fn get_fade_duration(&self) -> f64 {
        self.inner.lock().fade_duration() as f64
    }

    /// 获取当前播放位置（秒）
    #[napi]
    pub fn get_position(&self) -> f64 {
        self.inner.lock().position()
    }

    /// 获取总时长（秒）
    #[napi]
    pub fn get_duration(&self) -> f64 {
        self.inner.lock().duration()
    }

    /// 获取当前播放状态快照
    #[napi]
    pub fn get_status(&self) -> JsPlayerStatus {
        let player = self.inner.lock();
        JsPlayerStatus {
            state: state_to_str(player.state()).to_string(),
            position: player.position(),
            duration: player.duration(),
            volume: player.volume() as f64,
            is_finished: player.is_finished(),
            output_path: player.output_path().map(String::from),
            fft_available: player.fft_available(),
        }
    }

    /// 启用/禁用 FFT 频谱推送（前端需要显示频谱时启用，不显示时禁用以节省性能）
    #[napi]
    pub fn set_fft_enabled(&self, enabled: bool) {
        self.inner.lock().set_fft_enabled(enabled);
    }

    /// 获取 FFT 推送开关状态
    #[napi]
    pub fn get_fft_enabled(&self) -> bool {
        self.inner.lock().fft_enabled()
    }

    /// 启用/禁用音量归一化（实时响度均衡）
    #[napi]
    pub fn set_normalization_enabled(&self, enabled: bool) -> Result<()> {
        self.inner
            .lock()
            .set_normalization_enabled(enabled)
            .into_napi()
    }

    /// 获取音量归一化开关状态
    #[napi]
    pub fn get_normalization_enabled(&self) -> bool {
        self.inner.lock().normalization_enabled()
    }

    /// 启用/禁用 Processed PCM 最终削波保护。
    #[napi]
    pub fn set_clipping_protection_enabled(&self, enabled: bool) -> Result<()> {
        self.inner
            .lock()
            .set_clipping_protection_enabled(enabled)
            .into_napi()
    }

    /// 获取 Processed PCM 最终削波保护开关。
    #[napi]
    pub fn get_clipping_protection_enabled(&self) -> bool {
        self.inner.lock().clipping_protection_enabled()
    }

    /// 启用/禁用 10 频段均衡器
    #[napi]
    pub fn set_equalizer_enabled(&self, enabled: bool) -> Result<()> {
        self.inner.lock().set_equalizer_enabled(enabled).into_napi()
    }

    /// 获取均衡器开关状态
    #[napi]
    pub fn get_equalizer_enabled(&self) -> bool {
        self.inner.lock().equalizer_enabled()
    }

    /// 更新均衡器各频段增益（dB），长度必须为 10，范围 [-15, 15]
    #[napi]
    pub fn set_equalizer_bands(&self, gains_db: Vec<f64>) -> Result<()> {
        let bands: Vec<f32> = gains_db.into_iter().map(|v| v as f32).collect();
        self.inner.lock().set_equalizer_bands(&bands).into_napi()
    }

    /// 获取均衡器各频段当前增益（dB）
    #[napi]
    pub fn get_equalizer_bands(&self) -> Vec<f64> {
        self.inner
            .lock()
            .equalizer_bands()
            .iter()
            .map(|v| *v as f64)
            .collect()
    }

    /// 设置前级增益（dB），范围 [-12, 12]
    #[napi]
    pub fn set_preamp_gain(&self, preamp_db: f64) -> Result<()> {
        self.inner
            .lock()
            .set_preamp_gain(preamp_db as f32)
            .into_napi()
    }

    /// 获取前级增益（dB）
    #[napi]
    pub fn get_preamp_gain(&self) -> f64 {
        self.inner.lock().preamp_gain() as f64
    }

    /// 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
    #[napi]
    pub fn get_fft_data(&self) -> JsFftData {
        let (ldata, rdata) = self.inner.lock().fft_data();
        let ldata = ldata.into_iter().map(|v| v as f64).collect();
        let rdata = rdata.into_iter().map(|v| v as f64).collect();
        JsFftData { ldata, rdata }
    }

    /// 返回 load 时缓存的原始封面数据（用于 SMTC / 全屏播放器）。
    /// 封面在 load 阶段从已打开的 FFmpeg 上下文一次性提取，不再重复打开文件。
    #[napi]
    pub fn get_cover_raw(&self) -> Option<napi::bindgen_prelude::Buffer> {
        let player = self.inner.lock();
        let data = player.cover_raw()?;
        Some(data.to_vec().into())
    }

    /// 获取所有音频输出设备列表
    #[napi]
    pub fn get_output_devices(&self) -> Vec<JsAudioDevice> {
        audio_output::list_output_devices()
            .into_iter()
            .map(|(id, name, is_default)| JsAudioDevice {
                id,
                name,
                interface_name: None,
                is_default,
            })
            .collect()
    }

    /// 异步扫描 Diretta Target，避免网络发现阻塞 ALSA 枚举或 Node 主线程。
    #[napi]
    pub async fn scan_diretta_devices(&self) -> Result<Vec<JsAudioDevice>> {
        let devices = tokio::task::spawn_blocking(diretta::scan_devices)
            .await
            .map_err(|error| {
                Error::from_reason(format!("Diretta device scan task join error: {error}"))
            })?
            .into_napi()?;
        Ok(devices
            .into_iter()
            .map(|device| JsAudioDevice {
                id: device.id,
                name: device.name,
                interface_name: device.interface_name,
                is_default: false,
            })
            .collect())
    }

    /// 切换输出设备；None/undefined 表示取消选择，不会跟随桌面默认设备。
    #[napi]
    pub async fn set_output_device(&self, device_id: Option<String>) -> Result<()> {
        #[cfg(not(feature = "diretta"))]
        let new_is_diretta = device_id
            .as_deref()
            .and_then(diretta::selector_target)
            .is_some();
        #[cfg(not(feature = "diretta"))]
        if new_is_diretta {
            return Err(Error::from_reason(
                "[Direct] 当前 audio-engine 未编译 Diretta Host SDK 支持".to_string(),
            ));
        }

        let mut player = self.inner.lock();
        if player.selected_device() == device_id.as_deref() {
            return Ok(());
        }
        player.set_output_device(device_id).into_napi()
    }

    /// 获取当前选择的输出设备 ID；None 表示尚未选择。
    #[napi]
    pub fn get_selected_device_name(&self) -> Option<String> {
        self.inner.lock().selected_device().map(String::from)
    }

    /// 设置 ALSA 后端模式偏好。活动 runtime 必须由 Core 先释放，禁止热路径翻转模式。
    #[napi]
    pub fn set_alsa_playback_mode(&self, mode: String) -> Result<()> {
        let mode = AlsaPlaybackMode::parse(&mode).into_napi()?;
        self.inner.lock().set_alsa_playback_mode(mode).into_napi()
    }

    /// 获取 ALSA 后端当前已提交的模式偏好。
    #[napi]
    pub fn get_alsa_playback_mode(&self) -> String {
        self.inner.lock().alsa_playback_mode().as_str().to_owned()
    }

    /// 设置播放速度（自动 clamp 到 [0.5, 2.0]）
    #[napi]
    pub fn set_speed(&self, speed: f64) -> Result<()> {
        self.inner.lock().set_speed(speed as f32).into_napi()
    }

    /// 设置音调偏移（半音，自动 clamp 到 [-12, 12]）
    #[napi]
    pub fn set_pitch(&self, semitones: i32) -> Result<()> {
        self.inner
            .lock()
            .set_pitch(semitones.clamp(-12, 12) as i8)
            .into_napi()
    }

    /// 设置"音调同步"开关（true = 变速保音调）
    #[napi]
    pub fn set_pitch_sync(&self, sync: bool) -> Result<()> {
        self.inner.lock().set_pitch_sync(sync).into_napi()
    }

    /// 获取当前播放速度
    #[napi]
    pub fn get_speed(&self) -> f64 {
        self.inner.lock().speed() as f64
    }

    /// 获取当前音调（半音）
    #[napi]
    pub fn get_pitch(&self) -> i32 {
        self.inner.lock().pitch() as i32
    }

    /// 获取"音调同步"开关状态
    #[napi]
    pub fn get_pitch_sync(&self) -> bool {
        self.inner.lock().pitch_sync()
    }
}
