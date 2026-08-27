import { QOBUZ_WEB_BASE, QOBUZ_WEB_USER_AGENT } from "./config";

export interface QobuzAppCredentials {
  appId: string;
  secrets: string[];
  source: "env" | "web-player";
}

let cachedCredentials: QobuzAppCredentials | null = null;
let discoveryPromise: Promise<QobuzAppCredentials> | null = null;

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

/**
 * 从 Qobuz 登录页定位当前 Web Player bundle。
 * 路线与 qobuz-dl 的 Bundle discovery 相同，但 Atom 不依赖 qobuz-dl 本身。
 */
export const extractQobuzBundleUrl = (html: string): string => {
  const match = html.match(/<script[^>]+src=["']([^"']*\/resources\/[^"']*\/bundle\.js(?:\?[^"']*)?)["']/i);
  if (!match?.[1]) throw new Error("Qobuz Web Player 页面中未找到 bundle.js");
  return new URL(match[1], QOBUZ_WEB_BASE).toString();
};

/** 从 production API 配置块读取 app id；不扫描无关数字。 */
export const extractQobuzAppId = (bundle: string): string => {
  const match = bundle.match(/production\s*:\s*\{\s*api\s*:\s*\{[^}]*?appId\s*:\s*["'](\d+)["']/);
  if (!match?.[1]) throw new Error("Qobuz Web Player bundle 中未找到 production appId");
  return match[1];
};

/**
 * 按 qobuz-dl / tinyLMS 已验证的 seed + timezone 路线推导签名 secret 候选。
 * production 块中的字面 appSecret 只作为最后一个候选；2026 Web Player 上真正可用的
 * getFileUrl secret 仍可能来自 timezone 派生值。
 */
export const extractQobuzSecrets = (bundle: string): string[] => {
  const seeds = new Map<string, string>();
  const seedPattern = /[\w$]+\.initialSeed\(["']([\w+/=]+)["']\s*,\s*window\.utimezone\.([a-z]+)\)/g;
  for (const match of bundle.matchAll(seedPattern)) {
    if (!seeds.has(match[2])) seeds.set(match[2], match[1]);
  }

  const derived: string[] = [];
  if (seeds.size > 0) {
    const timezones = [...seeds.keys()].map((value) => value[0].toUpperCase() + value.slice(1));
    const timezonePattern = new RegExp(
      `name:["']\\w+/(${timezones.join("|")})["'],info:["']([\\w+/=]+)["'],extras:["']([\\w+/=]+)["']`,
      "g",
    );
    for (const match of bundle.matchAll(timezonePattern)) {
      const timezone = match[1].toLowerCase();
      const seed = seeds.get(timezone);
      if (!seed) continue;
      const encoded = `${seed}${match[2]}${match[3]}`;
      if (encoded.length <= 44) continue;
      try {
        const secret = Buffer.from(encoded.slice(0, -44), "base64").toString("utf8").trim();
        if (/^[\w-]{16,64}$/.test(secret)) derived.push(secret);
      } catch {
        // Ignore a malformed candidate and keep trying the remaining timezone entries.
      }
    }
  }

  const literal = bundle.match(
    /production\s*:\s*\{\s*api\s*:\s*\{[^}]*?appId\s*:\s*["']\d+["'][^}]*?appSecret\s*:\s*["']([\w-]+)["']/,
  )?.[1];
  const secrets = unique([...derived, literal ?? ""]);
  if (secrets.length === 0) throw new Error("Qobuz Web Player bundle 中未能推导签名 secret");
  return secrets;
};

/** 从当前 Qobuz Web Player 自动发现应用凭据。 */
export const discoverQobuzAppCredentials = async (): Promise<QobuzAppCredentials> => {
  const headers = { "User-Agent": QOBUZ_WEB_USER_AGENT, Accept: "text/html,*/*" };
  const loginResponse = await fetch(`${QOBUZ_WEB_BASE}/login`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!loginResponse.ok) throw new Error(`Qobuz Web Player 登录页请求失败: HTTP ${loginResponse.status}`);
  const bundleUrl = extractQobuzBundleUrl(await loginResponse.text());
  const bundleResponse = await fetch(bundleUrl, {
    headers: { "User-Agent": QOBUZ_WEB_USER_AGENT, Accept: "application/javascript,*/*" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!bundleResponse.ok) throw new Error(`Qobuz Web Player bundle 请求失败: HTTP ${bundleResponse.status}`);
  const bundle = await bundleResponse.text();
  return {
    appId: extractQobuzAppId(bundle),
    secrets: extractQobuzSecrets(bundle),
    source: "web-player",
  };
};

/**
 * 获取 Qobuz 应用凭据：显式环境变量优先，否则自动发现并仅在本进程内缓存。
 * 不读取 qobuz-dl 配置，也不把自动发现的 secret 写入磁盘。
 */
export const getQobuzAppCredentials = async (): Promise<QobuzAppCredentials> => {
  const envAppId = process.env.QOBUZ_APP_ID?.trim() ?? "";
  const envSecret = process.env.QOBUZ_APP_SECRET?.trim() ?? "";
  if (envAppId || envSecret) {
    if (!envAppId || !envSecret) {
      throw new Error("QOBUZ_APP_ID 与 QOBUZ_APP_SECRET 必须同时设置");
    }
    return { appId: envAppId, secrets: [envSecret], source: "env" };
  }
  if (cachedCredentials) return cachedCredentials;
  discoveryPromise ??= discoverQobuzAppCredentials();
  try {
    cachedCredentials = await discoveryPromise;
    return cachedCredentials;
  } catch (error) {
    discoveryPromise = null;
    throw error;
  }
};
