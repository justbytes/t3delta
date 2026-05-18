# T3 Delta v0.1.0 Release Notes

## What's New

### Language Support

- **Go** — Full editor support with `gopls` language server, workspace root detection via `go.mod`/`go.work`, and code rules for max file lines, unused imports, and unused variables.
- Expanded language support with JS/TS split, Rust, Python, Solidity, C/C++, and C#.
- All code rule groups now collapsed by default for cleaner settings UI.

### Security Hardening

- Updated Electron to `^40.8.0` (fixes 4 HIGH severity vulnerabilities).
- Updated DOMPurify to `^3.2.4` via override (fixes 10 moderate XSS vulnerabilities).
- Updated `yaml` to `^2.8.3` via override (fixes stack overflow vulnerability).
- Added security headers to all HTTP responses:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (disables camera, microphone, geolocation, etc.)
- Session cookies now marked `Secure` (HTTPS-only).

### Bug Fixes

- Fixed hydration error in settings page (button nesting issue).
- File save persistence improvements.

## Install

```bash
npm install -g t3delta
```

Then run:

```bash
t3delta
```

## Compatibility

- `T3CODE_*` environment variables remain supported for backward compatibility.
- Node.js `^22.16 || ^23.11 || >=24.10` required.

## Known Limitations

- 3 moderate dependency vulnerabilities remain (transitive deps via `effect` and `@anthropic-ai/claude-agent-sdk`).
- No rate limiting implemented (acceptable for local tool use).
- Desktop app auto-update config requires `electron-builder` setup (not yet configured).
