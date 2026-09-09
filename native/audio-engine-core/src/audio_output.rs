//! 跨平台统一的音频输出（纯 cpal，无 rodio）。
//!
//! cpal 0.18 起各后端的 `Stream` 均为 `Send`，可直接由 `PlaybackHandle` 持有，
//! 无需再为 `!Send` 做专用线程隔离。`AudioOutput` 只负责解析输出设备与配置：
//! 设备采样率即播放重采样目标，每次加载/seek 音源时按该配置创建独立输出流。

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamConfig, SupportedStreamConfig};
use tracing::{debug, info, warn};

use crate::error::{AudioErrorKind, AudioResultExt};
use crate::source::DecoderSource;

/// 输出失败回调：实时错误线程调用，只允许发送轻量事件。
/// 禁止获取 `InnerPlayer` 锁、join 线程、枚举设备、创建新流或调用 NAPI async 方法。
pub type OutputFailureCallback = Arc<dyn Fn() + Send + Sync + 'static>;

/// 单次普通播放使用的 cpal 输出流。Diretta 必须走独立 Source Direct runtime。
pub enum PlaybackStream {
    Cpal(cpal::Stream),
}

enum OutputBackend {
    Cpal {
        device: cpal::Device,
        config: SupportedStreamConfig,
    },
}

/// 输出设备与配置句柄。`Send`，可放进 `InnerPlayer` 而不需 `unsafe impl Send`。
///
/// 不持有 `cpal::Stream`——输出流由每次加载音源时的 `PlaybackHandle::attach` 按此配置创建，
/// 因此切歌时无需跨线程移交流，也天然避免新旧流重叠占用设备。
pub struct AudioOutput {
    backend: OutputBackend,
    /// 该输出流的单调代次，用于诊断和过滤销毁后迟到的流错误
    generation: u64,
    on_failure: OutputFailureCallback,
}

impl AudioOutput {
    /// 解析输出设备与配置
    ///
    /// # Arguments
    /// * `device_id` - 输出设备 ID，`None` 走系统默认设备；Diretta selector 会明确拒绝，
    ///   因为 Diretta 只能由 Source Direct runtime 打开
    /// * `requested_sample_rate` - 期望输出采样率；设备支持时按此速率打开（音源精确采样率），
    ///   否则回退到设备默认配置。`None` 表示直接用设备默认配置
    /// * `generation` - 输出流单调代次，见 [`AudioOutput`] 字段说明
    /// * `on_failure` - 运行期流错误回调，见 [`OutputFailureCallback`]
    ///
    /// # Errors
    /// - 找不到指定设备
    /// - 无可用音频设备
    /// - 错误地把 Diretta selector 送入普通 f32 输出路径
    pub fn new(
        device_id: Option<&str>,
        requested_sample_rate: Option<u32>,
        generation: u64,
        on_failure: OutputFailureCallback,
    ) -> Result<Self> {
        let backend = open_backend(device_id, requested_sample_rate, &on_failure)
            .with_audio_kind(AudioErrorKind::Device)?;
        let OutputBackend::Cpal { device, config } = &backend;
        info!(
            id = device_id_string(device).as_deref().unwrap_or("-"),
            name = %device,
            sample_rate = config.sample_rate(),
            "打开音频输出配置"
        );
        Ok(Self {
            backend,
            generation,
            on_failure,
        })
    }

    /// 实际输出流采样率（播放重采样目标）
    pub fn sample_rate(&self) -> u32 {
        let OutputBackend::Cpal { config, .. } = &self.backend;
        config.sample_rate()
    }

    /// 实际输出流声道数
    pub fn channels(&self) -> u16 {
        let OutputBackend::Cpal { config, .. } = &self.backend;
        config.channels()
    }

