use alsa::pcm::State;
use anyhow::{anyhow, ensure, Context, Result};

use super::output::AlsaPcmHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WriteAttempt {
    Written(usize),
    Retry,
    Recover(i32),
}

trait FrameSink {
    fn write_frames(&mut self, data: &[u8]) -> Result<WriteAttempt>;
    fn wait_writable(&mut self) -> Result<()>;
    fn recover(&mut self, errno: i32) -> Result<()>;
}

/// ALSA `writei` 短写只推进实际接受的 frame；EAGAIN/EINTR 等待后重试。
/// XRUN 等其它错误直接失败，不在 writer 内恢复。
fn write_all_frames(
    sink: &mut impl FrameSink,
    frame_bytes: usize,
    data: &[u8],
    allow_single_recovery: bool,
    mut cancelled: impl FnMut() -> bool,
) -> Result<(usize, bool)> {
    ensure!(frame_bytes > 0, "ALSA frame bytes 为 0");
    ensure!(
        data.len().is_multiple_of(frame_bytes),
        "ALSA payload 未按 frame 对齐"
    );

    let total_frames = data.len() / frame_bytes;
    let mut submitted_frames = 0usize;
    let mut recovered = false;
    while submitted_frames < total_frames {
        ensure!(!cancelled(), "ALSA write 已取消");
        let byte_offset = submitted_frames
            .checked_mul(frame_bytes)
            .context("ALSA write offset 溢出")?;
        match sink.write_frames(&data[byte_offset..])? {
            WriteAttempt::Written(0) => anyhow::bail!("ALSA writei 返回 0 frame"),
            WriteAttempt::Written(frames) => {
                let remaining = total_frames - submitted_frames;
                ensure!(frames <= remaining, "ALSA writei 返回超出请求的 frame 数");
                submitted_frames += frames;
            }
            WriteAttempt::Retry => sink.wait_writable()?,
            WriteAttempt::Recover(errno) => {
                ensure!(
                    allow_single_recovery && !recovered,
                    "ALSA stream 发生不可透明恢复的中断: errno={errno}"
                );
                sink.recover(errno)?;
                // snd_pcm_recover(EPIPE/ESTRPIPE) 可能重置 HW queue；当前块从头重送，
                // 避免把 recover 前的短写误当成仍在设备中而永久丢样本。
                submitted_frames = 0;
                recovered = true;
            }
        }
    }
    Ok((submitted_frames, recovered))
}

pub struct AlsaFrameWriter {
    pcm: alsa::PCM,
    can_pause: bool,
    frame_bytes: usize,
}

impl AlsaFrameWriter {
    pub fn new(handle: AlsaPcmHandle) -> Result<Self> {
        let (pcm, config) = handle.into_parts();
        let frame_bytes = usize::from(config.channels)
            .checked_mul(config.format.storage_bytes())
            .context("ALSA frame bytes 溢出")?;
        Self::from_pcm(pcm, frame_bytes, config.can_pause)
    }

    pub(crate) fn from_pcm(pcm: alsa::PCM, frame_bytes: usize, can_pause: bool) -> Result<Self> {
        ensure!(frame_bytes > 0, "ALSA frame bytes 为 0");
        Ok(Self {
            pcm,
            can_pause,
            frame_bytes,
        })
    }

    pub fn can_pause(&self) -> bool {
        self.can_pause
    }

    pub fn state(&self) -> State {
        self.pcm.state()
    }

    pub fn start(&self) -> Result<()> {
        self.pcm.start().context("启动 ALSA PCM 失败")
    }

    pub fn pause(&self, paused: bool) -> Result<()> {
        self.pcm.pause(paused).context("切换 ALSA pause 状态失败")
    }

    pub fn prepare(&self) -> Result<()> {
        self.pcm.prepare().context("prepare ALSA PCM 失败")
    }

    pub fn drop_stream(&self) -> Result<()> {
        self.pcm.drop().context("drop ALSA PCM 失败")
    }

    pub fn delay(&self) -> Result<alsa::pcm::Frames> {
        self.pcm.delay().context("读取 ALSA delay 失败")
    }

    pub fn wait(&self, timeout_ms: u32) -> Result<bool> {
        self.pcm
            .wait(Some(timeout_ms))
            .context("等待 ALSA PCM 事件失败")
    }

    pub fn drain_once(&self) -> std::result::Result<(), alsa::Error> {
        self.pcm.drain()
    }

    pub fn write_all(&mut self, data: &[u8], cancelled: impl FnMut() -> bool) -> Result<usize> {
        Ok(write_all_frames(self, self.frame_bytes, data, false, cancelled)?.0)
    }

    /// Processed PCM 允许一次 alsa-lib recover；返回 bool 表示本次 write 是否发生过 discontinuity。
    pub fn write_all_recovering(
        &mut self,
        data: &[u8],
        cancelled: impl FnMut() -> bool,
    ) -> Result<(usize, bool)> {
        write_all_frames(self, self.frame_bytes, data, true, cancelled)
    }
}

