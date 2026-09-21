use std::path::Path;

use anyhow::{bail, Result};

use crate::alsa::device::AlsaHwEndpoint;
use crate::alsa::direct_dsd::{AlsaDirectDsdConnection, AlsaDirectDsdMonitor};
use crate::alsa::direct_pcm::{AlsaDirectPcmConnection, AlsaDirectPcmMonitor};
use crate::direct_dsd::{DirectDsdFormat, DirectDsdStageHandle};
use crate::direct_pcm::{DirectPcmFormat, DirectPcmStageHandle};

#[cfg(feature = "diretta")]
use crate::direct_dsd::DirectDsdMonitor;
#[cfg(feature = "diretta")]
use crate::direct_pcm::DirectPcmMonitor;

#[cfg(feature = "diretta")]
use crate::diretta::{DirettaDirectConnection, DirettaDirectDsdConnection};

fn direct_segment_duration_secs(
    physical_duration_secs: f64,
    start_frame75: Option<u64>,
    end_frame75: Option<u64>,
) -> f64 {
    match (start_frame75, end_frame75) {
        (Some(start), Some(end)) if end > start => (end - start) as f64 / 75.0,
        (Some(start), None) => (physical_duration_secs - start as f64 / 75.0).max(0.0),
        _ => physical_duration_secs.max(0.0),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectFormat {
    Pcm(DirectPcmFormat),
    Dsd(DirectDsdFormat),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectFailureKind {
    Source,
    Output,
}

#[derive(Clone)]
pub enum DirectMonitor {
    AlsaPcm(AlsaDirectPcmMonitor),
    AlsaDsd(AlsaDirectDsdMonitor),
    #[cfg(feature = "diretta")]
    DirettaPcm(DirectPcmMonitor),
    #[cfg(feature = "diretta")]
    DirettaDsd(DirectDsdMonitor),
    #[cfg(test)]
    Fake(std::sync::Arc<FakeDirectState>),
}

impl DirectMonitor {
    pub fn consumed_position(&self) -> f64 {
        match self {
            Self::AlsaPcm(value) => value.position(),
            Self::AlsaDsd(value) => value.position(),
            #[cfg(feature = "diretta")]
            Self::DirettaPcm(value) => value.consumed_position(),
            #[cfg(feature = "diretta")]
            Self::DirettaDsd(value) => value.consumed_position(),
            #[cfg(test)]
            Self::Fake(value) => {
                value
                    .position_micros
                    .load(std::sync::atomic::Ordering::Acquire) as f64
                    / 1_000_000.0
            }
        }
    }

    pub fn failure_kind(&self) -> Option<DirectFailureKind> {
        match self {
            Self::AlsaPcm(value) => {
                if value.source_failed() {
                    Some(DirectFailureKind::Source)
                } else if value.output_failed() {
                    Some(DirectFailureKind::Output)
                } else {
                    None
                }
            }
            Self::AlsaDsd(value) => {
                if value.source_failed() {
                    Some(DirectFailureKind::Source)
                } else if value.output_failed() {
                    Some(DirectFailureKind::Output)
                } else {
                    None
                }
            }
            #[cfg(feature = "diretta")]
            Self::DirettaPcm(value) => value.failed().then_some(DirectFailureKind::Source),
            #[cfg(feature = "diretta")]
            Self::DirettaDsd(value) => value.failed().then_some(DirectFailureKind::Source),
            #[cfg(test)]
            Self::Fake(value) => value
                .failed
                .load(std::sync::atomic::Ordering::Acquire)
                .then_some(DirectFailureKind::Source),
        }
    }

    pub fn failed(&self) -> bool {
        self.failure_kind().is_some()
    }

    pub fn finished(&self) -> bool {
        match self {
            Self::AlsaPcm(value) => value.finished(),
            Self::AlsaDsd(value) => value.finished(),
            #[cfg(feature = "diretta")]
            Self::DirettaPcm(value) => value.finished(),
            #[cfg(feature = "diretta")]
            Self::DirettaDsd(value) => value.finished(),
            #[cfg(test)]
            Self::Fake(value) => value.finished.load(std::sync::atomic::Ordering::Acquire),
        }
    }

    pub fn transition_count(&self) -> u64 {
        match self {
            Self::AlsaPcm(value) => value.transition_count(),
            Self::AlsaDsd(value) => value.transition_count(),
            #[cfg(feature = "diretta")]
            Self::DirettaPcm(value) => value.transition_count(),
            #[cfg(feature = "diretta")]
            Self::DirettaDsd(value) => value.transition_count(),
            #[cfg(test)]
            Self::Fake(_) => 0,
        }
    }

    pub fn duration(&self) -> f64 {
        match self {
            Self::AlsaPcm(value) => value.duration(),
            Self::AlsaDsd(value) => value.duration(),
            #[cfg(feature = "diretta")]
            Self::DirettaPcm(value) => value.duration(),
            #[cfg(feature = "diretta")]
            Self::DirettaDsd(value) => value.duration(),
            #[cfg(test)]
            Self::Fake(_) => 0.0,
        }
    }

    pub fn boundary_generation(&self) -> u64 {
        match self {
            Self::AlsaPcm(value) => value.boundary_generation(),
            Self::AlsaDsd(value) => value.boundary_generation(),
            #[cfg(feature = "diretta")]
            Self::DirettaPcm(value) => value.boundary_generation(),
            #[cfg(feature = "diretta")]
            Self::DirettaDsd(value) => value.boundary_generation(),
            #[cfg(test)]
            Self::Fake(_) => 0,
        }
    }
}

pub fn is_native_dsd_source(source: &str) -> bool {
    if crate::sacd::parse_sacd_virtual_path(source).is_some() {
        return true;
    }
    let path = source.split(['?', '#']).next().unwrap_or(source);
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(extension.as_str(), "dsf" | "dff" | "dsdiff")
}

#[derive(Clone)]
pub enum DirectStageHandle {
    Pcm(DirectPcmStageHandle),
    Dsd(DirectDsdStageHandle),
}

impl DirectStageHandle {
    pub fn stage_local(
        &self,
        source: &str,
        duration_secs: f64,
        generation: u64,
        start_frame75: Option<u64>,
        end_frame75: Option<u64>,
    ) -> Result<bool> {
        if source.starts_with("http://") || source.starts_with("https://") {
            bail!("[Direct] 当前 gapless staging 仅支持本地 seekable 音源");
        }
        let path = Path::new(source);
        let native_dsd = is_native_dsd_source(source);
        match self {
            Self::Pcm(value) => {
                if native_dsd {
                    bail!("[Direct] PCM → Native DSD 需要重新协商 transport");
                }
                value.stage_local(path, duration_secs, generation, start_frame75, end_frame75)
            }
            Self::Dsd(value) => {
                if !native_dsd {
                    bail!("[Direct] Native DSD → PCM 需要重新协商 transport");
                }
                value.stage_local(path, duration_secs, generation, start_frame75, end_frame75)
            }
        }
    }

    pub fn cancel(&self) {
        match self {
            Self::Pcm(value) => value.cancel(),
            Self::Dsd(value) => value.cancel(),
        }
    }
}

enum DirectTransport {
    AlsaPcm(AlsaDirectPcmConnection),
    AlsaDsd(AlsaDirectDsdConnection),
    #[cfg(feature = "diretta")]
    DirettaPcm(DirettaDirectConnection),
    #[cfg(feature = "diretta")]
    DirettaDsd(DirettaDirectDsdConnection),
    #[cfg(test)]
    Fake(std::sync::Arc<FakeDirectState>),
}

#[cfg(test)]
#[derive(Default)]
pub struct FakeDirectState {
    position_micros: std::sync::atomic::AtomicU64,
    playing: std::sync::atomic::AtomicBool,
    failed: std::sync::atomic::AtomicBool,
    finished: std::sync::atomic::AtomicBool,
}

#[cfg(test)]
impl FakeDirectState {
    pub fn set_position(&self, position: f64) {
        self.position_micros.store(
            (position.max(0.0) * 1_000_000.0) as u64,
            std::sync::atomic::Ordering::Release,
        );
    }

    pub fn playing(&self) -> bool {
        self.playing.load(std::sync::atomic::Ordering::Acquire)
    }

    pub fn set_failed(&self, failed: bool) {
        self.failed
            .store(failed, std::sync::atomic::Ordering::Release);
    }

    pub fn set_finished(&self, finished: bool) {
        self.finished
            .store(finished, std::sync::atomic::Ordering::Release);
    }
}

pub struct DirectPlayback {
    duration: f64,
    seek_base: f64,
    seek_transition_count: u64,
    cue_start_frame75: Option<u64>,
    cue_end_frame75: Option<u64>,
    source: String,
    transport: DirectTransport,
}

impl DirectPlayback {
    pub fn open_alsa_local(
        selector: &str,
        source: &str,
        duration: f64,
        position_secs: f64,
        auto_play: bool,
        cue_start_frame75: Option<u64>,
        cue_end_frame75: Option<u64>,
    ) -> Result<Self> {
        if source.starts_with("http://") || source.starts_with("https://") {
            bail!("[Direct] 当前 Direct Lifecycle Gate 仅支持本地 seekable 音源");
        }
        let endpoint = AlsaHwEndpoint::parse(selector)?;
        let path = Path::new(source);
        let native_dsd = is_native_dsd_source(source);
        let direct_duration =
            direct_segment_duration_secs(duration, cue_start_frame75, cue_end_frame75);

        let (transport, seek_base) = if native_dsd {
            let (connection, actual_position) = if let Some(start_frame75) = cue_start_frame75 {
                AlsaDirectDsdConnection::open_local_segment(
                    &endpoint,
                    path,
                    direct_duration,
                    start_frame75,
                    cue_end_frame75,
                    false,
                )?
            } else {
                AlsaDirectDsdConnection::open_local_at(
                    &endpoint,
                    path,
                    direct_duration,
                    position_secs,
                    false,
                )?
            };
            (DirectTransport::AlsaDsd(connection), actual_position)
        } else {
            let (connection, actual_position) = if let Some(start_frame75) = cue_start_frame75 {
                AlsaDirectPcmConnection::open_local_segment(
                    &endpoint,
                    path,
                    direct_duration,
                    start_frame75,
                    cue_end_frame75,
                    false,
                )?
            } else {
                AlsaDirectPcmConnection::open_local_at(
                    &endpoint,
                    path,
                    direct_duration,
                    position_secs,
                    false,
                )?
            };
            (DirectTransport::AlsaPcm(connection), actual_position)
        };

        let mut playback = Self {
            duration: direct_duration,
            seek_base,
            seek_transition_count: 0,
            cue_start_frame75,
            cue_end_frame75,
            source: source.to_owned(),
            transport,
        };
        if auto_play {
            playback.play()?;
        }
        Ok(playback)
    }

    #[cfg(feature = "diretta")]
    pub fn open_local(
        selector: &str,
        source: &str,
        duration: f64,
        position_secs: f64,
        auto_play: bool,
        cue_start_frame75: Option<u64>,
        cue_end_frame75: Option<u64>,
    ) -> Result<Self> {
        if source.starts_with("http://") || source.starts_with("https://") {
            bail!("[Direct] 当前 Direct Lifecycle Gate 仅支持本地 seekable 音源");
        }
        let path = Path::new(source);
        let native_dsd = is_native_dsd_source(source);
        let direct_duration =
            direct_segment_duration_secs(duration, cue_start_frame75, cue_end_frame75);

        let (transport, seek_base) = if native_dsd {
            let (connection, actual_position) = if let Some(start_frame75) = cue_start_frame75 {
                DirettaDirectDsdConnection::open_local_segment(
                    selector,
                    path,
                    start_frame75,
                    cue_end_frame75,
                    direct_duration,
                )?
            } else {
                DirettaDirectDsdConnection::open_local_at(selector, path, position_secs)?
            };
            (DirectTransport::DirettaDsd(connection), actual_position)
        } else {
            let (connection, actual_position) = if let Some(start_frame75) = cue_start_frame75 {
                DirettaDirectConnection::open_local_segment(
                    selector,
                    path,
                    start_frame75,
                    cue_end_frame75,
                )?
            } else {
                DirettaDirectConnection::open_local_at(selector, path, position_secs)?
            };
            connection.set_duration(direct_duration);
            (DirectTransport::DirettaPcm(connection), actual_position)
        };

        let duration = match &transport {
            DirectTransport::DirettaDsd(value) => value.monitor().duration(),
            _ => direct_duration,
        };
        let mut playback = Self {
            duration,
            seek_base,
            seek_transition_count: 0,
            cue_start_frame75,
            cue_end_frame75,
            source: source.to_owned(),
            transport,
        };
        if auto_play {
            playback.play()?;
        }
        Ok(playback)
    }

    pub fn handoff_local_while_paused(
        &mut self,
        source: &str,
        duration: f64,
    ) -> Result<DirectFormat> {
        let path = Path::new(source);
        let native_dsd = is_native_dsd_source(source);
        let format = match &mut self.transport {
            DirectTransport::AlsaPcm(value) => {
                if native_dsd {
                    bail!("[Direct] PCM → Native DSD 需要重新协商 ALSA transport");
                }
                DirectFormat::Pcm(value.replace_local_while_paused(path, duration)?)
            }
            DirectTransport::AlsaDsd(value) => {
                if !native_dsd {
                    bail!("[Direct] Native DSD → PCM 需要重新协商 ALSA transport");
                }
                DirectFormat::Dsd(value.replace_local_while_paused(path, duration)?)
            }
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(value) => {
                if native_dsd {
                    bail!("[Direct] PCM → Native DSD 需要重新协商 Diretta connection");
                }
                let format = value.replace_local_source_while_paused(path)?;
                value.set_duration(duration);
                DirectFormat::Pcm(format)
            }
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => {
                if !native_dsd {
                    bail!("[Direct] Native DSD → PCM 需要重新协商 Diretta connection");
                }
                DirectFormat::Dsd(value.replace_local_source_while_paused(path)?)
            }
            #[cfg(test)]
            DirectTransport::Fake(_) => self.format(),
        };
        self.source = source.to_owned();
        self.duration = match &self.transport {
            DirectTransport::AlsaPcm(value) => value.monitor().duration(),
            DirectTransport::AlsaDsd(value) => value.monitor().duration(),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(_) => duration,
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => value.monitor().duration(),
            #[cfg(test)]
            DirectTransport::Fake(_) => duration,
        };
        self.seek_base = 0.0;
        self.seek_transition_count = self.monitor().transition_count();
        self.cue_start_frame75 = None;
        self.cue_end_frame75 = None;
        Ok(format)
    }

    pub fn seek_while_paused(&mut self, position_secs: f64) -> Result<f64> {
        let actual_position = match &mut self.transport {
            DirectTransport::AlsaPcm(value) => match self.cue_start_frame75 {
                Some(start) => value.seek_segment_while_paused(
                    start,
                    self.cue_end_frame75,
                    position_secs,
                    self.duration,
                )?,
                None => value.seek_while_paused(position_secs)?,
            },
            DirectTransport::AlsaDsd(value) => match self.cue_start_frame75 {
                Some(start) => value.seek_segment_while_paused(
                    start,
                    self.cue_end_frame75,
                    position_secs,
                    self.duration,
                )?,
                None => value.seek_while_paused(position_secs)?,
            },
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(value) => match self.cue_start_frame75 {
                Some(start) => {
                    value.seek_segment_while_paused(start, self.cue_end_frame75, position_secs)?
                }
                None => value.seek_while_paused(position_secs)?,
            },
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => match self.cue_start_frame75 {
                Some(start) => {
                    value.seek_segment_while_paused(start, self.cue_end_frame75, position_secs)?
                }
                None => value.seek_while_paused(position_secs)?,
            },
            #[cfg(test)]
            DirectTransport::Fake(value) => {
                value
                    .position_micros
                    .store(0, std::sync::atomic::Ordering::Release);
                position_secs
            }
        };
        self.seek_base = actual_position;
        self.seek_transition_count = self.monitor().transition_count();
        Ok(actual_position)
    }

    pub fn play(&mut self) -> Result<()> {
        match &mut self.transport {
            DirectTransport::AlsaPcm(value) => value.play(),
            DirectTransport::AlsaDsd(value) => value.play(),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(value) => value.play(),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => value.play(),
            #[cfg(test)]
            DirectTransport::Fake(value) => {
                value
                    .playing
                    .store(true, std::sync::atomic::Ordering::Release);
                Ok(())
            }
        }
    }

    pub fn pause(&mut self) -> Result<()> {
        match &mut self.transport {
            DirectTransport::AlsaPcm(value) => value.pause(),
            DirectTransport::AlsaDsd(value) => value.pause(),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(value) => value.pause(),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => value.pause(),
            #[cfg(test)]
            DirectTransport::Fake(value) => {
                value
                    .playing
                    .store(false, std::sync::atomic::Ordering::Release);
                Ok(())
            }
        }
    }

    pub fn format(&self) -> DirectFormat {
        match &self.transport {
            DirectTransport::AlsaPcm(value) => DirectFormat::Pcm(value.format()),
            DirectTransport::AlsaDsd(value) => DirectFormat::Dsd(value.format()),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(value) => DirectFormat::Pcm(value.format()),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => DirectFormat::Dsd(value.format()),
            #[cfg(test)]
            DirectTransport::Fake(_) => DirectFormat::Pcm(DirectPcmFormat {
                sample_rate: 44_100,
                channels: 2,
                valid_bits: 16,
                storage_bits: 16,
                sample_format: crate::direct_pcm::DirectPcmSampleFormat::Signed16,
                memory_path: crate::direct_pcm::DirectPcmMemoryPath::ZeroCopyPacked,
            }),
        }
    }

    pub fn monitor(&self) -> DirectMonitor {
        match &self.transport {
            DirectTransport::AlsaPcm(value) => DirectMonitor::AlsaPcm(value.monitor()),
            DirectTransport::AlsaDsd(value) => DirectMonitor::AlsaDsd(value.monitor()),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(value) => DirectMonitor::DirettaPcm(value.monitor()),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => DirectMonitor::DirettaDsd(value.monitor()),
            #[cfg(test)]
            DirectTransport::Fake(value) => DirectMonitor::Fake(std::sync::Arc::clone(value)),
        }
    }

    pub fn position(&self) -> f64 {
        let monitor = self.monitor();
        if monitor.transition_count() == self.seek_transition_count {
            self.seek_base + monitor.consumed_position()
        } else {
            monitor.consumed_position()
        }
    }

    pub fn duration(&self) -> f64 {
        let direct_duration = self.monitor().duration();
        if direct_duration > 0.0 {
            direct_duration
        } else {
            self.duration
        }
    }

    pub fn seek_base(&self) -> f64 {
        self.seek_base
    }

    pub fn transition_count(&self) -> u64 {
        self.monitor().transition_count()
    }

    pub fn is_diretta(&self) -> bool {
        match &self.transport {
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(_) | DirectTransport::DirettaDsd(_) => true,
            _ => false,
        }
    }

    pub fn output_path(&self) -> &'static str {
        match &self.transport {
            DirectTransport::AlsaPcm(value) if value.exact_pcm() => "exact-pcm",
            DirectTransport::AlsaPcm(_) => "decoded-pcm",
            DirectTransport::AlsaDsd(_) => "native-dsd",
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(_) => "exact-pcm",
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(_) => "native-dsd",
            #[cfg(test)]
            DirectTransport::Fake(_) => "exact-pcm",
        }
    }

    pub fn stage_handle(&self) -> DirectStageHandle {
        match &self.transport {
            DirectTransport::AlsaPcm(value) => DirectStageHandle::Pcm(value.stage_handle()),
            DirectTransport::AlsaDsd(value) => DirectStageHandle::Dsd(value.stage_handle()),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaPcm(value) => DirectStageHandle::Pcm(value.stage_handle()),
            #[cfg(feature = "diretta")]
            DirectTransport::DirettaDsd(value) => DirectStageHandle::Dsd(value.stage_handle()),
            #[cfg(test)]
            DirectTransport::Fake(_) => panic!("fake Direct runtime does not support staging"),
        }
    }

    pub fn commit_gapless_boundary(
        &mut self,
        source: &str,
        duration: f64,
        cue_start_frame75: Option<u64>,
        cue_end_frame75: Option<u64>,
    ) {
        self.source = source.to_owned();
        self.duration = duration;
        self.seek_base = 0.0;
        self.seek_transition_count = self.monitor().transition_count();
        self.cue_start_frame75 = cue_start_frame75;
        self.cue_end_frame75 = cue_end_frame75;
    }

    pub fn failed(&self) -> bool {
        self.monitor().failure_kind().is_some()
    }

    pub fn finished(&self) -> bool {
        self.monitor().finished()
    }

    #[cfg(test)]
    pub fn fake(duration: f64, auto_play: bool) -> Self {
        let state = std::sync::Arc::new(FakeDirectState::default());
        state
            .playing
            .store(auto_play, std::sync::atomic::Ordering::Release);
        Self {
            duration,
            seek_base: 0.0,
            seek_transition_count: 0,
            cue_start_frame75: None,
            cue_end_frame75: None,
            source: "test.wav".into(),
            transport: DirectTransport::Fake(state),
        }
    }

    #[cfg(test)]
    pub fn fake_state(&self) -> std::sync::Arc<FakeDirectState> {
        match &self.transport {
            DirectTransport::Fake(value) => std::sync::Arc::clone(value),
            _ => panic!("not a fake Direct runtime"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::direct_segment_duration_secs;

    #[test]
    fn cue_segment_duration_uses_exact_index_or_remaining_physical_duration() {
        assert!((direct_segment_duration_secs(600.0, Some(750), Some(825)) - 1.0).abs() < 1e-9);
        assert!((direct_segment_duration_secs(600.0, Some(750), None) - 590.0).abs() < 1e-9);
        assert!((direct_segment_duration_secs(600.0, None, None) - 600.0).abs() < 1e-9);
    }
}
