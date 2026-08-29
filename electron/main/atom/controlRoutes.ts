import { Hono } from "hono";
import { buildAtomCompatRoutes } from "@main/atom/compat/routes";
import { buildHeadlessRoutes } from "@main/atom/headless/routes";

/**
 * 构建 Web 与 Desktop 内部 Control 共用的完整 Core Protocol router。
 *
 * Headless domain routes 与 retained compatibility thin routes 只在这里组合一次，
 * 避免 Desktop 内部 transport 漏掉 Library/Playlist 等已有正式 Control contract。
 */
export const buildCoreControlRoutes = (): Hono => {
  const api = new Hono();
  api.route("/", buildHeadlessRoutes());
  api.route("/", buildAtomCompatRoutes());
  return api;
};