impl FrameSink for AlsaFrameWriter {
    fn write_frames(&mut self, data: &[u8]) -> Result<WriteAttempt> {
        let io = self.pcm.io_bytes();
        match io.writei(data) {
            Ok(frames) => Ok(WriteAttempt::Written(frames)),
            Err(error) if matches!(error.errno(), libc::EAGAIN | libc::EINTR) => {
                Ok(WriteAttempt::Retry)
            }
            Err(error) if matches!(error.errno(), libc::EPIPE | libc::ESTRPIPE) => {
                Ok(WriteAttempt::Recover(error.errno()))
            }
            Err(error) => Err(anyhow!(error).context("ALSA writei 失败")),
        }
    }

    fn wait_writable(&mut self) -> Result<()> {
        loop {
            match self.pcm.wait(Some(100)) {
                Ok(_) => return Ok(()),
                Err(error) if error.errno() == libc::EINTR => continue,
                Err(error) => return Err(anyhow!(error).context("等待 ALSA 可写失败")),
            }
        }
    }

    fn recover(&mut self, errno: i32) -> Result<()> {
        self.pcm
            .recover(errno, false)
            .with_context(|| format!("恢复 ALSA PCM 失败: errno={errno}"))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;

    #[derive(Debug)]
    struct FakeSink {
        attempts: VecDeque<WriteAttempt>,
        accepted: Vec<u8>,
        frame_bytes: usize,
        waits: usize,
    }

    impl FakeSink {
        fn new(frame_bytes: usize, attempts: impl IntoIterator<Item = WriteAttempt>) -> Self {
            Self {
                attempts: attempts.into_iter().collect(),
                accepted: Vec::new(),
                frame_bytes,
                waits: 0,
            }
        }
    }

    impl FrameSink for FakeSink {
        fn write_frames(&mut self, data: &[u8]) -> Result<WriteAttempt> {
            let attempt = self
                .attempts
                .pop_front()
                .unwrap_or(WriteAttempt::Written(data.len() / self.frame_bytes));
            if let WriteAttempt::Written(frames) = attempt {
                let bytes = frames * self.frame_bytes;
                self.accepted
                    .extend_from_slice(&data[..bytes.min(data.len())]);
            }
            Ok(attempt)
        }

        fn wait_writable(&mut self) -> Result<()> {
            self.waits += 1;
            Ok(())
        }

        fn recover(&mut self, _errno: i32) -> Result<()> {
            self.waits += 1;
            Ok(())
        }
    }

    #[test]
    fn short_writes_advance_without_duplication_or_loss() {
        let data: Vec<u8> = (0_u8..24).collect();
        let mut sink = FakeSink::new(
            4,
            [
                WriteAttempt::Written(2),
                WriteAttempt::Written(1),
                WriteAttempt::Written(3),
            ],
        );
        let (frames, recovered) = write_all_frames(&mut sink, 4, &data, false, || false).unwrap();
        assert_eq!(frames, 6);
        assert!(!recovered);
        assert_eq!(sink.accepted, data);
    }

    #[test]
    fn retry_does_not_advance_payload() {
        let data: Vec<u8> = (0_u8..16).collect();
        let mut sink = FakeSink::new(
            4,
            [
                WriteAttempt::Retry,
                WriteAttempt::Written(1),
                WriteAttempt::Retry,
                WriteAttempt::Written(3),
            ],
        );
        let (frames, recovered) = write_all_frames(&mut sink, 4, &data, false, || false).unwrap();
        assert_eq!(frames, 4);
        assert!(!recovered);
        assert_eq!(sink.accepted, data);
        assert_eq!(sink.waits, 2);
    }

    #[test]
    fn zero_frame_write_fails_instead_of_spinning() {
        let mut sink = FakeSink::new(4, [WriteAttempt::Written(0)]);
        let error = write_all_frames(&mut sink, 4, &[0; 4], false, || false).unwrap_err();
        assert!(error.to_string().contains("0 frame"));
    }

    #[test]
    fn cancellation_stops_before_next_write() {
        let data = [0_u8; 16];
        let mut sink = FakeSink::new(4, [WriteAttempt::Written(1), WriteAttempt::Written(3)]);
        let mut checks = 0usize;
        let error = write_all_frames(&mut sink, 4, &data, false, || {
            checks += 1;
            checks > 1
        })
        .unwrap_err();
        assert!(error.to_string().contains("已取消"));
        assert_eq!(sink.accepted.len(), 4);
    }

    #[test]
    fn processed_write_allows_only_one_bounded_recovery() {
        let data = [0_u8; 8];
        let mut sink = FakeSink::new(
            4,
            [WriteAttempt::Recover(libc::EPIPE), WriteAttempt::Written(2)],
        );
        let (frames, recovered) = write_all_frames(&mut sink, 4, &data, true, || false).unwrap();
        assert_eq!(frames, 2);
        assert!(recovered);
        assert_eq!(sink.waits, 1);

        let mut sink = FakeSink::new(
            4,
            [
                WriteAttempt::Recover(libc::EPIPE),
                WriteAttempt::Recover(libc::EPIPE),
            ],
        );
        assert!(write_all_frames(&mut sink, 4, &data, true, || false).is_err());
    }
}
