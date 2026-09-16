#[cfg(feature = "diretta")]
use anyhow::bail;
use anyhow::Result;

use crate::direct_dsd::{DirectDsdFormat, DirectDsdMonitor};
use crate::direct_pcm::{DirectPcmFormat, DirectPcmMonitor};

#[cfg(feature = "diretta")]
use crate::direct_dsd::DirectDsdStageHandle;
#[cfg(feature = "diretta")]
use crate::direct_pcm::DirectPcmStageHandle;

#[cfg(feature = "diretta")]
use std::path::Path;

#[cfg(feature = "diretta")]
use crate::diretta::{DirettaDirectConnection, DirettaDirectDsdConnection};

#[cfg(any(feature = "diretta", test))]
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

#[derive(Clone)]
pub enum DirectMonitor {
    Pcm(DirectPcmMonitor),
    Dsd(DirectDsdMonitor),
    #[cfg(test)]
    Fake(std::sync::Arc<FakeDirectState>),
}

impl DirectMonitor {
    pub fn consumed_position(&self) -> f64 {
        match self {
            Self::Pcm(value) => value.consumed_position(),
            Self::Dsd(value) => value.consumed_position(),
            #[cfg(test)]
            Self::Fake(value) => {
                value
                    .position_micros
                    .load(std::sync::atomic::Ordering::Acquire) as f64
                    / 1_000_000.0
            }
        }
    }

    pub fn failed(&self) -> bool {
        match self {
            Self::Pcm(value) => value.failed(),
            Self::Dsd(value) => value.failed(),
            #[cfg(test)]
            Self::Fake(value) => value.failed.load(std::sync::atomic::Ordering::Acquire),
        }
    }

    pub fn finished(&self) -> bool {
        match self {
            Self::Pcm(value) => value.finished(),
            Self::Dsd(value) => value.finished(),
            #[cfg(test)]
            Self::Fake(value) => value.finished.load(std::sync::atomic::Ordering::Acquire),
        }
    }

    pub fn transition_count(&self) -> u64 {
        match self {
            Self::Pcm(value) => value.transition_count(),
            Self::Dsd(value) => value.transition_count(),
            #[cfg(test)]
            Self::Fake(_) => 0,
        }
    }

    pub fn duration(&self) -> f64 {
        match self {
            Self::Pcm(value) => value.duration(),
            Self::Dsd(value) => value.duration(),
            #[cfg(test)]
            Self::Fake(_) => 0.0,
        }
    }

    pub fn boundary_generation(&self) -> u64 {
        match self {
            Self::Pcm(value) => value.boundary_generation(),
            Self::Dsd(value) => value.boundary_generation(),
            #[cfg(test)]
            Self::Fake(_) => 0,
        }
    }
}

#[cfg(feature = "diretta")]
fn is_native_dsd_source(source: &str) -> bool {
    if crate::sacd::parse_sacd_virtual_path(source).is_some() {
        return true;
    }
    let extension = Path::new(source)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(extension.as_str(), "dsf" | "dff" | "dsdiff")
}

#[cfg(feature = "diretta")]
#[derive(Clone)]
pub enum DirectStageHandle {
    Pcm(DirectPcmStageHandle),
    Dsd(DirectDsdStageHandle),
}

