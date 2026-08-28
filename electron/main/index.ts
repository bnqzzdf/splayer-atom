import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { app, net, safeStorage } from "electron";
import { configureRuntimeFetch } from "./atom/runtime/fetch";
import { configureRuntimeSecretCodec } from "./atom/runtime/secrets";

const configureElectronRuntime = (): void => {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    const portableUserData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "UserData");
    if (!existsSync(portableUserData)) mkdirSync(portableUserData, { recursive: true });
    app.setPath("userData", portableUserData);
  }

  process.env.ATOM_APP_NAME = app.getName();
  process.env.ATOM_APP_VERSION = app.getVersion();
  process.env.ATOM_APP_PACKAGED = app.isPackaged ? "1" : "0";
  process.env.ATOM_USER_DATA_DIR = app.getPath("userData");
  process.env.ATOM_MUSIC_DIR = app.getPath("music");
  process.env.ATOM_TEMP_DIR = app.getPath("temp");
  process.env.ATOM_RESOURCES_DIR = process.resourcesPath;

  configureRuntimeFetch((input, init) => net.fetch(input, init));
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
