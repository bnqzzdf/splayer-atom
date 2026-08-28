#[cfg(any(atom_diretta, test))]
use std::path::Path;

#[cfg(any(atom_diretta, test))]
use anyhow::anyhow;
use anyhow::Result;

#[cfg(any(atom_diretta, test))]
use crate::direct_dsd::DirectDsdFormat;
#[cfg(any(atom_diretta, test))]
use crate::direct_pcm::DirectPcmFormat;

pub const DEVICE_PREFIX: &str = "diretta:";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirettaDevice {
    pub id: String,
    pub name: String,
}

pub fn selector_target(selector: &str) -> Option<&str> {
    selector
        .strip_prefix(DEVICE_PREFIX)
        .filter(|value| !value.is_empty())
}

pub fn selector_for(target_id: &str) -> String {
    format!("{DEVICE_PREFIX}{target_id}")
}

#[cfg(atom_diretta)]
mod imp {
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::ptr::NonNull;

    use super::*;
    use crate::direct_dsd::{
        direct_dsd_next_block, direct_dsd_release_block, DirectDsdBitOrder, DirectDsdMonitor,
        DirectDsdSource, DirectDsdStageHandle,
    };
    use crate::direct_pcm::{
        direct_pcm_next_block, direct_pcm_release_block, DirectPcmMonitor, DirectPcmSource,
        DirectPcmStageHandle,
    };

    const TEXT_CAPACITY: usize = 256;
    const MAX_SCAN_DEVICES: usize = 32;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct RawDevice {
        id: [c_char; TEXT_CAPACITY],
        name: [c_char; TEXT_CAPACITY],
    }

    impl Default for RawDevice {
        fn default() -> Self {
            Self {
                id: [0; TEXT_CAPACITY],
                name: [0; TEXT_CAPACITY],
            }
        }
    }

    type NextBlockCallback =
        unsafe extern "C" fn(context: *mut c_void, data: *mut *const u8, len: *mut usize) -> bool;
    type ReleaseBlockCallback = unsafe extern "C" fn(context: *mut c_void);

    unsafe extern "C" {
        fn atom_diretta_last_error() -> *const c_char;
        fn atom_diretta_scan(devices: *mut RawDevice, capacity: usize) -> usize;
        fn atom_diretta_open_direct(
            target_id: *const c_char,
            sample_rate: u32,
            channels: u16,
            storage_bits: u8,
            source_context: *mut c_void,
            next_block: NextBlockCallback,
            release_block: ReleaseBlockCallback,
        ) -> *mut c_void;
        fn atom_diretta_open_dsd_direct(
            target_id: *const c_char,
            bit_rate: u32,
            channels: u16,
            source_lsb_first: bool,
            wire_lsb_first: *mut bool,
            source_context: *mut c_void,
            next_block: NextBlockCallback,
            release_block: ReleaseBlockCallback,
        ) -> *mut c_void;
        fn atom_diretta_play(handle: *mut c_void) -> bool;
        fn atom_diretta_pause(handle: *mut c_void) -> bool;
        fn atom_diretta_close(handle: *mut c_void);
    }

    fn last_error(fallback: &str) -> anyhow::Error {
        let message = unsafe {
            let ptr = atom_diretta_last_error();
            if ptr.is_null() {
                None
            } else {
                CStr::from_ptr(ptr)
                    .to_str()
                    .ok()
                    .filter(|value| !value.is_empty())
            }
        };
        anyhow!(message.unwrap_or(fallback).to_owned())
    }

    fn raw_text(value: &[c_char; TEXT_CAPACITY]) -> String {
        unsafe { CStr::from_ptr(value.as_ptr()) }
            .to_string_lossy()
            .into_owned()
    }

    pub fn available() -> bool {
        true
    }

    pub fn scan_devices() -> Result<Vec<DirettaDevice>> {
        let mut raw = vec![RawDevice::default(); MAX_SCAN_DEVICES];
        let discovered = unsafe { atom_diretta_scan(raw.as_mut_ptr(), raw.len()) };
        if discovered == 0 {
            let error = last_error("");
            if error.to_string().is_empty() {
                return Ok(Vec::new());
            }
            return Err(error);
        }
        let count = discovered.min(raw.len());
        Ok(raw
            .into_iter()
            .take(count)
            .filter_map(|device| {
                let id = raw_text(&device.id);
                if id.is_empty() {
                    return None;
                }
                let name = raw_text(&device.name);
                Some(DirettaDevice {
                    id: selector_for(&id),
                    name: if name.is_empty() {
                        "Diretta Target".to_string()
                    } else {
                        name
                    },
                })
            })
            .collect())
    }

    pub struct DirettaDirectConnection {
        raw: NonNull<c_void>,
        source: DirectPcmSource,
    }

