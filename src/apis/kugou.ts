/**
 * KG API 渲染端
 *
 * 用 Proxy 把所有接口代理到 Core Provider Protocol：
 * `kugou.search({keywords})` 实际等于 `providerClient.call("kugou", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回业务 data；失败 → 抛 Error。
 *
 * 参照 src/apis/qobuz.ts 的封装模式。
 */

import type { ApiCallResponse } from "@shared/types/apis";
import { providerClient } from "@/core/providerClient";

/**
 * 调用 KG API，返回业务数据
 * @param name 接口名（search / album / artist / playlist / lyric / song_url / user_detail）
 * @param params 接口参数
 */
export const kugouCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await providerClient.call("kugou", name, params);
  if (!res.ok) throw new Error(res.error);
  return (res.data ?? res.body) as T;
};

type KugouProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`kugou.search(...)` / `kugou.lyric(...)` */
export const kugou: KugouProxy = new Proxy({} as KugouProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      kugouCall<T>(name, params),
});
