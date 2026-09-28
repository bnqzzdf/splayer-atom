/**
 * 排行榜目录（无需登录）
 *
 * 端点 `/api/toplist`：一次返回网易当前全部榜单（实测 63 个），条目自带
 * `id` / `name` / `coverImgUrl` / `updateFrequency` / `trackCount` / `ToplistType`，
 * 所以卡片不需要再逐榜调用详情接口。
 *
 * 关于分组：官方「排行榜」页把前四个（飙升/新歌/原创/热歌）叫「云音乐特色榜」、
 * 其余叫「全球媒体榜」。上游没有分组字段，但前三者的 `ToplistType` 恰好是
 * S/N/O/H，可用于判定——**分组与文案交给前端**，这里只做瘦身与字段归一，
 * 免得把中文界面文案固化进协议层。
 *
 * 榜单 id 就是歌单 id：歌曲列表复用现有歌单通路（`playlist_detail` 走
 * `/api/v6/playlist/detail`，实测 `id=19723756` 能直接返回飙升榜的歌），
 * 所以本模块只管目录，不重复实现取歌。
 *
 * 上游条目有 60 多个字段（含大段封面 id），整包很大；
 * 这里只留前端渲染与判定需要的字段。
 *
 * params: 无
 * 响应：`{ code, list: NeteaseToplistEntry[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/** 上游榜单条目（只声明用到的字段） */
interface RawToplistEntry {
  id?: number | string;
  name?: unknown;
  coverImgUrl?: unknown;
  updateFrequency?: unknown;
  trackCount?: unknown;
  ToplistType?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toplist: NeteaseModule = async (query, request) => {
  const result = await request("/api/toplist", {}, createOption(query, "weapi"));
  const body = result.body as { code?: number; list?: RawToplistEntry[] } | undefined;

  const list = (body?.list ?? [])
    .map((raw) => {
      const id = raw?.id != null ? String(raw.id) : undefined;
      const name = asString(raw?.name);
      if (!id || !name) return null;
      return {
        id,
        name,
        cover: asString(raw?.coverImgUrl),
        updateFrequency: asString(raw?.updateFrequency),
        trackCount: asNumber(raw?.trackCount),
        // S 飙升 / N 新歌 / O 原创 / H 热歌；其余榜单为空
        toplistType: asString(raw?.ToplistType),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // 保留原始 status/cookie，只把 body.list 换成瘦身后的条目：
  // 上游一次返回 60+ 字段 × 63 个榜单，整包太大，而前端只用得到这几项。
  return { ...result, body: { ...body, list } };
};

export default toplist;