    /// 按本配置创建一次普通播放输出流，实时回调从 `source` 拉取样本。
    pub(crate) fn build_stream(
        &self,
        source: DecoderSource,
        volume: Arc<AtomicU32>,
        stopped: Arc<AtomicBool>,
    ) -> Result<PlaybackStream> {
        let OutputBackend::Cpal { device, config } = &self.backend;
        let device = device.clone();
        let config = config.clone();
        let on_failure = Arc::clone(&self.on_failure);
        run_in_mta(move || {
            build_typed_stream_for_format(&device, &config, source, volume, stopped, on_failure)
        })
        .with_audio_kind(AudioErrorKind::Device)
        .map(PlaybackStream::Cpal)
    }
}

impl Drop for AudioOutput {
    fn drop(&mut self) {
        debug!(generation = self.generation, "释放音频输出配置");
    }
}

/// 按设备选择器构建普通 cpal 输出后端。Diretta 不允许进入 f32/DSP pipeline。
fn open_backend(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
    _on_failure: &OutputFailureCallback,
) -> Result<OutputBackend> {
    if device_id.is_some_and(|selector| selector.starts_with("diretta:")) {
        return Err(anyhow!(
            "[Direct] Diretta selector 必须通过 Source Direct runtime"
        ));
    }
    let (device, config) = open_device(device_id, requested_sample_rate)?;
    Ok(OutputBackend::Cpal { device, config })
}

fn run_in_mta<T, F: FnOnce() -> Result<T>>(f: F) -> Result<T> {
    f()
}

/// 设备显示名：cpal 0.18 起 `Device::name()` 并入 `description().name()`。
/// 可能重复、可被用户改名，只用于展示和旧配置回退匹配
fn persisted_device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|desc| desc.name().to_owned())
}

