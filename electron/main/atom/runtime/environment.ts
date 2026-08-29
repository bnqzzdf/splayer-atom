import os from "node:os";
import path from "node:path";

const envText = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value ? value : null;
};

const defaultUserDataDir = (): string => {
  if (process.platform === "linux") {
    return path.join(
      envText("XDG_DATA_HOME") ?? path.join(os.homedir(), ".local", "share"),
      "splayer-atom",
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "SPlayer Atom");
  }
  return path.join(envText("APPDATA") ?? os.homedir(), "SPlayer Atom");
};

/** Core / Desktop 共用的最小运行时环境，不依赖 Electron API。 */
export const runtimeEnvironment = {
  get appName(): string {
    return envText("ATOM_APP_NAME") ?? "SPlayer Atom";
  },
  get appVersion(): string {
    return envText("ATOM_APP_VERSION") ?? "1.0.0";
  },
  get isPackaged(): boolean {
    return process.env.ATOM_APP_PACKAGED === "1";
  },
  get userDataDir(): string {
    return envText("ATOM_USER_DATA_DIR") ?? defaultUserDataDir();
  },
  get musicDir(): string {
    return envText("ATOM_MUSIC_DIR") ?? path.join(os.homedir(), "Music");
  },
  get tempDir(): string {
    return envText("ATOM_TEMP_DIR") ?? os.tmpdir();
  },
  get resourcesDir(): string {
    return envText("ATOM_RESOURCES_DIR") ?? process.cwd();
  },
  get nativeDir(): string | null {
    return envText("ATOM_NATIVE_DIR");
  },
};
