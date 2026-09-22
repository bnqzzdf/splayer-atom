use std::{fs, path::PathBuf, sync::OnceLock};

use tracing::trace;
use tracing_appender::{non_blocking::WorkerGuard, rolling::RollingFileAppender};
use tracing_subscriber::{
    filter::{LevelFilter, Targets},
    fmt::{self, time::LocalTime},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    Layer,
};

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

/// 初始化 tracing 日志系统
///
/// Core 进程中的 native audio 模块共享全局 tracing subscriber。
/// 首次调用负责初始化，后续 `try_init` 会无害失败。
pub fn init_logger(log_dir: &str, is_dev: bool) {
    let log_path = PathBuf::from(log_dir);

    if !log_path.exists() {
        let _ = fs::create_dir_all(&log_path);
    }

    let file_appender = match RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("audio-engine")
        .filename_suffix("log")
        .max_log_files(5)
        .build(&log_path)
    {
        Ok(appender) => appender,
        Err(_) => return,
    };

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    if LOG_GUARD.set(guard).is_err() {
        return;
    }

    let time_format =
        time::macros::format_description!("[hour]:[minute]:[second].[subsecond digits:3]");
    let local_timer = LocalTime::new(time_format);

    let crate_name = env!("CARGO_PKG_NAME").replace('-', "_");

    // 文件层：TRACE，带完整信息
    let file_filter = Targets::new().with_target(&crate_name, LevelFilter::TRACE);
    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_timer(local_timer.clone())
        .with_filter(file_filter);

    // 控制台层：紧凑单行，便于直接汇入 Core stdout 日志。
    let stdout_level = if is_dev {
        LevelFilter::DEBUG
    } else {
        LevelFilter::WARN
    };
    let stdout_filter = Targets::new().with_target(&crate_name, stdout_level);
    let stdout_layer = fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(true)
        .compact()
        .with_target(true)
        .with_file(true)
        .with_line_number(true)
        .with_timer(local_timer)
        .with_filter(stdout_filter);

    let _ = tracing_subscriber::registry()
        .with(file_layer)
        .with(stdout_layer)
        .try_init();

    trace!(path = ?log_path, is_dev, "audio-engine 日志系统初始化完成");
}