/// ALSA 设备稳定 ID，跨重启和改名保持可用于持久化选择。
fn device_id_string(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

/// 按选择器查找输出设备，优先按稳定 ID 匹配，失败后回退到显示名。
///
/// 回退是为 1.0.0 及更早版本存下的显示名配置准备的：命中后由 JS 侧改写成 ID。
/// 显示名可能重复，回退路径取首个匹配，因此仅用于迁移，不作为长期身份。
fn find_device(host: &cpal::Host, selector: &str) -> Option<cpal::Device> {
    if let Ok(parsed) = selector.parse::<cpal::DeviceId>() {
        return host.device_by_id(&parsed);
    }
    host.output_devices()
        .ok()?
        .find(|device| persisted_device_name(device).as_deref() == Some(selector))
}

/// 枚举所有输出设备，返回 `(id, name, is_default)` 列表
/// 纯查询，不涉及流状态，调用方任意线程都能用
pub fn list_output_devices() -> Vec<(String, String, bool)> {
    run_in_mta(|| {
        let host = cpal::default_host();
        let default_id = host
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        let list = host
            .output_devices()
            .map(|devices| {
                devices
                    .filter_map(|device| {
                        let name = persisted_device_name(&device)?;
                        let id = device_id_string(&device)?;
                        let is_default = default_id.as_deref() == Some(id.as_str());
                        Some((id, name, is_default))
                    })
                    .collect()
            })
            .unwrap_or_default();
        debug!(
            default_id = default_id.as_deref().unwrap_or("-"),
            devices = ?list,
            "枚举音频输出设备"
        );
        Ok(list)
    })
    .unwrap_or_default()
}

/// 取系统默认输出设备名
pub fn default_device_name() -> Option<String> {
    run_in_mta(|| {
        let name = cpal::default_host()
            .default_output_device()
            .and_then(|device| persisted_device_name(&device));
        Ok(name)
    })
    .unwrap_or_default()
}

/// 取系统默认输出设备稳定 ID，供主进程做切换检测（显示名可重复、可被改名）
pub fn default_device_id() -> Option<String> {
    run_in_mta(|| {
        let id = cpal::default_host()
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        Ok(id)
    })
    .unwrap_or_default()
}

/// 按设备 ID（`None` 为默认设备）解析设备与输出配置。
/// 设备支持 `requested_sample_rate` 时按该速率打开，否则使用设备默认配置。
/// 样本格式优先沿用设备默认格式，避免错误选择设备并不期望的样本格式。
fn open_device_internal(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
) -> Result<(cpal::Device, SupportedStreamConfig)> {
    let host = cpal::default_host();
    let device = match device_id {
        Some(selector) => {
            find_device(&host, selector).with_context(|| format!("输出设备 '{selector}' 不存在"))?
        }
        None => {
            let default = host.default_output_device().context("没有可用的输出设备")?;
            let default_id = device_id_string(&default).context("读取默认输出设备 ID 失败")?;
            find_device(&host, &default_id).context("解析默认输出设备端点失败")?
        }
    };
    let default_config = device
        .default_output_config()
        .context("读取输出设备配置失败")?;
    let config = match requested_sample_rate {
        Some(rate) => {
            if rate == default_config.sample_rate() {
                default_config
            } else {
                let default_format = default_config.sample_format();
                let default_channels = default_config.channels();
                let at_rate = device.supported_output_configs().ok().and_then(|configs| {
                    let configs: Vec<_> = configs.collect();
                    configs
                        .iter()
                        .copied()
                        .find(|range| {
                            range.min_sample_rate() <= rate
                                && rate <= range.max_sample_rate()
                                && range.sample_format() == default_format
                                && range.channels() == default_channels
                        })
                        .or_else(|| {
                            configs.iter().copied().find(|range| {
                                range.min_sample_rate() <= rate
                                    && rate <= range.max_sample_rate()
                                    && range.sample_format() == default_format
                            })
                        })
                        .or_else(|| {
                            configs.iter().copied().find(|range| {
                                range.min_sample_rate() <= rate
                                    && rate <= range.max_sample_rate()
                                    && range.channels() == default_channels
                            })
                        })
                        .or_else(|| {
                            configs.iter().copied().find(|range| {
                                range.min_sample_rate() <= rate && rate <= range.max_sample_rate()
                            })
                        })
                        .map(|range| range.with_sample_rate(rate))
                });
                at_rate.unwrap_or(default_config)
            }
        }
        None => default_config,
    };
    Ok((device, config))
}

fn open_device(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
) -> Result<(cpal::Device, SupportedStreamConfig)> {
    let id_owned = device_id.map(String::from);
    run_in_mta(move || open_device_internal(id_owned.as_deref(), requested_sample_rate))
}

/// 按样本格式分发到类型化构建
fn build_typed_stream_for_format(
    device: &cpal::Device,
    config: &SupportedStreamConfig,
    source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    on_failure: OutputFailureCallback,
) -> Result<cpal::Stream> {
    let sample_format = config.sample_format();
    let config: StreamConfig = config.config();
    macro_rules! build {
        ($sample:ty) => {
            build_typed_stream::<$sample>(device, config, source, volume, stopped, on_failure)
        };
    }
    match sample_format {
        SampleFormat::I8 => build!(i8),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I24 => build!(cpal::I24),
        SampleFormat::I32 => build!(i32),
        SampleFormat::I64 => build!(i64),
        SampleFormat::U8 => build!(u8),
        SampleFormat::U16 => build!(u16),
        SampleFormat::U32 => build!(u32),
        SampleFormat::U64 => build!(u64),
        SampleFormat::F32 => build!(f32),
        SampleFormat::F64 => build!(f64),
        _ => Err(anyhow!("不支持的输出样本格式: {sample_format}")),
    }
}

fn build_typed_stream<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    on_failure: OutputFailureCallback,
) -> Result<cpal::Stream>
where
    T: SizedSample + Sample + FromSample<f32>,
{
    let stream = device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            let gain = f32::from_bits(volume.load(Ordering::Relaxed));
            if stopped.load(Ordering::Acquire) {
                data.fill(T::EQUILIBRIUM);
                return;
            }
            for output in data {
                *output = T::from_sample(source.next().unwrap_or(0.0) * gain);
            }
        },
        move |error| {
            warn!(%error, "音频输出流失败");
            on_failure();
        },
        None,
    )?;
    Ok(stream)
}