    // Diretta SDK handle 只由拥有者线程控制；SDK 内部发送线程仅通过回调访问 source ring。
    unsafe impl Send for DirettaDirectConnection {}

    impl DirettaDirectConnection {
        pub fn open_local(selector: &str, path: &Path) -> Result<Self> {
            let (connection, _) = Self::open_local_at(selector, path, 0.0)?;
            Ok(connection)
        }

        pub fn open_local_at(
            selector: &str,
            path: &Path,
            position_secs: f64,
        ) -> Result<(Self, f64)> {
            let target = selector_target(selector)
                .ok_or_else(|| anyhow!("invalid Diretta output selector"))?;
            let target = CString::new(target).map_err(|_| anyhow!("invalid Diretta target id"))?;
            let (source, actual_position) = DirectPcmSource::open_local_at(path, position_secs)?;
            let format = source.format();
            let raw = unsafe {
                atom_diretta_open_direct(
                    target.as_ptr(),
                    format.sample_rate,
                    format.channels,
                    format.storage_bits,
                    source.callback_context(),
                    direct_pcm_next_block,
                    direct_pcm_release_block,
                )
            };
            let raw = NonNull::new(raw)
                .ok_or_else(|| last_error("failed to open Diretta Source Direct target"))?;
            Ok((Self { raw, source }, actual_position))
        }

        pub fn format(&self) -> DirectPcmFormat {
            self.source.format()
        }

        pub fn play(&mut self) -> Result<()> {
            if unsafe { atom_diretta_play(self.raw.as_ptr()) } {
                Ok(())
            } else {
                Err(last_error("failed to start Diretta Source Direct playback"))
            }
        }

        pub fn pause(&mut self) -> Result<()> {
            if unsafe { atom_diretta_pause(self.raw.as_ptr()) } {
                Ok(())
            } else {
                Err(last_error("failed to pause Diretta Source Direct playback"))
            }
        }

        pub fn seek_while_paused(&mut self, position_secs: f64) -> Result<f64> {
            self.source.seek_while_paused(position_secs)
        }

        pub fn replace_local_source_while_paused(
            &mut self,
            path: &Path,
        ) -> Result<DirectPcmFormat> {
            self.source.replace_local_while_paused(path)
        }

        pub fn failed(&self) -> bool {
            self.source.failed()
        }

        pub fn finished(&self) -> bool {
            self.source.finished()
        }

        pub fn consumed_position(&self) -> f64 {
            self.source.consumed_position()
        }

        pub fn monitor(&self) -> DirectPcmMonitor {
            self.source.monitor()
        }

        pub fn stage_handle(&self) -> DirectPcmStageHandle {
            self.source.stage_handle()
        }

        pub fn set_duration(&self, duration_secs: f64) {
            self.source.set_duration(duration_secs);
        }
    }

    impl Drop for DirettaDirectConnection {
        fn drop(&mut self) {
            // 必须先关闭 SDK，确保发送线程不再持有 source callback context，再释放 source ring。
            unsafe { atom_diretta_close(self.raw.as_ptr()) };
        }
    }

    pub struct DirettaDirectDsdConnection {
        raw: NonNull<c_void>,
        source: DirectDsdSource,
    }

    unsafe impl Send for DirettaDirectDsdConnection {}

    impl DirettaDirectDsdConnection {
        pub fn open_local(selector: &str, path: &Path) -> Result<Self> {
            let (connection, _) = Self::open_local_at(selector, path, 0.0)?;
            Ok(connection)
        }

        pub fn open_local_at(
            selector: &str,
            path: &Path,
            position_secs: f64,
        ) -> Result<(Self, f64)> {
            let target = selector_target(selector)
                .ok_or_else(|| anyhow!("invalid Diretta output selector"))?;
            let target = CString::new(target).map_err(|_| anyhow!("invalid Diretta target id"))?;
            let (mut source, actual_position) =
                DirectDsdSource::open_local_at(path, position_secs)?;
            let format = source.format();
            let source_lsb_first = format.bit_order == DirectDsdBitOrder::LsbFirst;
            let mut wire_lsb_first = source_lsb_first;
            let raw = unsafe {
                atom_diretta_open_dsd_direct(
                    target.as_ptr(),
                    format.bit_rate,
                    format.channels,
                    source_lsb_first,
                    &mut wire_lsb_first,
                    source.callback_context(),
                    direct_dsd_next_block,
                    direct_dsd_release_block,
                )
            };
            let raw = NonNull::new(raw)
                .ok_or_else(|| last_error("failed to open Diretta Native DSD target"))?;
            let wire_bit_order = if wire_lsb_first {
                DirectDsdBitOrder::LsbFirst
            } else {
                DirectDsdBitOrder::MsbFirst
            };
            if wire_bit_order != format.bit_order {
                if let Err(error) =
                    source.set_wire_bit_order_while_paused(wire_bit_order, actual_position)
                {
                    unsafe { atom_diretta_close(raw.as_ptr()) };
                    return Err(anyhow!(
                        "failed to adapt Native DSD wire bit order: {error}"
                    ));
                }
            }
            Ok((Self { raw, source }, actual_position))
        }

