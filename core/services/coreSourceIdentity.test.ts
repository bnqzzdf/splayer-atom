import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseSourceCommitFile,
  resolveSourceIdentity,
  SOURCE_COMMIT_FILE,
} from "../../scripts/atom/sourceIdentity";

const SHA = "ce1f8bcba9ed115a8212c40b9ae7f3e596bfa989";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** 建一个不含 .git 的临时目录，模拟解压后的源码交付包。 */
const makePackageDir = (sourceCommit?: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "atom-pkg-"));
  if (sourceCommit !== undefined) {
    writeFileSync(path.join(dir, SOURCE_COMMIT_FILE), sourceCommit);
  }
  return dir;
};

const ENV_KEYS = ["ATOM_COMMIT", "ATOM_COMMIT_DIRTY", "ATOM_COMMIT_DATE"] as const;

/** 临时改写身份相关环境变量，结束后无条件还原。 */
const withEnv = (
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  run: () => void,
): void => {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) {
      const value = values[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
};

const withPackageDir = (sourceCommit: string | undefined, run: (dir: string) => void): void => {
  const dir = makePackageDir(sourceCommit);
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("SOURCE_COMMIT 文件支持 key=value 与裸 SHA 两种写法", () => {
  const full = parseSourceCommitFile(
    `# 交付包自带的构建身份\ncommit=${SHA}\ndirty=false\ndate=2026-09-22T10:00:00+08:00\n`,
  );
  assert.deepEqual(full, { commit: SHA, dirty: false, date: "2026-09-22T10:00:00+08:00" });

  assert.deepEqual(parseSourceCommitFile(`${SHA}\n`), { commit: SHA, dirty: false });
  assert.equal(parseSourceCommitFile(`commit=${SHA}\ndirty=true\n`)?.dirty, true);

  // 拒绝不像 commit 的内容，避免把垃圾写进 runtime.json
  assert.equal(parseSourceCommitFile("not-a-sha\n"), null);
  assert.equal(parseSourceCommitFile(""), null);
  assert.equal(parseSourceCommitFile("# 只有注释\n"), null);
});

test("有 git 工作树时以 git 为准（开发构建路径不变）", () => {
  const identity = resolveSourceIdentity(REPO_ROOT);
  assert.ok(identity, "仓库内应当能解析出构建身份");
  assert.equal(identity.origin, "git");
  assert.match(identity.commit, /^[0-9a-f]{40}$/);
});

test("无 .git 时优先采用 ATOM_COMMIT 环境变量", () => {
  withPackageDir(`commit=${"a".repeat(40)}\n`, (dir) => {
    withEnv(
      {
        ATOM_COMMIT: SHA,
        ATOM_COMMIT_DIRTY: "true",
        ATOM_COMMIT_DATE: "2026-09-22T10:00:00+08:00",
      },
      () => {
        const identity = resolveSourceIdentity(dir);
        assert.equal(identity?.origin, "env");
        assert.equal(identity?.commit, SHA);
        assert.equal(identity?.dirty, true);
        assert.equal(identity?.date, "2026-09-22T10:00:00+08:00");
      },
    );
  });
});

test("无 .git 且无环境变量时回落到包内 SOURCE_COMMIT（交付包可独立编译的关键）", () => {
  withPackageDir(
    `# 由打包脚本生成\ncommit=${SHA}\ndirty=false\ndate=2026-09-22T10:00:00+08:00\n`,
    (dir) => {
      withEnv({}, () => {
        const identity = resolveSourceIdentity(dir);
        assert.equal(identity?.origin, "file");
        assert.equal(identity?.commit, SHA);
        assert.equal(identity?.dirty, false);
        assert.equal(identity?.date, "2026-09-22T10:00:00+08:00");
      });
    },
  );
});

test("三条来源都不可用时返回 null，由调用方报错而不是编造 commit", () => {
  withPackageDir(undefined, (dir) => {
    withEnv({}, () => {
      assert.equal(resolveSourceIdentity(dir), null);
    });
    // 环境变量存在但不像 commit 时同样不能采信
    withEnv({ ATOM_COMMIT: "  not-a-sha  " }, () => {
      assert.equal(resolveSourceIdentity(dir), null);
    });
  });
});
