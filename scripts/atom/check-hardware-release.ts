import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CoreInfo } from "../../shared/types/core";
import type {
  AudioDevice,
  AudioQuality,
  PlaybackSessionSnapshot,
  PlayerStatus,
  Track,
} from "../../shared/types/player";

const DEFAULT_BASE_URL = "http://127.0.0.1:14558";
const REQUEST_TIMEOUT_MS = 10_000;
const OBSERVATION_INTERVAL_MS = 5_000;

type ExpectedFormat = "pcm" | "native-dsd";

export interface HardwareReleaseOptions {
  baseUrl: string;
  artifactPath?: string;
  selectOutput?: string;
  play?: { index: number; expectedFormat: ExpectedFormat };
  observeSeconds: number;
  expectAdvances: number;
  help: boolean;
}

interface OutputSnapshot {
  selected: string | null;
  data: AudioDevice[];
}

interface SanitizedTrack {
  id: string;
  source: Track["source"];
  title: string;
  artists: string[];
  album?: string;
  duration: number;
  quality?: AudioQuality;
  format: ExpectedFormat | "unknown";
}

interface DiagnosticError {
  step: string;
  message: string;
}

interface DiagnosticAction {
  action: "select-output" | "play-queue-index";
  target: string | number;
  status: "PASS" | "FAIL";
}

export interface HardwareReleaseReport {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: boolean;
  baseUrl: string;
  artifact?: { file: string; size: number; sha256: string };
  core: CoreInfo | null;
  outputs: {
    selected: string | null;
    data: Array<AudioDevice & { kind: "alsa" | "diretta" | "system" }>;
  } | null;
  status: PlayerStatus | null;
  session: ReturnType<typeof sanitizeSession> | null;
  actions: DiagnosticAction[];
  observation: {
    durationSeconds: number;
    observedAdvances: number;
    expectedAdvances: number;
    status: "NOT_RUN" | "PASS" | "FAIL";
  };
  errors: DiagnosticError[];
}

const valueAfter = (args: string[], index: number): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${args[index]} 缺少参数值`);
  return value;
};

const integerAfter = (args: string[], index: number, min: number, max: number): number => {
  const raw = valueAfter(args, index);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${args[index]} 必须是 ${min}-${max} 的整数`);
  }
  return value;
};

const normalizeBaseUrl = (raw: string): string => {
  const url = new URL(raw);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("--base-url 必须是不含凭据、路径、查询参数的 HTTP(S) origin");
  }
  return url.origin;
};

