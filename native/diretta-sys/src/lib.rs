//! Link-only native boundary for SPlayer Atom's strict Diretta Source Direct bridge.
//!
//! The safe Rust playback API lives in `audio-engine-core`; this crate owns only C++/SDK compilation
//! and linking so there is exactly one Diretta Host SDK FFI implementation in the repository.

pub const LINKED: bool = true;
