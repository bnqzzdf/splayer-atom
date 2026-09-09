# Contributing

Contributions to SPlayer Atom are welcome.

## Environment

- Linux x86-64
- Node `>=24.18.0 <25`
- pnpm `>=10`
- Rust stable

```bash
git clone https://github.com/bnqzzdf/splayer-atom.git
cd splayer-atom
pnpm install
pnpm dev
```

## Architecture rules

Read the root `AGENTS.md` and the [Atom Roadmap](/atom-roadmap) before changing architecture.

- Node Core is the sole music-domain authority.
- Web Control is the only UI.
- Do not add Electron/Desktop/Host capabilities.
- Do not create a second queue, player, provider, settings, or persistence model.
- Diretta must remain strict Source Direct without silent DSP or fallback.

## Common gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm docs:build
cargo check --workspace
cargo test --workspace
```

Commit titles use Conventional Commits with a one-line Chinese summary, following repository policy.
