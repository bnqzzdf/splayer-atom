//! Atom Qobuz/TIDAL 原生协议引擎。
//!
//! Node Core 是 provider session 与业务策略的唯一权威；本 crate 只负责平台 HTTP 协议、
//! 认证流程、签名和播放地址解析，并通过同一实现同时服务 Rust 测试与 N-API 调用。

pub mod error;
pub mod provider;
pub mod qobuz;
pub mod tidal;

mod napi;

pub use error::StreamingError;
pub use provider::call_provider;
pub use qobuz::QobuzClient;
pub use tidal::TidalClient;
