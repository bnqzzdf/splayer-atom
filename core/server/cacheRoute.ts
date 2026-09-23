import { existsSync } from "node:fs";
import path from "node:path";
import type { MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

/** 创建跟随当前缓存根目录变化的静态文件路由。 */
export const createDynamicCacheRoute = (
  prefix: string,
  getRoot: () => string,
  repairMissing?: (relativePath: string) => Promise<boolean>,
): MiddlewareHandler => {
  let activeRoot: string | null = null;
  let activeRoute: MiddlewareHandler | null = null;

  return async (context, next) => {
    const root = getRoot();
    const relativePath = context.req.path.slice(prefix.length).replace(/^\/+/, "");
    if (repairMissing && relativePath) {
      const target = path.resolve(root, relativePath);
      const relative = path.relative(root, target);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && !existsSync(target)) {
        await repairMissing(relativePath);
      }
    }
    if (!existsSync(root)) {
      activeRoot = null;
      activeRoute = null;
      return next();
    }
    if (root !== activeRoot || !activeRoute) {
      activeRoot = root;
      activeRoute = serveStatic({
        root,
        rewriteRequestPath: (requestPath) => requestPath.slice(prefix.length) || "/",
      });
    }
    return activeRoute(context, next);
  };
};
