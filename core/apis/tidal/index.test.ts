import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("TIDAL logout invalidates in-flight and queued authentication writes", async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "splayer-tidal-logout-"));
  const previousDataDir = process.env.ATOM_DATA_DIR;
  process.env.ATOM_DATA_DIR = dataDir;
  const nativeKey = Symbol.for("splayer.tidal-logout-native");
  let nativeCall: (action: string) => Promise<unknown>;
  Reflect.set(globalThis, nativeKey, (_platform: string, action: string) => nativeCall(action));
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier === "@main/apis/streamingNative" &&
        context.parentURL?.endsWith("/apis/tidal/index.ts")
      ) {
        return {
          url: 'data:text/javascript,export const callStreamingNative=(...args)=>globalThis[Symbol.for("splayer.tidal-logout-native")](...args)',
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  try {
    const { callTidal } = await import("./index");
    const { getTidalAuth, setTidalAuth } = await import("./auth");
    const { configDir } = await import("@main/utils/paths");
    const authFile = path.join(configDir, "tidal.json");
    const assertLoggedOut = () => {
      assert.equal(getTidalAuth(), null);
      assert.equal(existsSync(authFile), false);
    };

    for (const action of ["auth_token_poll", "auth_exchange", "auth_token_refresh"]) {
      await t.test(`late ${action} cannot restore credentials after logout`, async () => {
        setTidalAuth({ accessToken: "old-token" });
        const pending = deferred();
        const started = deferred();
        nativeCall = async (name) => {
          if (name === "auth_logout") return { status: "success" };
          assert.equal(name, action);
          started.resolve(undefined);
          return pending.promise;
        };
        const request = callTidal(action);
        await started.promise;
        const rejected = assert.rejects(request, /superseded by logout/);
        await callTidal("auth_logout");
        assertLoggedOut();
        pending.resolve({ status: "success", accessToken: "late-token" });
        await rejected;
        assertLoggedOut();
      });
    }

    await t.test("logout discards queued authentication and permits a new login", async () => {
      setTidalAuth({ accessToken: "old-token" });
      const pending = deferred();
      const started = deferred();
      const calls: string[] = [];
      nativeCall = async (action) => {
        calls.push(action);
        if (action === "auth_logout") return { status: "success" };
        if (action === "album_get") {
          started.resolve(undefined);
          return pending.promise;
        }
        assert.equal(action, "auth_exchange");
        return { status: "success", accessToken: "new-login-token" };
      };
      const first = callTidal("album_get");
      await started.promise;
      const queued = callTidal("auth_token_poll");
      const firstRejected = assert.rejects(first, /superseded by logout/);
      const queuedRejected = assert.rejects(queued, /superseded by logout/);
      await callTidal("logout");
      assertLoggedOut();
      const newLogin = callTidal("auth_exchange");
      pending.resolve({ album: { id: "album" } });
      await Promise.all([firstRejected, queuedRejected, newLogin]);
      assert.deepEqual(calls, ["album_get", "auth_logout", "auth_exchange"]);
      assert.equal(getTidalAuth()?.accessToken, "new-login-token");
      assert.equal(existsSync(authFile), true);
    });

    for (const failed of [false, true]) {
      await t.test(
        `late implicit refresh ${failed ? "error" : "success"} cannot write credentials`,
        async () => {
          setTidalAuth({ accessToken: "old-token" });
          const pending = deferred();
          const started = deferred();
          nativeCall = async (action) => {
            if (action === "auth_logout") return { status: "success" };
            started.resolve(undefined);
            return pending.promise;
          };
          const request = callTidal("album_get");
          await started.promise;
          const error = Object.assign(new Error("request failed after refresh"), {
            refreshedAuth: { accessToken: "late-refresh-token" },
          });
          const rejected = assert.rejects(
            request,
            failed ? (value) => value === error : /superseded by logout/,
          );
          await callTidal("auth_logout");
          if (failed) pending.reject(error);
          else pending.resolve({ result: { album: {} }, refreshedAuth: error.refreshedAuth });
          await rejected;
          assertLoggedOut();
        },
      );
    }
  } finally {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, nativeKey);
    if (previousDataDir === undefined) delete process.env.ATOM_DATA_DIR;
    else process.env.ATOM_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
