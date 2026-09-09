import { Hono } from "hono";
import { buildAtomCompatRoutes } from "@main/atom/compat/routes";
import { buildHeadlessRoutes } from "@main/atom/headless/routes";

/**
 * 构建 Web Control 使用的完整 Core Protocol router。
 *
 * Headless domain routes 与 retained compatibility thin routes 只在这里组合一次，
 * 所有正式 Control contract 都从这里进入，避免出现第二套路由表。
 */
export const buildCoreControlRoutes = (): Hono => {
  const api = new Hono();
  api.route("/", buildHeadlessRoutes());
  api.route("/", buildAtomCompatRoutes());
  return api;
};
