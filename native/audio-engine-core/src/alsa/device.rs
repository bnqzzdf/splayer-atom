use std::fmt;

use alsa::card;
use alsa::ctl::DeviceIter;
use alsa::{Ctl, Direction};
use anyhow::{ensure, Context, Result};

const SELECTOR_PREFIX: &str = "alsa:hw:CARD=";

/// Atom 持久化的 ALSA HW 端点。
///
/// `card_id` 使用 ALSA card ID，不保存随枚举变化的数字 card index。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlsaHwEndpoint {
    pub card_id: String,
    pub device: u32,
}

impl AlsaHwEndpoint {
    pub fn parse(selector: &str) -> Result<Self> {
        let rest = selector
            .strip_prefix(SELECTOR_PREFIX)
            .with_context(|| format!("不是 ALSA HW 端点: {selector}"))?;
        let (card_id, device) = rest
            .split_once(",DEV=")
            .with_context(|| format!("ALSA HW 端点缺少 DEV: {selector}"))?;
        ensure!(!card_id.is_empty(), "ALSA HW card ID 为空");
        ensure!(
            !card_id.contains([',', '=']) && !card_id.contains('\0'),
            "ALSA HW card ID 包含非法字符"
        );
        let device = device
            .parse::<u32>()
            .with_context(|| format!("ALSA HW device 编号无效: {selector}"))?;
        Ok(Self {
            card_id: card_id.to_owned(),
            device,
        })
    }

    /// 直接交给 alsa-lib 的 HW PCM 名称；不允许 plug/default/softvol 别名。
    pub fn pcm_name(&self) -> String {
        format!("hw:CARD={},DEV={}", self.card_id, self.device)
    }

    pub fn selector(&self) -> String {
        format!("{SELECTOR_PREFIX}{},DEV={}", self.card_id, self.device)
    }
}

impl fmt::Display for AlsaHwEndpoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.selector())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlsaHwDevice {
    pub endpoint: AlsaHwEndpoint,
    pub name: String,
}

/// 只枚举真实 ALSA playback PCM，不返回 default/plughw/softvol 等配置别名。
pub fn list_hw_playback_devices() -> Result<Vec<AlsaHwDevice>> {
    let mut devices = Vec::new();
    for card in card::Iter::new() {
        let card = card.context("枚举 ALSA card 失败")?;
        let ctl = Ctl::from_card(&card, false).context("打开 ALSA control 失败")?;
        let card_info = ctl.card_info().context("读取 ALSA card 信息失败")?;
        let card_id = card_info.get_id().context("读取 ALSA card ID 失败")?;
        let card_name = card_info.get_name().unwrap_or(card_id);

        for device in DeviceIter::new(&ctl) {
            let Ok(pcm_info) = ctl.pcm_info(device as u32, 0, Direction::Playback) else {
                continue;
            };
            let pcm_name = pcm_info.get_name().unwrap_or("PCM");
            devices.push(AlsaHwDevice {
                endpoint: AlsaHwEndpoint {
                    card_id: card_id.to_owned(),
                    device: device as u32,
                },
                name: format!("{card_name} - {pcm_name}"),
            });
        }
    }
    Ok(devices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats_hw_selector() {
        let endpoint = AlsaHwEndpoint::parse("alsa:hw:CARD=USB_AUDIO,DEV=2").unwrap();
        assert_eq!(endpoint.card_id, "USB_AUDIO");
        assert_eq!(endpoint.device, 2);
        assert_eq!(endpoint.pcm_name(), "hw:CARD=USB_AUDIO,DEV=2");
        assert_eq!(endpoint.selector(), "alsa:hw:CARD=USB_AUDIO,DEV=2");
    }

    #[test]
    fn rejects_plugin_aliases_and_malformed_selectors() {
        for selector in [
            "default",
            "plughw:CARD=USB,DEV=0",
            "alsa:plughw:CARD=USB,DEV=0",
            "alsa:hw:CARD=,DEV=0",
            "alsa:hw:CARD=USB",
            "alsa:hw:CARD=USB,DEV=x",
        ] {
            assert!(
                AlsaHwEndpoint::parse(selector).is_err(),
                "selector 应拒绝: {selector}"
            );
        }
    }
}