/** 解析硬件验收 CLI；所有会改变播放/输出状态的动作都要求显式参数。 */
export const parseHardwareReleaseArgs = (args: string[]): HardwareReleaseOptions => {
  const options: HardwareReleaseOptions = {
    baseUrl: DEFAULT_BASE_URL,
    observeSeconds: 0,
    expectAdvances: 0,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help") options.help = true;
    else if (arg === "--base-url") {
      options.baseUrl = normalizeBaseUrl(valueAfter(args, index));
      index += 1;
    } else if (arg === "--artifact") {
      options.artifactPath = valueAfter(args, index);
      index += 1;
    } else if (arg === "--select-output") {
      options.selectOutput = valueAfter(args, index);
      index += 1;
    } else if (arg === "--play-pcm-index" || arg === "--play-dsd-index") {
      if (options.play) throw new Error("一次只能指定一个 PCM 或 Native DSD 播放 checkpoint");
      options.play = {
        index: integerAfter(args, index, 0, 100_000),
        expectedFormat: arg === "--play-pcm-index" ? "pcm" : "native-dsd",
      };
      index += 1;
    } else if (arg === "--observe-seconds") {
      options.observeSeconds = integerAfter(args, index, 1, 86_400);
      index += 1;
    } else if (arg === "--expect-advances") {
      options.expectAdvances = integerAfter(args, index, 1, 10_000);
      index += 1;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  if (options.expectAdvances > 0 && options.observeSeconds === 0) {
    throw new Error("--expect-advances 必须与 --observe-seconds 一起使用");
  }
  return options;
};

/** 只保留验收需要的 canonical Track 元数据，排除路径、封面和可播放 URL。 */
export const sanitizeTrack = (track: Track): SanitizedTrack => ({
  id: track.id,
  source: track.source,
  title: track.title,
  artists: track.artists.map((artist) => artist.name),
  ...(track.album?.name ? { album: track.album.name } : {}),
  duration: track.duration,
  ...(track.quality ? { quality: track.quality } : {}),
  format: classifyTrackFormat(track),
});

export const classifyTrackFormat = (track: Track): ExpectedFormat | "unknown" => {
  if (!track.quality) return "unknown";
  const codec = track.quality.codec.toLowerCase();
  if (track.quality.bitsPerSample === 1 || /(?:dsd|dsf|dff)/.test(codec)) return "native-dsd";
  return "pcm";
};

const sanitizeSession = (session: PlaybackSessionSnapshot) => ({
  active: session.active,
  mode: session.mode,
  index: session.index,
  repeat: session.repeat,
  shuffle: session.shuffle,
  current: session.current ? sanitizeTrack(session.current) : null,
  queue: session.queue.map((item, index) => ({
    index,
    selected: index === session.index,
    track: sanitizeTrack(item.track),
  })),
});

const classifyOutput = (device: AudioDevice): "alsa" | "diretta" | "system" => {
  if (device.id.startsWith("diretta:")) return "diretta";
  if (device.id.startsWith("alsa:")) return "alsa";
  return "system";
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "未知诊断错误";

const requestJson = async <T>(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${baseUrl}/api${endpoint}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
};

const artifactDigest = async (
  artifactPath: string,
): Promise<{ file: string; size: number; sha256: string }> => {
  const file = path.basename(artifactPath);
  try {
    const [metadata, sha256] = await Promise.all([
      stat(artifactPath),
      (async () => {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(artifactPath)) hash.update(chunk);
        return hash.digest("hex");
      })(),
    ]);
    if (!metadata.isFile()) throw new Error("not-file");
    return { file, size: metadata.size, sha256 };
  } catch {
    throw new Error(`无法读取 artifact ${file}`);
  }
};

const sessionFingerprint = (session: PlaybackSessionSnapshot): string =>
  `${session.index}:${session.current?.source ?? "none"}:${session.current?.id ?? "none"}`;

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

/**
 * 采集结构化硬件发布诊断；默认只读，动作失败不会通过修改 settings/database/session 绕过。
 * @param options - 已校验的 CLI 选项。
 * @returns 脱敏诊断报告。
 */
export const collectHardwareReleaseDiagnostic = async (
  options: HardwareReleaseOptions,
): Promise<HardwareReleaseReport> => {
  const errors: DiagnosticError[] = [];
  const actions: DiagnosticAction[] = [];
  let core: CoreInfo | null = null;
  let outputSnapshot: OutputSnapshot | null = null;
  let status: PlayerStatus | null = null;
  let session: PlaybackSessionSnapshot | null = null;
  let artifact: HardwareReleaseReport["artifact"];
  let didSelectOutput = false;
  let didPlay = false;

  const capture = async <T>(step: string, operation: () => Promise<T>): Promise<T | null> => {
    try {
      return await operation();
    } catch (error) {
      errors.push({ step, message: errorMessage(error) });
      return null;
    }
  };

  if (options.artifactPath) {
    artifact =
      (await capture("artifact-sha256", () => artifactDigest(options.artifactPath!))) ?? undefined;
  }

  [core, outputSnapshot, status, session] = await Promise.all([
    capture("GET /api/info", () => requestJson<CoreInfo>(options.baseUrl, "/info")),
    capture("GET /api/output/devices", () =>
      requestJson<OutputSnapshot>(options.baseUrl, "/output/devices"),
    ),
    capture("GET /api/status", () => requestJson<PlayerStatus>(options.baseUrl, "/status")),
    capture("GET /api/session", () =>
      requestJson<PlaybackSessionSnapshot>(options.baseUrl, "/session"),
    ),
  ]);

  if (options.selectOutput) {
    const target = options.selectOutput;
    let passed = false;
    if (!outputSnapshot) {
      errors.push({ step: "select-output", message: "无法读取 output snapshot" });
    } else if (!outputSnapshot.data.some((device) => device.id === target)) {
      errors.push({ step: "select-output", message: "目标不在当前 Core output snapshot 中" });
    } else {
      passed =
        (await capture("POST /api/output/select", () =>
          requestJson(options.baseUrl, "/output/select", {
            method: "POST",
            body: JSON.stringify({ deviceId: target }),
          }),
        )) !== null;
      didSelectOutput = passed;
    }
    actions.push({ action: "select-output", target, status: passed ? "PASS" : "FAIL" });
  }

  if (options.play) {
    const { index, expectedFormat } = options.play;
    const candidate = session?.queue[index]?.track;
    let passed = false;
    if (!candidate) {
      errors.push({ step: "play-queue-index", message: "队列索引不存在" });
    } else if (classifyTrackFormat(candidate) !== expectedFormat) {
      errors.push({
        step: "play-queue-index",
        message: `队列元数据不是预期的 ${expectedFormat}，未执行播放命令`,
      });
    } else {
      passed =
        (await capture("POST /api/session/queue/select", () =>
          requestJson<PlaybackSessionSnapshot>(options.baseUrl, "/session/queue/select", {
            method: "POST",
            body: JSON.stringify({ index, autoPlay: true, loadCurrent: true }),
          }),
        )) !== null;
      didPlay = passed;
    }
    actions.push({ action: "play-queue-index", target: index, status: passed ? "PASS" : "FAIL" });
  }

  if (didSelectOutput) {
    outputSnapshot = await capture("GET /api/output/devices after action", () =>
      requestJson<OutputSnapshot>(options.baseUrl, "/output/devices"),
    );
  }
  if (didSelectOutput || didPlay) {
    [status, session] = await Promise.all([
      capture("GET /api/status after action", () =>
        requestJson<PlayerStatus>(options.baseUrl, "/status"),
      ),
      capture("GET /api/session after action", () =>
        requestJson<PlaybackSessionSnapshot>(options.baseUrl, "/session"),
      ),
    ]);
  }

  let observedAdvances = 0;
  let previousFingerprint = session ? sessionFingerprint(session) : null;
  const observationEnd = Date.now() + options.observeSeconds * 1_000;
  while (Date.now() < observationEnd) {
    await wait(Math.min(OBSERVATION_INTERVAL_MS, observationEnd - Date.now()));
    const observed = await capture("GET /api/session observation", () =>
      requestJson<PlaybackSessionSnapshot>(options.baseUrl, "/session"),
    );
    if (!observed) continue;
    const fingerprint = sessionFingerprint(observed);
    if (previousFingerprint !== null && fingerprint !== previousFingerprint) observedAdvances += 1;
    previousFingerprint = fingerprint;
    session = observed;
  }

  const observationStatus =
    options.observeSeconds === 0
      ? "NOT_RUN"
      : observedAdvances >= options.expectAdvances
        ? "PASS"
        : "FAIL";
  if (observationStatus === "FAIL") {
    errors.push({
      step: "observe-session",
      message: `只观察到 ${observedAdvances} 次 track advance，预期至少 ${options.expectAdvances} 次`,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: !options.selectOutput && !options.play,
    baseUrl: options.baseUrl,
    ...(artifact ? { artifact } : {}),
    core,
    outputs: outputSnapshot
      ? {
          selected: outputSnapshot.selected,
          data: outputSnapshot.data.map((device) => ({ ...device, kind: classifyOutput(device) })),
        }
      : null,
    status,
    session: session ? sanitizeSession(session) : null,
    actions,
    observation: {
      durationSeconds: options.observeSeconds,
      observedAdvances,
      expectedAdvances: options.expectAdvances,
      status: observationStatus,
    },
    errors,
  };
};

const usage = `SPlayer Atom hardware release diagnostic

默认只读：pnpm check:hardware-release

选项：
  --base-url <origin>         Core origin，默认 ${DEFAULT_BASE_URL}
  --artifact <tar.gz>        计算 artifact SHA256，不输出本地绝对路径
  --select-output <deviceId> 显式切换现有 Core output
  --play-pcm-index <index>   显式播放队列中的 PCM track
  --play-dsd-index <index>   显式播放队列中的 Native DSD track
  --observe-seconds <n>      只读观察 session/auto-next，最长 86400 秒
  --expect-advances <n>      要求观察期至少发生 n 次 track advance
  --help                     显示帮助

脚本不写入队列、settings 或 database，也不能替代 DAC 前面板/bitstream 人工确认。`;

const main = async (): Promise<void> => {
  const options = parseHardwareReleaseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const report = await collectHardwareReleaseDiagnostic(options);
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length > 0 || report.actions.some((action) => action.status === "FAIL")) {
    process.exitCode = 1;
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[HardwareRelease] FAIL ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
