# SPlayer Atom Upstream Sync

`docs/atom-roadmap.md` 定义长期模型：Atom 仓库保存完整可构建产品源码，SPlayer 上游只通过 fetch remote 与纯净 vendor 分支进入 Atom 历史。

## Git topology

```text
origin
  https://github.com/bnqzzdf/splayer-atom.git
  Atom 自有仓库；dev / main / release 的默认 push 目标

splayer
  https://github.com/SPlayer-Dev/SPlayer-Next.git
  只用于 fetch；本地配置会把 push URL 设为 DISABLED

vendor/splayer
  只允许指向官方 SPlayer commit，并且只能 fast-forward

dev / main
  完整 Atom 产品源码，只跟踪 origin
```

仓库内 `scripts/atom/upstream.json` 记录当前已经由 Atom 吸收并完成验收的 SPlayer commit。普通 `git fetch splayer` 不会改变这个 accepted baseline，因此 upstream touch audit 的默认语义稳定。

## Initial repository setup

当前 Atom 自有仓库为 `https://github.com/bnqzzdf/splayer-atom.git`。在新的 Atom checkout 或需要修复 topology 时执行：

```bash
node scripts/atom/upstream-sync.mjs configure --origin https://github.com/bnqzzdf/splayer-atom.git
node scripts/atom/upstream-sync.mjs status
```

`configure` 只处理 Git topology：

- 若旧 `origin` 仍是官方 SPlayer，则重命名为 `splayer`；
- 创建 Atom `origin`；
- 禁用 `splayer` push；
- 让现有 `dev` / `main` 只跟踪 `origin`；
- 首次从 accepted baseline 创建纯净 `vendor/splayer`。

之后显式发布 Atom 与 vendor refs：

```bash
git push -u origin dev
git push origin vendor/splayer
```

如果以后 Atom 仓库改名或迁移，只需要更新 `origin` URL；不要修改 `splayer` 的职责，也不要重写已经发布的 Atom 历史。

## Routine upstream integration

先在主 checkout 获取官方上游并只 fast-forward vendor：

```bash
node scripts/atom/upstream-sync.mjs advance
node scripts/atom/upstream-sync.mjs status
git push origin vendor/splayer
```

`advance` 会先 `git fetch splayer dev`，然后验证当前 `vendor/splayer` 是目标官方 commit 的祖先；任何 non-fast-forward 都会被拒绝。

为每次整合创建独立 branch 或 worktree。推荐 worktree：

```bash
git worktree add -b sync/splayer-YYYYMMDD ../splayer-atom-sync-YYYYMMDD dev
cd ../splayer-atom-sync-YYYYMMDD
git merge --no-ff vendor/splayer
```

解决冲突时先检查新上游是否已经提供 Atom 现有 patch 的等价实现；如果已经等价，删除下游重复实现，而不是继续维护两份行为。

合并后的自动门禁至少包括：

```bash
UPSTREAM_REF=vendor/splayer node scripts/atom/check-upstream-touch.mjs
pnpm lint
pnpm typecheck
pnpm test
SKIP_NATIVE_BUILD=true pnpm build
cargo test -p audio-engine
git diff --check
```

若上游改动涉及 player、queue、native、output 或 main lifecycle，还必须追加真实硬件 smoke；Diretta Linux Host 按项目规则以 root 运行。硬件结果不能由 CI 替代。

全部验收通过并合回 Atom `dev` 后，在 `dev` 上记录新的 accepted baseline：

```bash
node scripts/atom/upstream-sync.mjs record-baseline
node scripts/atom/upstream-sync.mjs status
git add scripts/atom/upstream.json
git commit -m "chore: 更新 SPlayer 上游基线"
```

`record-baseline` 只接受当前 `vendor/splayer` commit，并验证它同时属于官方 SPlayer 历史且已经进入 Atom `dev`。

## Candidate report and CI

本地可在不修改工作树的情况下检查当前 upstream candidate：

```bash
node scripts/atom/upstream-sync.mjs report
```

报告会验证 accepted baseline、vendor 与官方 `splayer/dev` 的 ancestry，并用 Git merge-tree 检查当前 Atom `dev` 与候选上游是否存在 merge conflict。

仓库当前不再保留独立的 upstream-sync GitHub Actions workflow。候选检查由维护者在本地或
受控环境中显式执行 `report`；真正开始整合时，再按本文流程创建专用 sync branch/worktree，
并依据 `AGENTS.md` 对实际改动运行相称的 lint、typecheck、tests、build 与 touch audit。

`report` 只报告候选整合状态，不自动修改 `vendor/splayer`、accepted baseline 或 Atom `dev`。

## Upstream contribution branches

通用 SPlayer bugfix 不从 Atom `dev` 直接发上游 PR。贡献分支必须从纯净 vendor 创建：

```bash
git switch -c contrib/fix-xxx vendor/splayer
```

PR 只包含可以独立进入 SPlayer 的最小通用改动，不包含 Diretta、Headless、Qobuz、TIDAL、Atom branding 或其他下游产品能力。上游合并后，下一次 vendor fast-forward 会自然吸收该修复，Atom 再删除已冗余的 downstream patch。
