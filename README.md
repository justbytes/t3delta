# T3 Delta

T3 Delta is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> T3 Delta currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3delta
```

### Install the CLI

```bash
npm install -g t3delta
delta
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/justbytes/t3delta/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install Bytes.T3Delta
```

#### macOS (Homebrew)

```bash
brew install --cask t3-delta
```

#### Arch Linux (AUR)

```bash
yay -S t3delta-bin
```

## Fork attribution

T3 Delta is an independent hard fork of [T3 Code](https://github.com/pingdotgg/t3code). The project has been renamed, restructured, and will diverge with a separate product direction. Original upstream code remains under its original MIT license; new T3 Delta changes are maintained by Bytes.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
