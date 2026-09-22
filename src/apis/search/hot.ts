/**
 * 搜索热搜（按平台）
 *
 * 热搜是**平台相关**的内容：网易云与 QQ音乐 有对应接口，酷狗/Qobuz/TIDAL
 * 没有可直接取用的榜单，返回空集由界面降级展示。按平台分桶缓存。
 */
import type { Platform } from "@shared/types/platform";
import { neteaseCall } from "@/apis/netease";
import { qqmusicCall } from "@/apis/qqmusic";

export interface HotSearchItem {
  /** 关键词 */
  keyword: string;
  /** 描述/补充 */
  content?: string;
  /** 图标 url */
  iconUrl?: string;
  /** 热度 */
  score?: number;
}

interface NeteaseHotDetailResp {
  data?: Array<{
    searchWord: string;
    score?: number;
    content?: string;
    iconUrl?: string;
    iconType?: number;
  }>;
}

interface QQMusicHotResp {
  code?: number;
  list?: Array<{ keyword?: string; id?: number }>;
}

const CACHE_TTL = 10 * 60 * 1000;

const cache = new Map<Platform, { items: HotSearchItem[]; at: number }>();

const loadNeteaseHot = async (): Promise<HotSearchItem[]> => {
  const res = await neteaseCall<NeteaseHotDetailResp>("search_hot_detail");
  return (res.data ?? [])
    .filter((row) => row.searchWord)
    .map((row) => ({
      keyword: row.searchWord,
      content: row.content,
      iconUrl: row.iconUrl,
      score: row.score,
    }));
};

const loadQQMusicHot = async (): Promise<HotSearchItem[]> => {
  const res = await qqmusicCall<QQMusicHotResp>("hot_search");
  return (res?.list ?? [])
    .map((row) => String(row.keyword ?? "").trim())
    .filter(Boolean)
    .map((keyword) => ({ keyword }));
};

/**
 * 取指定平台的热搜（按平台分别缓存 TTL）
 * @param platform - 目标平台；不支持热搜的平台返回空集
 * @returns 该平台的热搜关键词列表
 */
export const getHotSearches = async (platform: Platform = "netease"): Promise<HotSearchItem[]> => {
  const now = Date.now();
  const cached = cache.get(platform);
  if (cached && now - cached.at < CACHE_TTL) return cached.items;

  let items: HotSearchItem[] = [];
  try {
    if (platform === "netease") items = await loadNeteaseHot();
    else if (platform === "qqmusic") items = await loadQQMusicHot();
  } catch (error) {
    console.warn(`[hot-search] ${platform} failed:`, error);
    // 失败不缓存空结果，下次打开弹窗可重试；保留上一次成功的内容。
    return cached?.items ?? [];
  }

  cache.set(platform, { items, at: now });
  return items;
};
