import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseSourceCommitFile,
  renderSourceCommitFile,
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

/**
 * 建一个临时 git 仓库，用来验证「已发布」判定。
 *
 * `remoteUrl` 给网络地址时顺带登记一个远端跟踪分支（模拟已推送）；
 * 给本地路径时只留本地分支，正是历史上「构建机锚定本地参考仓库」的形态。
 * `null` 表示不配远端。
 */
const makeGitRepo = (remoteUrl: string | null): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "atom-git-"));
  const git = (...gitArgs: string[]): string => {
    const result = spawnSync("git", gitArgs, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${gitArgs.join(" ")} 失败: ${result.stderr}`);
    return (result.stdout ?? "").trim();
  };
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "atom-test");
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  if (remoteUrl !== null) {
    git("remote", "add", "origin", remoteUrl);
    git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
  }
  return dir;
};

const withGitRepo = (remoteUrl: string | null, run: (dir: string) => void): void => {
  const dir = makeGitRepo(remoteUrl);
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
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(head.status, 0);
  assert.equal(identity.commit, head.stdout.trim());
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

test("已发布判定：只有网络远端上的提交才算已发布", () => {
  withGitRepo("https://github.com/bnqzzdf/splayer-atom.git", (dir) => {
    const identity = resolveSourceIdentity(dir);
    assert.equal(identity?.origin, "git");
    assert.equal(identity?.published, true);
    assert.equal(identity?.remote, "https://github.com/bnqzzdf/splayer-atom.git");
  });
  withGitRepo("git@github.com:bnqzzdf/splayer-atom.git", (dir) => {
    assert.equal(resolveSourceIdentity(dir)?.remote, "git@github.com:bnqzzdf/splayer-atom.git");
  });
});

test("已发布判定：网络远端不包含本地新提交时判为未发布", () => {
  withGitRepo("https://github.com/bnqzzdf/splayer-atom.git", (dir) => {
    writeFileSync(path.join(dir, "a.txt"), "本地新提交\n");
    for (const args of [
      ["add", "a.txt"],
      ["commit", "-qm", "local change"],
    ]) {
      const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const identity = resolveSourceIdentity(dir);
    assert.equal(identity?.origin, "git");
    assert.equal(identity?.published, false);
    assert.equal(identity?.remote, undefined);
  });
});

test("已发布判定：本地路径的参考仓库不算已发布（历史事故的形态）", () => {
  // build-from-pkg.sh 曾把工作树锚定到 /root/... 这样的本地仓库，
  // 产物因此带上了一个远端查不到的提交；本地路径远端必须判为未发布。
  withGitRepo("/root/splayer-atom-dev/splayer-atom-dev", (dir) => {
    const identity = resolveSourceIdentity(dir);
    assert.equal(identity?.origin, "git");
    assert.equal(identity?.published, false);
  });
  withGitRepo("file:///srv/git/splayer-atom.git", (dir) => {
    assert.equal(resolveSourceIdentity(dir)?.published, false);
  });
});

test("已发布判定：没有远端跟踪分支的仓库不算已发布", () => {
  withGitRepo(null, (dir) => {
    assert.equal(resolveSourceIdentity(dir)?.published, false);
  });
});

test("SOURCE_COMMIT 的 remote/published 决定已发布状态", () => {
  const declared = (remote: string): string => `commit=${SHA}\npublished=true\nremote=${remote}\n`;

  // 声明了网络远端：交付包能自证提交来源
  withPackageDir(declared("https://github.com/bnqzzdf/splayer-atom.git"), (dir) => {
    withEnv({}, () => assert.equal(resolveSourceIdentity(dir)?.published, true));
  });
  withPackageDir(declared("git@github.com:bnqzzdf/splayer-atom.git"), (dir) => {
    withEnv({}, () => assert.equal(resolveSourceIdentity(dir)?.published, true));
  });

  // 声明 published=true 但 remote 只是本地路径：一律按未发布处理
  withPackageDir(declared("/root/splayer-atom-dev/splayer-atom-dev"), (dir) => {
    withEnv({}, () => assert.equal(resolveSourceIdentity(dir)?.published, false));
  });

  // 根本没声明：判不出来，交给发布构建拒绝，不要默认成已发布
  withPackageDir(`commit=${SHA}\ndirty=false\n`, (dir) => {
    withEnv({}, () => assert.equal(resolveSourceIdentity(dir)?.published, undefined));
  });
});

test("SOURCE_COMMIT 解析：未声明 published 时该字段留空", () => {
  assert.equal(
    parseSourceCommitFile(`commit=${SHA}\npublished=true\nremote=git@github.com:x/y.git\n`)
      ?.published,
    true,
  );
  assert.equal(parseSourceCommitFile(`commit=${SHA}\npublished=false\n`)?.published, false);
  assert.equal(parseSourceCommitFile(`commit=${SHA}\n`)?.published, undefined);
  // 只有裸 SHA 的旧包仍能解析，只是判不出发布状态
  assert.deepEqual(parseSourceCommitFile(`${SHA}\n`), { commit: SHA, dirty: false });
});

test("SOURCE_COMMIT 渲染与解析往返一致，且渲染结果自证为已发布", () => {
  const identity = {
    commit: SHA,
    dirty: false,
    date: "2026-09-24T10:25:05+08:00",
    origin: "git" as const,
    published: true,
    remote: "https://github.com/bnqzzdf/splayer-atom.git",
  };
  const text = renderSourceCommitFile(identity);

  // 写入端渲染出来的文件，解析端必须还原出同一份身份
  assert.deepEqual(parseSourceCommitFile(text), {
    commit: SHA,
    dirty: false,
    date: "2026-09-24T10:25:05+08:00",
    published: true,
  });
  // 而且构建端要判定它为已发布——否则交付包会被自己的身份文件挡住
  withPackageDir(text, (dir) => {
    withEnv({}, () => {
      const resolved = resolveSourceIdentity(dir);
      assert.equal(resolved?.origin, "file");
      assert.equal(resolved?.published, true);
      assert.equal(resolved?.commit, SHA);
    });
  });

  // 没有网络远端时拒绝生成，而不是写一个校验端不认的包
  const { remote: _remote, ...withoutRemote } = identity;
  assert.throws(() => renderSourceCommitFile(withoutRemote), /需要网络远端地址/);
  assert.throws(
    () => renderSourceCommitFile({ ...identity, remote: "/root/splayer-atom-dev/x" }),
    /需要网络远端地址/,
  );
});
