use anyhow::Result;

mod unsupported;

use unsupported::Backend as SelectedBackend;

/// Core 不监听桌面默认设备变化；输出列表由 Control 显式刷新。
pub(super) type DeviceChangedCallback = Box<dyn Fn(bool) + Send + 'static>;

trait PlatformBackend: Sized {
    const SUPPORTED: bool;

    fn new(callback: DeviceChangedCallback) -> Result<Self>;
    fn stop(&mut self);
}

pub struct DeviceWatcher {
    backend: SelectedBackend,
}

impl DeviceWatcher {
    pub fn new(callback: DeviceChangedCallback) -> Result<Self> {
        Ok(Self {
            backend: SelectedBackend::new(callback)?,
        })
    }

    pub fn stop(&mut self) {
        self.backend.stop();
    }
}

impl Drop for DeviceWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn is_supported() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_does_not_expose_a_device_watcher() {
        assert!(!is_supported());
    }
}
