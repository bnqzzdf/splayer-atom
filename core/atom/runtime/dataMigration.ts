import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { CONFIG_SCHEMA_VERSION } from "./configSchema";
import { DATABASE_SCHEMA_VERSION } from "../../database/migration";
import { dataRoot as defaultDataRoot } from "../../utils/paths";

const SETTINGS_VERSION_KEY = "__configVersion";

export interface CoreDataSchemaState {
  databaseVersion: number | null;
  configVersion: number | null;
  databaseNeedsMigration: boolean;
  configNeedsMigration: boolean;
}

interface CoreDataPaths {
  dataRoot: string;
  databaseFile: string;
  configDir: string;
  settingsFile: string;
  backupsDir: string;
}

export interface CoreDataMigrationOptions {
  dataRoot?: string;
  now?: Date;
}

const resolvePaths = (dataRoot: string): CoreDataPaths => {
  const configDir = path.join(dataRoot, "config");
  return {
    dataRoot,
    databaseFile: path.join(dataRoot, "database", "library.db"),
    configDir,
    settingsFile: path.join(configDir, "settings.json"),
    backupsDir: path.join(dataRoot, "backups"),
  };
};

const readDatabaseVersion = (file: string): number | null => {
  if (!existsSync(file)) return null;
  const database = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return database.pragma("user_version", { simple: true }) as number;
  } finally {
    database.close();
  }
};

const readConfigVersion = (file: string): number | null => {
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const version = raw[SETTINGS_VERSION_KEY] ?? 0;
  if (!Number.isInteger(version) || Number(version) < 0) {
    throw new Error(`Invalid config schema version: ${String(version)}`);
  }
  return Number(version);
};

/** 在加载 store/database 前验证 durable schema，未知未来版本必须停止启动。 */
export const inspectCoreDataSchema = (dataRoot = defaultDataRoot): CoreDataSchemaState => {
  const paths = resolvePaths(dataRoot);
  const databaseVersion = readDatabaseVersion(paths.databaseFile);
  const configVersion = readConfigVersion(paths.settingsFile);
  if (databaseVersion !== null && databaseVersion > DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `Database schema ${databaseVersion} is newer than supported ${DATABASE_SCHEMA_VERSION}`,
    );
  }
  if (configVersion !== null && configVersion > CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Config schema ${configVersion} is newer than supported ${CONFIG_SCHEMA_VERSION}`,
    );
  }
  return {
    databaseVersion,
    configVersion,
    databaseNeedsMigration: databaseVersion !== null && databaseVersion < DATABASE_SCHEMA_VERSION,
    configNeedsMigration: configVersion !== null && configVersion < CONFIG_SCHEMA_VERSION,
  };
};

const timestampId = (now: Date): string => now.toISOString().replace(/[:.]/g, "-");
const quoteSqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** 创建迁移前一致性快照；DB 使用 VACUUM INTO，避免遗漏 WAL 中已提交的数据。 */
const createMigrationBackup = (
  state: CoreDataSchemaState,
  paths: CoreDataPaths,
  now: Date,
): string => {
  const backupDir = path.join(
    paths.backupsDir,
    `migration-${timestampId(now)}-db${state.databaseVersion ?? "new"}-cfg${state.configVersion ?? "new"}`,
  );
  mkdirSync(backupDir, { recursive: false });

  if (state.databaseVersion !== null) {
    const database = new Database(paths.databaseFile, { fileMustExist: true });
    try {
      database.exec(`VACUUM INTO ${quoteSqlString(path.join(backupDir, "library.db"))}`);
    } finally {
      database.close();
    }
  }
  if (state.configVersion !== null && existsSync(paths.configDir)) {
    cpSync(paths.configDir, path.join(backupDir, "config"), {
      recursive: true,
      preserveTimestamps: true,
    });
  }

  writeFileSync(
    path.join(backupDir, "manifest.json"),
    `${JSON.stringify(
      {
        createdAt: now.toISOString(),
        database: { from: state.databaseVersion, to: DATABASE_SCHEMA_VERSION },
        config: { from: state.configVersion, to: CONFIG_SCHEMA_VERSION },
      },
      null,
      2,
    )}\n`,
  );
  return backupDir;
};

/**
 * Core 启动迁移 preflight。只有既有 durable state 需要升级时才备份；新安装不创建空快照。
 * @returns 创建的备份目录；无需迁移时返回 null
 */
export const prepareCoreDataMigration = (options: CoreDataMigrationOptions = {}): string | null => {
  const dataRoot = options.dataRoot ?? defaultDataRoot;
  const state = inspectCoreDataSchema(dataRoot);
  if (!state.databaseNeedsMigration && !state.configNeedsMigration) return null;
  const paths = resolvePaths(dataRoot);
  mkdirSync(paths.backupsDir, { recursive: true });
  return createMigrationBackup(state, paths, options.now ?? new Date());
};
