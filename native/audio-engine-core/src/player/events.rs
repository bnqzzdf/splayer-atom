use std::sync::Arc;

use crate::shared::Shared;

/// 播放器推送给 JS 侧的事件类型
#[derive(Clone, Debug)]
pub enum PlayerEvent {
    /// 状态变化
    StateChanged { state: PlayerState },
    /// 播放结束
    Ended,
    /// Source Direct 已在同一 Diretta connection 上无缝切入 staged 下一首
    DirectTrackBoundary { duration: f64, generation: u64 },
    /// Processed PCM 已在同一 ALSA runtime 上播放到 staged 下一首的 DAC-side 边界。
    ProcessedTrackBoundary { duration: f64, generation: u64 },
    /// 音源失效（网络中断 / URL 过期）
    SourceError,
    /// 位置更新（秒）—— 由内部定时器推送
    Position { position: f64, duration: f64 },
    /// 输出流停滞；Core 只进入可恢复暂停态，不自动重建。
    OutputStalled,
    /// 输出流在运行期失效；Direct/Processed 都不得把它改写成 SourceError。
    OutputFailed,
}

/// 事件发射器类型（跨线程安全）
pub type EventEmitter = Arc<dyn Fn(PlayerEvent) + Send + Sync>;

/// 根据解码结束原因决定对外完成事件
pub(super) fn playback_completion_event(shared: &Shared) -> PlayerEvent {
    if shared.is_decode_failed() {
        PlayerEvent::SourceError
    } else {
        PlayerEvent::Ended
    }
}

/// 播放状态
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PlayerState {
    Idle,
    Playing,
    Paused,
    Stopped,
}