        pub fn format(&self) -> DirectDsdFormat {
            self.source.format()
        }

        pub fn play(&mut self) -> Result<()> {
            if unsafe { atom_diretta_play(self.raw.as_ptr()) } {
                Ok(())
            } else {
                Err(last_error("failed to start Diretta Native DSD playback"))
            }
        }

        pub fn pause(&mut self) -> Result<()> {
            if unsafe { atom_diretta_pause(self.raw.as_ptr()) } {
                Ok(())
            } else {
                Err(last_error("failed to pause Diretta Native DSD playback"))
            }
        }

        pub fn seek_while_paused(&mut self, position_secs: f64) -> Result<f64> {
            self.source.seek_while_paused(position_secs)
        }

        pub fn replace_local_source_while_paused(
            &mut self,
            path: &Path,
        ) -> Result<DirectDsdFormat> {
            self.source.replace_local_while_paused(path)
        }

        pub fn failed(&self) -> bool {
            self.source.failed()
        }

        pub fn finished(&self) -> bool {
            self.source.finished()
        }

        pub fn consumed_position(&self) -> f64 {
            self.source.consumed_position()
        }

        pub fn monitor(&self) -> DirectDsdMonitor {
            self.source.monitor()
        }

        pub fn stage_handle(&self) -> DirectDsdStageHandle {
            self.source.stage_handle()
        }
    }

    impl Drop for DirettaDirectDsdConnection {
        fn drop(&mut self) {
            unsafe { atom_diretta_close(self.raw.as_ptr()) };
        }
    }
}

#[cfg(not(atom_diretta))]
mod imp {
    use super::*;

    pub fn available() -> bool {
        false
    }

    pub fn scan_devices() -> Result<Vec<DirettaDevice>> {
        Ok(Vec::new())
    }

    #[cfg(test)]
    pub struct DirettaDirectConnection;
    #[cfg(test)]
    pub struct DirettaDirectDsdConnection;

    #[cfg(test)]
    impl DirettaDirectConnection {
        pub fn open_local(_selector: &str, _path: &Path) -> Result<Self> {
            Err(anyhow!(
                "Diretta SDK support is not compiled; set DIRETTA_SDK_ROOT when building audio-engine"
            ))
        }

        pub fn format(&self) -> DirectPcmFormat {
            unreachable!("Diretta SDK support is not compiled")
        }

        pub fn play(&mut self) -> Result<()> {
            Err(anyhow!("Diretta SDK support is not compiled"))
        }

        pub fn pause(&mut self) -> Result<()> {
            Err(anyhow!("Diretta SDK support is not compiled"))
        }

        pub fn failed(&self) -> bool {
            true
        }

        pub fn finished(&self) -> bool {
            false
        }
    }

    #[cfg(test)]
    impl DirettaDirectDsdConnection {
        pub fn open_local(_selector: &str, _path: &Path) -> Result<Self> {
            Err(anyhow!("Diretta SDK support is not compiled"))
        }

        pub fn format(&self) -> DirectDsdFormat {
            unreachable!("Diretta SDK support is not compiled")
        }

        pub fn play(&mut self) -> Result<()> {
            Err(anyhow!("Diretta SDK support is not compiled"))
        }

        pub fn pause(&mut self) -> Result<()> {
            Err(anyhow!("Diretta SDK support is not compiled"))
        }

        pub fn failed(&self) -> bool {
            true
        }

        pub fn finished(&self) -> bool {
            false
        }
    }
}

