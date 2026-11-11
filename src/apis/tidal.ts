/**
 * TIDAL API 渲染端封装
 *
 * 通过 `providerClient` 调用 Core Provider Protocol 转发 TIDAL 请求。
 *
 * 调用约定：成功 → 返回 body；失败 → 抛 Error
 *
 * 后端实现见 core/apis/tidal/index.ts。
 */

import type { ApiCallResponse } from "@shared/types/apis";
import { providerClient } from "@/core/providerClient";

/**
 * 调用 TIDAL API，返回 body
 * @param name 接口名（对应 core/apis/tidal/index.ts 中导出的接口名）
 * @param params 接口参数
 */
export const tidalCall = async <T = any>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await providerClient.call("tidal", name, params);
  if (!res.ok) throw new Error(res.error);
  return (res.body ?? res.data) as T;
};

// ============ 认证 ============

/** 设备码授权响应（auth_device_authorization） */
export interface TidalDeviceAuthorizationResponse {
  status: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn: number;
}

/**
 * 第一步：发起设备码授权，获取 userCode + verificationUri
 * @param clientId 可选（用户自定义 Client ID；未传则用后端默认值）
 * @param clientSecret 可选（用户自定义 Client Secret）
 */
export const authDeviceAuthorization = (clientId?: string, clientSecret?: string) =>
  tidalCall<TidalDeviceAuthorizationResponse>("auth_device_authorization", {
    client_id: clientId,
    client_secret: clientSecret,
  });

/** 设备码轮询响应（auth_token_poll） */
export interface TidalTokenPollResponse {
  status: "success" | "pending" | "expired" | "denied" | "timeout" | "error";
  username?: string;
  countryCode?: string;
  expiresAt?: number;
  message?: string;
}

/**
 * 第二步：轮询设备码 token
 * @param deviceCode auth_device_authorization 返回的 deviceCode
 * @param clientId 可选
 * @param clientSecret 可选
 */
export const authTokenPoll = (deviceCode: string, clientId?: string, clientSecret?: string) =>
  tidalCall<TidalTokenPollResponse>("auth_token_poll", {
    device_code: deviceCode,
    client_id: clientId,
    client_secret: clientSecret,
  });

/** 登出 TIDAL */
export const logout = () => tidalCall("auth_logout");

/** 查询 TIDAL 登录状态 */
export const authStatus = () =>
  tidalCall<{
    status: string;
    loggedIn: boolean;
    userId?: string;
    username?: string;
    countryCode?: string;
    clientId?: string;
    expiresAt?: number;
  }>("auth_status");

/** 授权码登录响应（auth_authorize） */
export interface TidalAuthorizeResponse {
  status: string;
  url: string;
  state: string;
  redirectUri: string;
}

/**
 * 发起授权码登录（官方移动客户端，支持标准 LOSSLESS）
 * @param redirectBase 回调基础地址（前端传 window.location.origin）
 * @param clientId 可选（覆盖默认官方 client）
 */
export const authAuthorize = (redirectBase?: string, clientId?: string) =>
  tidalCall<TidalAuthorizeResponse>("auth_authorize", {
    redirect_base: redirectBase,
    client_id: clientId,
  });

/**
 * 授权码交换（手动回填回调 URL 中的 code+state 完成 token 交换）
 * @param code 回调 URL 中的 code（必填）
 * @param state 回调 URL 中的 state（可选，与发起授权时服务端 pending 会话对应）
 */
export const authExchange = (code: string, state?: string) =>
  tidalCall("auth_exchange", { code, state });

// ============ 首页（pages）与分类导航 ============

/**
 * 首页分区：`{ id, title, rows: [{ modules: [{ type, items }] }] }`。
 *
 * `deviceType` 是后端必填项，原生层已给默认值 DESKTOP。
 */
export const pagesHome = (params?: { device_type?: string; locale?: string }) =>
  tidalCall<{ title?: string; rows?: unknown[] }>("pages_home", params);

/**
 * 指定页面：`pages/{pageId}`。
 *
 * 首页模块的「查看全部」把 `pagedList.dataApiPath`（形如 `pages/data/<uuid>`）
 * 去掉 `pages/` 前缀后作为 `pageId` 传进来，因此这里同时要放行 `limit` / `offset`；
 * `deviceType` 与 `pages/home` 一样是必填项，原生层已给默认值 DESKTOP。
 */
export const pagesGet = (
  pageId: string,
  params?: { locale?: string; limit?: number; offset?: number; device_type?: string },
) => tidalCall("pages_get", { page_id: pageId, ...params });

/** 分类（流派）导航：返回分类数组，每项含 id/name/image */
export const genres = (params?: { locale?: string }) => tidalCall<unknown[]>("genres", params);
