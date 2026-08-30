import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { app, net, safeStorage, utilityProcess } from "electron";
import { configureRuntimeFetch } from "./atom/runtime/fetch";
import { configureRuntimePluginHost } from "./atom/runtime/pluginHost";
import { configureRuntimeSecretCodec } from "./atom/runtime/secrets";

const readDesktopReleaseIdentity = (): {
  atomCommit?: string;
  atomSourceDirty?: boolean;
  splayerBaseline?: string;
} => {
  try {
    return JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as {
      atomCommit?: string;
      atomSourceDirty?: boolean;
      splayerBaseline?: string;
    };
  } catch {
    return {};
  }
};

const configureElectronRuntime = (): void => {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    const portableUserData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "UserData");
    if (!existsSync(portableUserData)) mkdirSync(portableUserData, { recursive: true });
    app.setPath("userData", portableUserData);
  }

  process.env.ATOM_APP_NAME = app.getName();
  process.env.ATOM_APP_VERSION = app.getVersion();
  process.env.ATOM_APP_PACKAGED = app.isPackaged ? "1" : "0";
  const releaseIdentity = readDesktopReleaseIdentity();
  if (releaseIdentity.atomCommit) process.env.ATOM_COMMIT = releaseIdentity.atomCommit;
  if (releaseIdentity.atomSourceDirty !== undefined) {
    process.env.ATOM_SOURCE_DIRTY = releaseIdentity.atomSourceDirty ? "1" : "0";
  }
  if (releaseIdentity.splayerBaseline) {
    process.env.ATOM_SPLAYER_BASELINE = releaseIdentity.splayerBaseline;
  }
  process.env.ATOM_USER_DATA_DIR = app.getPath("userData");
  process.env.ATOM_MUSIC_DIR = app.getPath("music");
  process.env.ATOM_TEMP_DIR = app.getPath("temp");
  process.env.ATOM_RESOURCES_DIR = process.resourcesPath;

  configureRuntimeFetch((input, init) => net.fetch(input, init));
  configureRuntimePluginHost({
    entry: path.join(app.getAppPath(), "out", "main", "host.worker.js"),
    spawn: (entry) => {
      const child = utilityProcess.fork(entry, [], {
        serviceName: "splayer-plugin-host",
        stdio: "pipe",
      });
      return {
        stdout: child.stdout,
        stderr: child.stderr,
        onMessage: (listener) => child.on("message", listener),
        onExit: (listener) => child.on("exit", listener),
        postMessage: (message) => child.postMessage(message),
        kill: () => child.kill(),
      };
    },
  });
  configureRuntimeSecretCodec({
    protectedAtRest: safeStorage.isEncryptionAvailable(),
    encode: (plain) =>
      safeStorage.isEncryptionAvailable()
        ? `safe:${safeStorage.encryptString(plain).toString("base64")}`
        : `plain:${Buffer.from(plain, "utf8").toString("base64")}`,
    decode: (stored) => {
      if (stored.startsWith("plain:")) {
        return Buffer.from(stored.slice("plain:".length), "base64").toString("utf8");
      }
      const encoded = stored.startsWith("safe:") ? stored.slice("safe:".length) : stored;
      const buffer = Buffer.from(encoded, "base64");
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : "";
    },
  });
};

configureElectronRuntime();
void import("./core").then(({ initApp }) => initApp());
