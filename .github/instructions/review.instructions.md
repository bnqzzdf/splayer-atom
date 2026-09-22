---
applyTo: "**"
---

# SPlayer Atom 审查指引

审查前先读取 `AGENTS.md` 和相关 `docs/atom-roadmap.md` 章节。所有评论、建议与总结使用中文。

优先检查：

- 是否产生 renderer/Web/provider/Output 第二权威，或绕过现有 Core Control Protocol。
- 是否扩大 Atom 对上游页面、store、service 或 native 模块的触碰，而没有证明真实差异。
- Diretta 路径是否改变 PCM sample/rate/channels 或逻辑 DSD sequence/rate/channels，或引入 fallback/DSP。
- 路径、credential、queue、provider session、cache、统计和 output assignment 是否仍由 Core 持有。
- preload listener 是否先移除旧 listener 再注册；有限生命周期 renderer 消费者是否在卸载时 unsubscribe。
- 高频事件、RAF/canvas、图片解码和模块级 cache 是否遵守隐藏面静默、内存与淘汰规则。
- 类型、时间单位、持久化与 native addon 使用是否符合 `AGENTS.md`。

直接指出真实 bug、风险位置和可执行修法。不要提出纯风格重写、无需求抽象、无要求的 timeout/retry 配置或对冻结 QQ/酷狗兼容面的 Atom 扩展。
