//! ALSA 输出写线程的实时调度。

use std::sync::atomic::{AtomicBool, Ordering};

use tracing::{debug, info, warn};

/// 输出写线程的 SCHED_FIFO 优先级；与 JACK/PipeWire 的音频线程同档，高于 PREEMPT_RT 默认 IRQ 线程的 50。
const OUTPUT_RT_PRIORITY: i32 = 70;

/// 只在首次失败时告警，避免每次切歌重建写线程都刷日志。
static FAILURE_REPORTED: AtomicBool = AtomicBool::new(false);

/// 按 RLIMIT_RTPRIO 软限制收窄目标优先级；软限制为 0 时仍按默认值尝试（root/CAP_SYS_NICE 不受其约束）。
fn priority_for_limit(limit: libc::rlim_t) -> i32 {
    if limit == 0 || limit >= OUTPUT_RT_PRIORITY as libc::rlim_t {
        OUTPUT_RT_PRIORITY
    } else {
        limit as i32
    }
}

fn target_priority() -> i32 {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: limit 指向栈上有效的 rlimit 结构。
    if unsafe { libc::getrlimit(libc::RLIMIT_RTPRIO, &mut limit) } != 0 {
        return OUTPUT_RT_PRIORITY;
    }
    priority_for_limit(limit.rlim_cur)
}

/// 把当前线程切到 SCHED_FIFO，减少系统负载下的 ALSA 欠载。
/// 权限不足（未配置 LimitRTPRIO 且非 root）时保持普通调度继续播放。
pub fn boost_current_audio_thread(name: &str) {
    let priority = target_priority();
    let param = libc::sched_param {
        sched_priority: priority,
    };
    // SAFETY: pid 0 在 Linux 上只作用于调用线程，param 指向栈上有效结构；
    // SCHED_RESET_ON_FORK 保证派生的子进程/线程不继承实时策略。
    let code = unsafe {
        libc::sched_setscheduler(0, libc::SCHED_FIFO | libc::SCHED_RESET_ON_FORK, &param)
    };
    if code == 0 {
        info!(thread = name, priority, "音频输出线程已切换为 SCHED_FIFO");
        return;
    }
    let error = std::io::Error::last_os_error();
    if FAILURE_REPORTED.swap(true, Ordering::Relaxed) {
        debug!(thread = name, priority, %error, "音频输出线程切换 SCHED_FIFO 失败");
    } else {
        warn!(
            thread = name,
            priority,
            %error,
            "音频输出线程切换 SCHED_FIFO 失败，按普通优先级继续；可为服务配置 LimitRTPRIO"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_is_clamped_by_rtprio_soft_limit() {
        assert_eq!(priority_for_limit(0), OUTPUT_RT_PRIORITY);
        assert_eq!(priority_for_limit(40), 40);
        assert_eq!(priority_for_limit(95), OUTPUT_RT_PRIORITY);
        assert_eq!(priority_for_limit(libc::RLIM_INFINITY), OUTPUT_RT_PRIORITY);
    }
}