pub use imp::scan_devices;
#[cfg(atom_diretta)]
pub use imp::{DirettaDirectConnection, DirettaDirectDsdConnection};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sdk_pull_callback_stays_copy_free_and_lock_free() {
        let bridge = include_str!("../diretta/bridge.cpp");
        let callback = bridge
            .split("bool getNewStream(diretta_stream& stream) override")
            .nth(1)
            .and_then(|tail| tail.split("private:").next())
            .expect("Diretta pull callback body should exist");
        for forbidden in [
            "memcpy",
            "setStream",
            "resize(",
            "mutex",
            "new ",
            "findOutput",
            "setSink(",
        ] {
            assert!(
                !callback.contains(forbidden),
                "Diretta SDK real-time callback must not contain {forbidden}"
            );
        }
        assert!(callback.contains("stream.Data.P"));
        assert!(callback.contains("stream.Size"));
    }

    #[test]
    fn native_dsd_bridge_selects_a_supported_native_wire_bit_order_only() {
        let bridge = include_str!("../diretta/bridge.cpp");
        let dsd_open = bridge
            .split("void* atom_diretta_open_dsd_direct(")
            .nth(1)
            .and_then(|tail| tail.split("bool atom_diretta_play").next())
            .expect("Native DSD bridge entry should exist");
        assert!(dsd_open.contains("FMT_DSD1"));
        assert!(dsd_open.contains("FMT_DSD_SIZ_32"));
        assert!(dsd_open.contains("FMT_DSD_BIG"));
        assert!(dsd_open.contains("FMT_DSD_LSB"));
        assert!(dsd_open.contains("FMT_DSD_MSB"));
        assert!(dsd_open.contains("source_lsb_first"));
        assert!(dsd_open.contains("wire_lsb_first"));
        assert!(dsd_open.contains("alternate_format_id"));
        for forbidden in ["DSD2PCM", "DoP", "memcpy", "reverse_bits"] {
            assert!(
                !dsd_open.contains(forbidden),
                "Native DSD bridge must not perform sample-domain conversion {forbidden}"
            );
        }
    }

    #[test]
    fn direct_connection_api_remains_a_concrete_native_seam() {
        let _open: fn(&str, &Path) -> Result<imp::DirettaDirectConnection> =
            imp::DirettaDirectConnection::open_local;
        let _format: fn(&imp::DirettaDirectConnection) -> DirectPcmFormat =
            imp::DirettaDirectConnection::format;
        let _play: fn(&mut imp::DirettaDirectConnection) -> Result<()> =
            imp::DirettaDirectConnection::play;
        let _pause: fn(&mut imp::DirettaDirectConnection) -> Result<()> =
            imp::DirettaDirectConnection::pause;
        let _failed: fn(&imp::DirettaDirectConnection) -> bool =
            imp::DirettaDirectConnection::failed;
        let _finished: fn(&imp::DirettaDirectConnection) -> bool =
            imp::DirettaDirectConnection::finished;

        let _open_dsd: fn(&str, &Path) -> Result<imp::DirettaDirectDsdConnection> =
            imp::DirettaDirectDsdConnection::open_local;
        let _format_dsd: fn(&imp::DirettaDirectDsdConnection) -> DirectDsdFormat =
            imp::DirettaDirectDsdConnection::format;
        let _play_dsd: fn(&mut imp::DirettaDirectDsdConnection) -> Result<()> =
            imp::DirettaDirectDsdConnection::play;
        let _pause_dsd: fn(&mut imp::DirettaDirectDsdConnection) -> Result<()> =
            imp::DirettaDirectDsdConnection::pause;
        let _failed_dsd: fn(&imp::DirettaDirectDsdConnection) -> bool =
            imp::DirettaDirectDsdConnection::failed;
        let _finished_dsd: fn(&imp::DirettaDirectDsdConnection) -> bool =
            imp::DirettaDirectDsdConnection::finished;
    }

    #[test]
    fn bridge_keeps_connection_completion_separate_from_playback_online_state() {
        let bridge = include_str!("../diretta/bridge.cpp");
        let connection = bridge
            .split("struct DirettaConnection")
            .nth(1)
            .and_then(|tail| tail.split("bool discover").next())
            .expect("Diretta connection cleanup should exist");
        assert!(connection.contains("~DirettaConnection()"));
        assert!(connection.contains("shutdown();"));
        assert!(connection.contains("disconnect_flgset();"));
        assert!(connection.contains("disconnect(false);"));
        assert!(connection.contains("kDisconnectTimeout"));
        assert!(connection.contains("is_connect()"));
        assert!(connection.contains("sync->close();"));
        assert!(!connection.contains("disconnectWait"));

        let open = bridge
            .split("void* open_direct_with_format(")
            .nth(1)
            .and_then(|tail| tail.split("} // namespace").next())
            .expect("Diretta open path should exist");
        assert!(open.contains("connectPrepare()"));
        assert!(open.contains("connect(0)"));
        assert!(open.contains("connectWait()"));
        assert!(!open.contains("is_online()"));
        assert!(!open.contains("->play()"));

        let close = bridge
            .split("void atom_diretta_close(void* opaque)")
            .nth(1)
            .expect("Diretta close entry should exist");
        assert!(close.contains("unique_ptr<DirettaConnection>"));
    }

    #[cfg(not(atom_diretta))]
    #[test]
    fn builds_without_sdk_and_reports_no_discoverable_targets() {
        assert!(!imp::available());
        assert!(imp::scan_devices().unwrap().is_empty());
    }

    #[test]
    fn selectors_keep_diretta_targets_in_the_existing_device_id_space() {
        let selector = selector_for("fe80::1234%2");
        assert_eq!(selector, "diretta:fe80::1234%2");
        assert_eq!(selector_target(&selector), Some("fe80::1234%2"));
        assert_eq!(selector_target("default_output"), None);
        assert_eq!(selector_target("diretta:"), None);
    }
}
