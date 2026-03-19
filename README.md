# MeldUI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-lightgrey.svg)](https://github.com/solomonjames/meldui/releases/latest)

**Visual software development workflow manager** — a native macOS desktop app that combines issue tracking, AI-assisted workflows, and structured development processes in one place.

![MeldUI Screenshot](docs/screenshot-placeholder.png)

## Download

### Latest Release

Download the latest `.dmg` from [GitHub Releases](https://github.com/solomonjames/meldui/releases/latest):

- **Apple Silicon (M1/M2/M3/M4):** `MeldUI_x.x.x_aarch64.dmg`
- **Intel:** `MeldUI_x.x.x_x64.dmg`

### Install

1. Download the `.dmg` for your Mac's architecture
2. Open the `.dmg` and drag **MeldUI** to your Applications folder
3. On first launch, macOS Gatekeeper may block the app:
   - Right-click the app → **Open** → click **Open** in the dialog
   - This is only required the first time

### Prerequisites

MeldUI works with these CLI tools (install them separately):

- [**Claude CLI**](https://docs.anthropic.com/en/docs/claude-cli) — AI agent for workflow execution
- [**Beads CLI**](https://github.com/beads-dev/beads) — local-first issue tracking

## Features

- **Kanban board** — drag-and-drop issue management with backlog, in-progress, and done columns
- **AI-powered workflows** — structured multi-step workflows executed by Claude
- **Ticket context panels** — rich ticket detail views with sections for design, notes, and acceptance criteria
- **In-app auto-updater** — automatically detects and installs new versions
- **Native macOS app** — built with Tauri for fast startup and low memory usage

## Development

### Setup

```bash
# Clone the repo
git clone https://github.com/solomonjames/meldui.git
cd meldui

# Install frontend dependencies
bun install

# Install agent sidecar dependencies
bun run agent:install

# Build agent sidecar (required before first run)
bun run agent:build

# Start development mode (frontend + Tauri)
bun run tauri:dev
```

### Build

```bash
# Build the native .app bundle
bun run tauri:build
```

### Commands

| Command | Description |
|---------|-------------|
| `bun run tauri:dev` | Development mode (frontend + Tauri) |
| `bun run dev` | Frontend only (Vite on :5173) |
| `bun run tauri:build` | Build native binary |
| `bun run agent:build` | Build agent sidecar |
| `bun run lint` | ESLint |
| `npx tsc --noEmit` | TypeScript type check |
| `cd src-tauri && cargo check` | Rust type check |
| `cd src-tauri && cargo fmt -- --check` | Rust format check |

### Architecture

MeldUI is a **Tauri v2** app: a React frontend communicates with a Rust backend. An AI agent sidecar (compiled Bun binary wrapping the Claude Agent SDK) handles workflow execution.

```
React Frontend (TypeScript)
    ↕ Tauri invoke() commands
Rust Backend (Tauri v2)
    ↕ stdin/stdout NDJSON
Agent Sidecar (compiled Bun binary)
    └── Claude Agent SDK
```

### First-Time Release Setup

To enable code signing and notarization for releases:

1. **Apple Developer Program** — enroll at [developer.apple.com](https://developer.apple.com) ($99/year)
2. **Export certificate** — from Keychain Access, export your "Developer ID Application" certificate as `.p12`
3. **Generate updater keypair** — `bunx tauri signer generate -w ~/.tauri/meldui.key`
4. **Configure GitHub secrets:**
   | Secret | Description |
   |--------|-------------|
   | `APPLE_CERTIFICATE` | Base64-encoded `.p12` certificate |
   | `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
   | `APPLE_ID` | Your Apple ID email |
   | `APPLE_PASSWORD` | App-specific password from appleid.apple.com |
   | `APPLE_TEAM_ID` | Your Apple Developer Team ID |
   | `KEYCHAIN_PASSWORD` | Any password (used to create a temporary keychain) |
   | `TAURI_SIGNING_PRIVATE_KEY` | Content of `~/.tauri/meldui.key` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password from step 3 |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Open a pull request against `main`

CI will automatically run lint, type-check, and format checks on your PR.

## License

[MIT](LICENSE)
