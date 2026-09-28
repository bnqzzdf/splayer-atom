# 控制插件

> 最后更新：2026-09-16

控制插件（`@type control`）不提供音源。当前 Atom Core 支持它们做三类事情：

- 通过 `splayer.player.*` 反向控制播放；
- 声明自己的设置项，由「设置 → 插件管理」渲染和持久化；
- 向歌曲菜单贡献自定义动作。

阅读本文前请先了解 [插件总览与架构](/plugins/)，其中的通用网络、存储、日志和权限规则对控制插件同样适用。

::: warning 当前不下发播放事件
协议里仍保留 `register({ events })` 与 `splayer.player.on(...)`，用于兼容已有脚本和后续演进；但当前 Atom Core **不会主动向插件推送** `trackChange` / `lyricChange` / `lineChange` / `playStateChange`。新插件不要依赖播放事件订阅，也不要用高频 `getPosition()` 轮询代替事件流。
:::

## 基本要求

控制插件必须声明 `@type control`，并使用 `@apiLevel 2` 或更高。敏感能力按需声明权限：

| 权限      | 能力                                 |
| --------- | ------------------------------------ |
| `network` | `splayer.request(...)`               |
| `control` | `splayer.player.*`                   |
| `ui`      | `register({ menus })` 与歌曲菜单扩展 |

## 快速开始

下面这个插件声明一个开关和一个歌曲菜单项；用户点击菜单项后，它会按设置决定是否暂停播放。

```js
/**
 * @name        Example Control
 * @id          you.example-control
 * @version     1.0.0
 * @type        control
 * @apiLevel    2
 * @grant       control ui
 */

splayer.register({
  controls: true,
  settings: [
    {
      key: "pauseOnAction",
      type: "switch",
      label: "点击菜单时暂停播放",
      default: true,
    },
  ],
  menus: [{ id: "pause", label: "插件：暂停播放" }],
});

splayer.on("menuClick", async ({ menuId, track }) => {
  if (menuId !== "pause") return;
  if (splayer.getSetting("pauseOnAction")) splayer.player.pause();
  return { toast: `已处理：${track.title}` };
});
```

把脚本托管在可访问的 HTTPS raw URL，然后在 **设置 → 插件管理 → 在线导入** 中安装。

## `splayer.register(args)`

控制插件当前真正生效的字段：

| 字段       | 类型                  | 说明                                                   |
| ---------- | --------------------- | ------------------------------------------------------ |
| `controls` | `boolean`             | 声明插件会使用反向播放控制                             |
| `settings` | `PluginSettingItem[]` | 用户可配置项，显示在插件管理的配置弹窗                 |
| `menus`    | `PluginMenuItem[]`    | 歌曲菜单项，需要 `@grant ui`                           |
| `events`   | `PlaybackEventKind[]` | **兼容保留**；当前 Core 不下发播放事件，新插件不要依赖 |

## 反向控制播放

声明 `@grant control` 后可以调用：

| 方法                       | 说明                                |
| -------------------------- | ----------------------------------- |
| `player.play()`            | 播放                                |
| `player.pause()`           | 暂停                                |
| `player.next()`            | 下一首                              |
| `player.prev()`            | 上一首                              |
| `player.seek(positionMs)`  | 跳转到指定毫秒位置                  |
| `player.setVolume(volume)` | 设置音量，`volume ∈ [0, 1]`         |
| `player.getPosition()`     | `Promise<number>`，偶发查询当前进度 |

除 `getPosition()` 外，其余方法都是「即发即忘」。非法参数会被宿主忽略。`getPosition()` 有一次进程往返开销，只适合偶发查询；当前插件 API 不适合靠它持续轮询播放进度。

## 设置项

控制插件可以把简单配置声明给宿主：

```js
splayer.register({
  settings: [
    { key: "token", type: "text", label: "访问令牌", default: "" },
    { key: "interval", type: "number", label: "间隔", default: 30, min: 5, max: 600 },
    { key: "enabled", type: "switch", label: "启用", default: true },
    {
      key: "mode",
      type: "select",
      label: "模式",
      default: "auto",
      options: [
        { label: "自动", value: "auto" },
        { label: "手动", value: "manual" },
      ],
    },
  ],
});
```

支持的控件类型是 `switch` / `number` / `text` / `select`。宿主会根据 schema 校验并持久化值。

读取和监听设置变化：

```js
const enabled = splayer.getSetting("enabled");

splayer.onSettingChange("enabled", (value) => {
  splayer.log.info("启用状态：", value);
});
```

## 菜单扩展

声明 `@grant ui` 后，可向歌曲菜单添加项：

```js
splayer.register({
  menus: [
    { id: "open", label: "在网页打开" },
    { id: "local-only", label: "仅本地歌曲", sources: ["local"] },
  ],
});

splayer.on("menuClick", async ({ menuId, track }) => {
  if (menuId === "open") {
    return { openUrl: `https://music.example.com/song/${track.id}` };
  }
});
```

`menuClick` 可返回：

| 字段       | 效果                       |
| ---------- | -------------------------- |
| `toast`    | 显示一条提示               |
| `openUrl`  | 打开 `http` / `https` 链接 |
| `copyText` | 写入剪贴板                 |

菜单处理器运行在插件沙箱中，没有 DOM，也不能创建自定义窗口。

## 更新

声明 `@updateUrl` 后，Core 会检查远端 `@version`。发现新版时，插件管理可以原地更新，并保留启用状态、设置和插件存储。详见 [插件更新](/plugins/update)。

## 调试

Web Control 与 Core 同源时，可以直接从浏览器 DevTools 调用 Core HTTP API：

```js
await fetch("/api/plugins").then((response) => response.json());

await fetch("/api/plugins/you.example-control/setting", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "pauseOnAction", value: false }),
}).then((response) => response.json());
```

插件日志汇入 Core 日志。更多错误码和沙箱限制见 [插件总览与架构](/plugins/)。
