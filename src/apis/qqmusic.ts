/**
 * QM API 渲染端
 *
 * 用 Proxy 把所有接口代理到 Core Provider Protocol：
 * `qqmusic.search({keywords})` 实际等于 `providerClient.call("qqmusic", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回业务 data；失败 → 抛 Error。
 *
 * 参照 src/apis/qobuz.ts 的封装模式。
 */

import type { ApiCallResponse } from "@shared/types/apis";
import { providerClient } from "@/core/providerClient";

/**
 * 调用 QM API，返回业务数据
 * @param name 接口名（search / song_info / lyric / match / hot_search / leaderboard / song_list / user_detail / song_url）
 * @param params 接口参数
 */
export const qqmusicCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await providerClient.call("qqmusic", name, params);
  if (!res.ok) throw new Error(res.error);
  return (res.data ?? res.body) as T;
};

type QQMusicProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`qqmusic.search(...)` / `qqmusic.lyric(...)` */
export const qqmusic: QQMusicProxy = new Proxy({} as QQMusicProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      qqmusicCall<T>(name, params),
});