#[cfg(feature = "diretta")]
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
                    bail!("[Direct] PCM → Native DSD 需要重新协商 Diretta connection");
                }
                value.stage_local(path, duration_secs, generation, start_frame75, end_frame75)
            }
            Self::Dsd(value) => {
                if !native_dsd {
                    bail!("[Direct] Native DSD → PCM 需要重新协商 Diretta connection");
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

#[cfg(feature = "diretta")]
enum DirectTransport {
    Pcm(DirettaDirectConnection),
    Dsd(DirettaDirectDsdConnection),
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

#[cfg(test)]
enum TestTransport {
    Fake(std::sync::Arc<FakeDirectState>),
}

pub struct DirectPlayback {
    duration: f64,
    seek_base: f64,
    seek_transition_count: u64,
    cue_start_frame75: Option<u64>,
    cue_end_frame75: Option<u64>,
    #[cfg(feature = "diretta")]
    selector: String,
    #[cfg(feature = "diretta")]
    source: String,
    #[cfg(feature = "diretta")]
    transport: DirectTransport,
    #[cfg(all(test, not(feature = "diretta")))]
    transport: TestTransport,
}

impl DirectPlayback {
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
            (DirectTransport::Dsd(connection), actual_position)
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
            (DirectTransport::Pcm(connection), actual_position)
        };

        let duration = match &transport {
            DirectTransport::Pcm(value) => {
                value.set_duration(direct_duration);
                direct_duration
            }
            DirectTransport::Dsd(value) => value.monitor().duration(),
        };
        let mut playback = Self {
            duration,
            seek_base,
            seek_transition_count: 0,
            cue_start_frame75,
            cue_end_frame75,
            selector: selector.to_owned(),
            source: source.to_owned(),
            transport,
        };
        if auto_play {
            playback.play()?;
        }
        Ok(playback)
    }

    #[cfg(feature = "diretta")]
    pub fn handoff_local_while_paused(
        &mut self,
        source: &str,
        duration: f64,
    ) -> Result<DirectFormat> {
        let path = Path::new(source);
        let native_dsd = is_native_dsd_source(source);
        let format = match &mut self.transport {
            DirectTransport::Pcm(value) => {
                if native_dsd {
                    bail!("[Direct] PCM → Native DSD 需要重新协商 Diretta connection");
                }
                let format = value.replace_local_source_while_paused(path)?;
                value.set_duration(duration);
                DirectFormat::Pcm(format)
            }
            DirectTransport::Dsd(value) => {
                if !native_dsd {
                    bail!("[Direct] Native DSD → PCM 需要重新协商 Diretta connection");
                }
                let format = value.replace_local_source_while_paused(path)?;
                DirectFormat::Dsd(format)
            }
        };
        self.source = source.to_owned();
        self.duration = match &self.transport {
            DirectTransport::Pcm(_) => duration,
            DirectTransport::Dsd(value) => value.monitor().duration(),
        };
        self.seek_base = 0.0;
        self.seek_transition_count = self.monitor().transition_count();
        self.cue_start_frame75 = None;
        self.cue_end_frame75 = None;
        Ok(format)
    }

    pub fn seek_while_paused(&mut self, position_secs: f64) -> Result<f64> {
        #[cfg(feature = "diretta")]
        let actual_position = match &mut self.transport {
            DirectTransport::Pcm(value) => match self.cue_start_frame75 {
                Some(start) => {
                    value.seek_segment_while_paused(start, self.cue_end_frame75, position_secs)?
                }
                None => value.seek_while_paused(position_secs)?,
            },
            DirectTransport::Dsd(value) => match self.cue_start_frame75 {
                Some(start) => {
                    value.seek_segment_while_paused(start, self.cue_end_frame75, position_secs)?
                }
                None => value.seek_while_paused(position_secs)?,
            },
        };
        #[cfg(all(test, not(feature = "diretta")))]
        let actual_position = {
            match &self.transport {
                TestTransport::Fake(value) => {
                    value
                        .position_micros
                        .store(0, std::sync::atomic::Ordering::Release);
                }
            }
            position_secs
        };
        #[cfg(not(any(feature = "diretta", test)))]
        let actual_position = position_secs;

        self.seek_base = actual_position;
        self.seek_transition_count = self.monitor().transition_count();
        Ok(actual_position)
    }

    pub fn play(&mut self) -> Result<()> {
        #[cfg(feature = "diretta")]
        {
            match &mut self.transport {
                DirectTransport::Pcm(value) => value.play(),
                DirectTransport::Dsd(value) => value.play(),
            }
        }
        #[cfg(all(test, not(feature = "diretta")))]
        {
            match &self.transport {
                TestTransport::Fake(value) => {
                    value
                        .playing
                        .store(true, std::sync::atomic::Ordering::Release);
                    Ok(())
                }
            }
        }
        #[cfg(not(any(feature = "diretta", test)))]
        {
            unreachable!()
        }
    }

    pub fn pause(&mut self) -> Result<()> {
        #[cfg(feature = "diretta")]
        {
            match &mut self.transport {
                DirectTransport::Pcm(value) => value.pause(),
                DirectTransport::Dsd(value) => value.pause(),
            }
        }
        #[cfg(all(test, not(feature = "diretta")))]
        {
            match &self.transport {
                TestTransport::Fake(value) => {
                    value
                        .playing
                        .store(false, std::sync::atomic::Ordering::Release);
                    Ok(())
                }
            }
        }
        #[cfg(not(any(feature = "diretta", test)))]
        {
            unreachable!()
        }
    }

    pub fn format(&self) -> DirectFormat {
        #[cfg(feature = "diretta")]
        {
            match &self.transport {
                DirectTransport::Pcm(value) => DirectFormat::Pcm(value.format()),
                DirectTransport::Dsd(value) => DirectFormat::Dsd(value.format()),
            }
        }
        #[cfg(all(test, not(feature = "diretta")))]
        {
            DirectFormat::Pcm(DirectPcmFormat {
                sample_rate: 44_100,
                channels: 2,
                valid_bits: 16,
                storage_bits: 16,
                sample_format: crate::direct_pcm::DirectPcmSampleFormat::Signed16,
                memory_path: crate::direct_pcm::DirectPcmMemoryPath::ZeroCopyPacked,
            })
        }
        #[cfg(not(any(feature = "diretta", test)))]
        {
            unreachable!()
        }
    }

    pub fn monitor(&self) -> DirectMonitor {
        #[cfg(feature = "diretta")]
        {
            match &self.transport {
                DirectTransport::Pcm(value) => DirectMonitor::Pcm(value.monitor()),
                DirectTransport::Dsd(value) => DirectMonitor::Dsd(value.monitor()),
            }
        }
        #[cfg(all(test, not(feature = "diretta")))]
        {
            match &self.transport {
                TestTransport::Fake(value) => DirectMonitor::Fake(std::sync::Arc::clone(value)),
            }
        }
        #[cfg(not(any(feature = "diretta", test)))]
        {
            unreachable!()
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

    #[cfg(feature = "diretta")]
    pub fn stage_handle(&self) -> DirectStageHandle {
        match &self.transport {
            DirectTransport::Pcm(value) => DirectStageHandle::Pcm(value.stage_handle()),
            DirectTransport::Dsd(value) => DirectStageHandle::Dsd(value.stage_handle()),
        }
    }

    #[cfg(feature = "diretta")]
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
        self.monitor().failed()
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
            #[cfg(feature = "diretta")]
            selector: "diretta:test".into(),
            #[cfg(feature = "diretta")]
            source: "test.wav".into(),
            #[cfg(feature = "diretta")]
            transport: panic!("fake DirectPlayback is only used in no-SDK unit tests"),
            #[cfg(all(test, not(feature = "diretta")))]
            transport: TestTransport::Fake(state),
        }
    }

    #[cfg(all(test, not(feature = "diretta")))]
    pub fn fake_state(&self) -> std::sync::Arc<FakeDirectState> {
        match &self.transport {
            TestTransport::Fake(value) => std::sync::Arc::clone(value),
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
