import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ListenBrainzTrackSnapshot } from "@shared/types/listenbrainz";
import { databaseDir } from "@main/utils/paths";

const API_ROOT = "https://api.listenbrainz.org/1";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const OUTBOX_FILE = path.join(databaseDir, "listenbrainz-outbox.db");

interface ChildConfig {
  token: string;
  sendNowPlaying: boolean;
  appVersion: string;
}

type ParentMessage =
  | { type: "configure"; token: string; sendNowPlaying: boolean; appVersion: string }
  | { type: "validate"; requestId: number; token: string }
  | { type: "listen"; captureId: string; track: ListenBrainzTrackSnapshot }
  | { type: "nowPlaying"; track: ListenBrainzTrackSnapshot }
  | { type: "clearNowPlaying" }
  | { type: "clearOutbox" }
  | { type: "shutdown" };

type RequestResult =
  | { kind: "success"; body?: unknown }
  | { kind: "retryable"; error: string; retryAt?: number }
  | { kind: "auth"; error: string }
  | { kind: "permanent"; error: string };

interface OutboxRow {
  id: number;
  payload: string;
  attempt_count: number;
}

const utilityParentPort = (process as any).parentPort as
  | {
      on(event: "message", listener: (event: { data: ParentMessage }) => void): void;
      postMessage(message: unknown): void;
    }
  | undefined;

const sendParent = (message: unknown): void => {
  if (utilityParentPort) utilityParentPort.postMessage(message);
  else process.send?.(message as any);
};

const listenParent = (listener: (message: ParentMessage) => void): boolean => {
  if (utilityParentPort) {
    utilityParentPort.on("message", (event) => listener(event.data));
    return true;
  }
  if (typeof process.send === "function") {
    process.on("message", (message) => listener(message as ParentMessage));
    return true;
  }
  return false;
};

const clipError = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 500);

const retryAtFromHeaders = (headers: Headers): number | undefined => {
  const now = Date.now();
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(now, date);
  }
  const resetIn = Number(headers.get("x-ratelimit-reset-in"));
  if (Number.isFinite(resetIn) && resetIn >= 0) return now + resetIn * 1000;
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(now, reset * 1000);
  return undefined;
};

