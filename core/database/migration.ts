import type Database from "better-sqlite3";

/** 当前数据库 schema 版本。Core 升级 preflight 复用此值，禁止维护第二份版本常量。 */
export const DATABASE_SCHEMA_VERSION = 6;

type TableInfoRow = { name: string };

/** 判断表是否存在指定列 */
const hasColumn = (d: Database.Database, table: string, column: string): boolean => {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.some((r) => r.name === column);
};

/** 执行数据库迁移；未知未来版本必须拒绝，已知迁移在同一事务内完成。 */
export const migrate = (d: Database.Database): void => {
  const version = d.pragma("user_version", { simple: true }) as number;
  if (version > DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `Database schema ${version} is newer than supported ${DATABASE_SCHEMA_VERSION}`,
    );
  }

  const runMigration = d.transaction(() => {
    let v = version;

    // v1 → v2: 添加 file_mtime / file_ctime 列
    if (v < 2) {
      if (!hasColumn(d, "tracks", "file_mtime")) {
        d.exec("ALTER TABLE tracks ADD COLUMN file_mtime INTEGER");
      }
      if (!hasColumn(d, "tracks", "file_ctime")) {
        d.exec("ALTER TABLE tracks ADD COLUMN file_ctime INTEGER");
      }
      v = 2;
    }

    // v2 → v3: 添加 track 列
    if (v < 3) {
      if (!hasColumn(d, "tracks", "track")) {
        d.exec("ALTER TABLE tracks ADD COLUMN track INTEGER");
      }
      v = 3;
    }

    // v3 → v4: 添加 CUE 分轨列
    if (v < 4) {
      if (!hasColumn(d, "tracks", "cue_path")) {
        d.exec("ALTER TABLE tracks ADD COLUMN cue_path TEXT");
      }
      if (!hasColumn(d, "tracks", "cue_audio_path")) {
        d.exec("ALTER TABLE tracks ADD COLUMN cue_audio_path TEXT");
      }
      if (!hasColumn(d, "tracks", "cue_start_ms")) {
        d.exec("ALTER TABLE tracks ADD COLUMN cue_start_ms INTEGER");
      }
      if (!hasColumn(d, "tracks", "cue_end_ms")) {
        d.exec("ALTER TABLE tracks ADD COLUMN cue_end_ms INTEGER");
      }
      v = 4;
    }

    // v4 → v5: 旧 Native DSD 扫描未读取容器标签。只作废一次文件指纹，
    // 让下一轮增量扫描重新入库；成功后 scanner 会写回真实 mtime，恢复正常增量跳过。
    if (v < 5) {
      if (
        hasColumn(d, "tracks", "path") &&
        hasColumn(d, "tracks", "file_mtime") &&
        hasColumn(d, "tracks", "cue_path")
      ) {
        d.exec(`
          UPDATE tracks
          SET file_mtime = NULL
          WHERE cue_path IS NULL
            AND (
              lower(path) LIKE '%.dsf'
              OR lower(path) LIKE '%.dff'
              OR lower(path) LIKE '%.dsdiff'
            )
        `);
      }
      v = 5;
    }

    // v5 → v6: 保留 CUE 原始 75fps INDEX 坐标，Direct 路径据此换算精确 sample/bit 边界。
    if (v < 6) {
      if (!hasColumn(d, "tracks", "cue_start_frame75")) {
        d.exec("ALTER TABLE tracks ADD COLUMN cue_start_frame75 INTEGER");
      }
      if (!hasColumn(d, "tracks", "cue_end_frame75")) {
        d.exec("ALTER TABLE tracks ADD COLUMN cue_end_frame75 INTEGER");
      }
      if (hasColumn(d, "tracks", "cue_start_ms")) {
        d.exec(`
          UPDATE tracks
          SET cue_start_frame75 = ROUND(cue_start_ms * 75.0 / 1000.0)
          WHERE cue_start_ms IS NOT NULL AND cue_start_frame75 IS NULL
        `);
      }
      if (hasColumn(d, "tracks", "cue_end_ms")) {
        // 只有能与同一 CUE 的下一条起点对应时才回填 end；最后一轨保持 NULL，直接读到物理 EOF。
        d.exec(`
          UPDATE tracks AS current
          SET cue_end_frame75 = ROUND(current.cue_end_ms * 75.0 / 1000.0)
          WHERE current.cue_end_ms IS NOT NULL
            AND current.cue_end_frame75 IS NULL
            AND EXISTS (
              SELECT 1
              FROM tracks AS next
              WHERE next.cue_path = current.cue_path
                AND next.cue_audio_path = current.cue_audio_path
                AND next.cue_start_ms = current.cue_end_ms
            )
        `);
      }
      v = 6;
    }

    // 版本无关部分：补 lyric_match_cache.extra 列。
    if (!hasColumn(d, "lyric_match_cache", "extra")) {
      d.exec("ALTER TABLE lyric_match_cache ADD COLUMN extra TEXT");
    }

    if (v < DATABASE_SCHEMA_VERSION) v = DATABASE_SCHEMA_VERSION;
    if (v !== version) d.pragma(`user_version = ${v}`);
  });
  runMigration();
};
