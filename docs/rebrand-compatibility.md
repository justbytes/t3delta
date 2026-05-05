# Rebrand and Compatibility Notes

This repo is publicly branded as T3 Delta.

Intentional release-surface decisions:

- Product name: T3 Delta
- CLI binary: `delta`
- Default home directory: `~/.delta`
- GitHub repo: `https://github.com/justbytes/t3delta`
- OTLP/default server service name: `delta-server`

Compatibility choices that intentionally remain legacy-shaped:

- Environment variables stay under the `T3CODE_*` prefix for now to avoid breaking existing installs, automation, and local state.
- Some internal schema names, config keys, and migration-era identifiers may still use the upstream prefix where changing them would create avoidable compatibility risk.

How to reason about naming changes:

1. User-facing strings should say T3 Delta.
2. New release metadata should prefer Delta naming.
3. Existing `T3CODE_*` environment variables remain supported and documented as compatibility inputs, not current branding.
4. Runtime paths should default to `~/.delta` unless a caller explicitly overrides `T3CODE_HOME`.

Before a public release, audit any new surface with this rule:

- If a user sees it, ship Delta branding.
- If automation depends on it, preserve compatibility unless there is a migration plan.