const request = async (
  pathname: string,
  token: string,
  init: RequestInit,
): Promise<RequestResult> => {
  try {
    const response = await fetch(`${API_ROOT}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Token ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const text = await response.text();
      if (!text) return { kind: "success" };
      try {
        return { kind: "success", body: JSON.parse(text) };
      } catch {
        return { kind: "success" };
      }
    }
    const text = clipError(await response.text().catch(() => response.statusText));
    const error = text || `HTTP ${response.status}`;
    if (response.status === 401) return { kind: "auth", error };
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      return { kind: "retryable", error, retryAt: retryAtFromHeaders(response.headers) };
    }
    return { kind: "permanent", error };
  } catch (error) {
    return {
      kind: "retryable",
      error: clipError(error instanceof Error ? error.message : String(error)),
    };
  }
};

const makeListenPayload = (
  track: ListenBrainzTrackSnapshot,
  appVersion: string,
  playingNow: boolean,
): Record<string, unknown> => {
  const additionalInfo: Record<string, unknown> = {
    duration_ms: Math.max(0, Math.trunc(track.durationMs)),
    media_player: "SPlayer Atom",
    media_player_version: appVersion,
    submission_client: "SPlayer Atom",
    submission_client_version: appVersion,
  };
  if (track.trackNumber != null && Number.isFinite(track.trackNumber)) {
    additionalInfo.tracknumber = String(Math.trunc(track.trackNumber));
  }
  const trackMetadata: Record<string, unknown> = {
    artist_name: track.artistName,
    track_name: track.trackName,
    additional_info: additionalInfo,
  };
  if (track.releaseName) trackMetadata.release_name = track.releaseName;
  return {
    ...(playingNow ? {} : { listened_at: track.listenedAt }),
    track_metadata: trackMetadata,
  };
};

const start = (): void => {
  if (!fs.existsSync(databaseDir)) fs.mkdirSync(databaseDir, { recursive: true });
  const db = new Database(OUTBOX_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS listenbrainz_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id TEXT,
      payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_listenbrainz_outbox_pending
      ON listenbrainz_outbox(state, next_attempt_at, id);
  `);
  const columns = db.prepare("PRAGMA table_info(listenbrainz_outbox)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "capture_id")) {
    db.exec("ALTER TABLE listenbrainz_outbox ADD COLUMN capture_id TEXT");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_listenbrainz_outbox_capture
      ON listenbrainz_outbox(capture_id) WHERE capture_id IS NOT NULL;
  `);

  const insertListen = db.prepare(
    `INSERT OR IGNORE INTO listenbrainz_outbox
      (capture_id, payload, state, attempt_count, next_attempt_at, last_error, created_at)
     VALUES (?, ?, 'pending', 0, 0, NULL, ?)`,
  );
  const nextListen = db.prepare(
    `SELECT id, payload, attempt_count FROM listenbrainz_outbox
     WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 1`,
  );
  const markRetry = db.prepare(
    `UPDATE listenbrainz_outbox
     SET attempt_count = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
  );
  const markAuth = db.prepare(
    `UPDATE listenbrainz_outbox SET state = 'auth_error', last_error = ? WHERE id = ?`,
  );
  const markDead = db.prepare(
    `UPDATE listenbrainz_outbox SET state = 'dead', last_error = ? WHERE id = ?`,
  );
  const removeListen = db.prepare("DELETE FROM listenbrainz_outbox WHERE id = ?");
  const pendingCount = db.prepare(
    "SELECT COUNT(*) AS count FROM listenbrainz_outbox WHERE state IN ('pending', 'auth_error')",
  );
  const deadCount = db.prepare(
    "SELECT COUNT(*) AS count FROM listenbrainz_outbox WHERE state = 'dead'",
  );
  const nextRetry = db.prepare(
    "SELECT MIN(next_attempt_at) AS at FROM listenbrainz_outbox WHERE state = 'pending'",
  );
  const clearOutbox = db.prepare("DELETE FROM listenbrainz_outbox");
  const rearmAuth = db.prepare(
    "UPDATE listenbrainz_outbox SET state = 'pending', next_attempt_at = 0 WHERE state = 'auth_error'",
  );
  const trimDead = db.prepare(
    `DELETE FROM listenbrainz_outbox WHERE id IN (
       SELECT id FROM listenbrainz_outbox WHERE state = 'dead' ORDER BY id DESC LIMIT -1 OFFSET 1000
     )`,
  );

  let config: ChildConfig = { token: "", sendNowPlaying: true, appVersion: "1.0.0" };
  let state: "unconfigured" | "ready" | "retrying" | "auth_error" | "error" = "unconfigured";
  let lastError: string | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let draining = false;
  let shuttingDown = false;
  let latestNowPlaying: ListenBrainzTrackSnapshot | null = null;
  let sendingNowPlaying = false;

  const count = (statement: Database.Statement): number =>
    Number((statement.get() as { count?: number } | undefined)?.count ?? 0);

  const publishStatus = (): void => {
    sendParent({
      type: "status",
      state,
      pending: count(pendingCount),
      dead: count(deadCount),
      lastError,
    });
  };

  const clearDrainTimer = (): void => {
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = null;
  };

  const backoffMs = (attempt: number): number =>
    Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.min(Math.max(0, attempt - 1), 8));

  const scheduleDrain = (at = Date.now()): void => {
    clearDrainTimer();
    if (shuttingDown || !config.token) return;
    drainTimer = setTimeout(
      () => {
        drainTimer = null;
        void drain();
      },
      Math.max(0, at - Date.now()),
    );
  };

  const drain = async (): Promise<void> => {
    if (draining || shuttingDown || !config.token) return;
    draining = true;
    try {
      while (!shuttingDown && config.token) {
        const row = nextListen.get(Date.now()) as OutboxRow | undefined;
        if (!row) break;
        const result = await request("/submit-listens", config.token, {
          method: "POST",
          body: JSON.stringify({ listen_type: "single", payload: [JSON.parse(row.payload)] }),
        });
        if (result.kind === "success") {
          removeListen.run(row.id);
          state = "ready";
          lastError = null;
          publishStatus();
          continue;
        }
        if (result.kind === "auth") {
          markAuth.run(result.error, row.id);
          state = "auth_error";
          lastError = result.error;
          publishStatus();
          break;
        }
        if (result.kind === "permanent") {
          markDead.run(result.error, row.id);
          trimDead.run();
          state = "ready";
          lastError = result.error;
          publishStatus();
          continue;
        }
        const attempt = row.attempt_count + 1;
        const retryAt = result.retryAt ?? Date.now() + backoffMs(attempt);
        markRetry.run(attempt, retryAt, result.error, row.id);
        state = "retrying";
        lastError = result.error;
        publishStatus();
        scheduleDrain(retryAt);
        break;
      }
      if (!drainTimer && config.token && !shuttingDown) {
        const at = Number((nextRetry.get() as { at?: number | null } | undefined)?.at ?? 0);
        if (at > Date.now()) scheduleDrain(at);
        else if (at > 0) scheduleDrain();
      }
    } catch (error) {
      state = "error";
      lastError = clipError(error instanceof Error ? error.message : String(error));
      publishStatus();
      scheduleDrain(Date.now() + 5000);
    } finally {
      draining = false;
    }
  };

  const pumpNowPlaying = async (): Promise<void> => {
    if (sendingNowPlaying || shuttingDown || !config.token || !config.sendNowPlaying) return;
    const track = latestNowPlaying;
    if (!track) return;
    latestNowPlaying = null;
    sendingNowPlaying = true;
    const result = await request("/submit-listens", config.token, {
      method: "POST",
      body: JSON.stringify({
        listen_type: "playing_now",
        payload: [makeListenPayload(track, config.appVersion, true)],
      }),
    });
    if (result.kind === "auth") {
      state = "auth_error";
      lastError = result.error;
      publishStatus();
    }
    sendingNowPlaying = false;
    if (latestNowPlaying) void pumpNowPlaying();
  };

  const handle = (message: ParentMessage): void => {
    if (message.type === "configure") {
      const tokenChanged = message.token !== config.token;
      config = {
        token: message.token.trim(),
        sendNowPlaying: message.sendNowPlaying,
        appVersion: message.appVersion || "1.0.0",
      };
      if (!config.token) {
        clearDrainTimer();
        latestNowPlaying = null;
        state = "unconfigured";
        lastError = null;
        publishStatus();
        return;
      }
      if (tokenChanged) rearmAuth.run();
      state = "ready";
      lastError = null;
      publishStatus();
      scheduleDrain();
      return;
    }

    if (message.type === "validate") {
      void request("/validate-token", message.token.trim(), { method: "GET" }).then((result) => {
        if (result.kind !== "success") {
          sendParent({
            type: "validateResult",
            requestId: message.requestId,
            ok: false,
            error: result.error,
          });
          return;
        }
        const body = result.body as { valid?: boolean; user_name?: string } | undefined;
        const account = body?.valid ? String(body.user_name ?? "").trim() : "";
        sendParent({
          type: "validateResult",
          requestId: message.requestId,
          ok: Boolean(account),
          account: account || undefined,
          error: account ? undefined : "ListenBrainz token 无效",
        });
      });
      return;
    }

    if (message.type === "listen") {
      const payload = makeListenPayload(message.track, config.appVersion, false);
      insertListen.run(message.captureId, JSON.stringify(payload), Date.now());
      sendParent({ type: "captured", captureId: message.captureId });
      publishStatus();
      scheduleDrain();
      return;
    }

    if (message.type === "nowPlaying") {
      latestNowPlaying = message.track;
      void pumpNowPlaying();
      return;
    }

    if (message.type === "clearNowPlaying") {
      latestNowPlaying = null;
      if (config.token) {
        void request("/playing-now/delete", config.token, {
          method: "POST",
          body: JSON.stringify({ client: "SPlayer Atom" }),
        });
      }
      return;
    }

    if (message.type === "clearOutbox") {
      clearOutbox.run();
      state = config.token ? "ready" : "unconfigured";
      lastError = null;
      publishStatus();
      return;
    }

    if (message.type === "shutdown") {
      shuttingDown = true;
      clearDrainTimer();
      try {
        db.close();
      } finally {
        process.exit(0);
      }
    }
  };

  publishStatus();
  listenParent(handle);
};

if (utilityParentPort || typeof process.send === "function") start();
