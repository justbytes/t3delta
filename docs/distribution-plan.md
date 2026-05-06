# T3 Delta Distribution Plan

## Goal

Make T3 Delta installable by end users through two primary channels:

1. **Desktop app** — Downloadable via GitHub Releases (macOS/Windows/Linux)
2. **CLI tool** — Installable via `npm install -g delta` or `npx delta`

## Current State

### Desktop app (`apps/desktop`)

- **Build system**: `tsdown` bundles `main.ts` + `preload.ts` into `dist-electron/`
- **Server bundling**: Dev script references `../server/dist/bin.mjs` — the desktop app spawns the server as a child process
- **Auto-updater**: `electron-updater` already wired, reads `app-update.yml` from `resources/`
- **Icons**: macOS `.icns`, Windows `.ico`, Linux `.png` all present in `resources/`
- **Missing**: No `electron-builder` config, no `app-update.yml`, no release scripts

### CLI tool (`apps/server`)

- **Package name**: `delta` (npm package)
- **Binary**: `./dist/bin.mjs` (mapped to `delta` command)
- **Build script**: `bun scripts/cli.ts build` — runs `tsdown` + copies `apps/web/dist` into `dist/client`
- **Publish script**: `bun scripts/cli.ts publish` — backs up package.json, resolves catalog deps, runs `npm publish`
- **Missing**: Not yet published to npm registry

## Distribution Checklist

### Phase 1: CLI npm publish (fastest path to usable)

- [ ] Bump version to `0.1.0` (first public release)
- [ ] Run `bun run build` in `apps/server` to produce `dist/bin.mjs` + `dist/client/`
- [ ] Verify `delta --version` and `delta --help` work from the built artifact
- [ ] Run `bun scripts/cli.ts publish --dry-run` to validate the package
- [ ] Create npm account / login if needed
- [ ] Run `bun scripts/cli.ts publish --tag latest --access public`
- [ ] Test `npm install -g delta` and `npx delta` on a clean machine

### Phase 2: Desktop app GitHub Releases

- [ ] Add `electron-builder` config (YAML or JSON) with targets:
  - macOS: `dmg`, `zip` (universal or separate x64/arm64)
  - Windows: `nsis` (installer), `portable`
  - Linux: `AppImage`, `deb`, `rpm`
- [ ] Create `app-update.yml` template for auto-updater
- [ ] Add `build:desktop` script to `apps/desktop/package.json`
- [ ] Add GitHub Actions workflow for:
  - Build desktop app on macOS/Windows/Linux runners
  - Build server bundle
  - Attach artifacts to GitHub Release
  - Generate `latest.yml` / `latest-mac.yml` for electron-updater
- [ ] Test auto-update flow end-to-end (publish test release, verify update detection)

### Phase 3: Documentation & Landing

- [ ] Update README with install instructions (`npm install -g delta` + download links)
- [ ] Add `docs/installation.md` with per-platform guides
- [ ] Ensure marketing site (`apps/marketing`) has download buttons
- [ ] Add `CHANGELOG.md` starting from `0.1.0`

## Open Questions

1. **npm scope**: The server package is named `delta` (unscoped). Is this the final name, or should it be `@t3delta/cli`?
2. **Desktop versioning**: Should desktop and CLI share the same version number, or version independently?
3. **Codesigning**: macOS notarization + Windows code signing — do you have Apple Developer ID / Windows cert?
4. **Linux packaging**: AppImage is easiest; deb/rpm require more CI setup. Preference?
5. **Release cadence**: Manual releases via GitHub Actions trigger, or automated on version tag push?

## Recommended Next Step

Publish the CLI to npm first (Phase 1). It's the fastest path to making T3 Delta usable by others, and the build/publish infrastructure is mostly already in place. Then tackle desktop releases (Phase 2) once the CLI is live and tested.
