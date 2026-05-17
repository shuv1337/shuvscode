# shuvscode

<p align="center">
  <img src="icons/stable/codium_cnl.svg" alt="shuvscode mark" width="160">
</p>

`shuvscode` is a branded Linux x64 build of VSCodium/VS Code for the local Shuv development workflow. It keeps the freely licensed VSCodium base, applies shuvscode product metadata and patches, and ships a built-in Projects workflow tuned for fast repo switching.

## What This Repo Contains

- `shuvscode.env` - build-time brand and binary names
- `shuvscode.product.json` - product metadata overlay merged into upstream `product.json`
- `scripts/prepare-shuvscode-tree.sh` - prepares the vendored VS Code source tree
- `scripts/build-shuvscode.sh` - builds the patched, branded application
- `patches/user/` - shuvscode-specific patches applied during source preparation
- `src/stable/extensions/shuvscode-projects/` - built-in Projects extension
- `shuvscode-linux-x64/` - local Linux x64 build output

## Current Build

Run the checked-in local build directly from the repository root:

```bash
./shuvscode-linux-x64/bin/shuvscode --version
```

Expected shape:

```text
1.120.x
<commit sha>
x64
```

For smoke tests, use an isolated profile so the normal editor profile is not mutated:

```bash
./shuvscode-linux-x64/bin/shuvscode \
  --user-data-dir /tmp/shuvscode-smoke-user-data \
  --extensions-dir /tmp/shuvscode-smoke-extensions \
  --new-window
```

## Build From Source

Prerequisites:

- `git-lfs`
- Node version from `.nvmrc` through `mise` or `nvm`
- `uv` with Python 3.11 available
- `jq`
- the upstream build dependencies required by VS Code/VSCodium for your platform

Build sequence:

```bash
git lfs install
./scripts/prepare-shuvscode-tree.sh
./scripts/build-shuvscode.sh
./shuvscode-linux-x64/bin/shuvscode --version
```

The build scripts source `shuvscode.env` and optional `shuvscode.env.local`, merge `shuvscode.product.json` into the upstream product metadata, run the upstream preparation/build flow, and rename the Linux output to `shuvscode-linux-x64/`.

## Branding

The product name, executable, and docs use lowercase `shuvscode`. Do not shorten it to `shuvcode`; that name belongs to a separate opencode fork.

Branding assets live under `icons/` and are generated from the repo's VSCodium-compatible icon pipeline. The README mark above uses `icons/stable/codium_cnl.svg`, which is committed in this repository and renders on GitHub.

## Projects Workflow

The built-in Projects extension provides:

- a primary activity-bar Projects view
- save/open/remove project commands
- Git repository discovery from configured base folders
- a status bar current-project indicator
- workspace storage in `projects.json`
- shared `windows.json` registry of open shuvscode windows with Switch-to-Window
- first-class multiplexer terminal support (zellij, tmux, etc.)
- managed Zellij project tabs for fast switching without a full workbench reload

Relevant files:

- `src/stable/extensions/shuvscode-projects/extension.js`
- `src/stable/extensions/shuvscode-projects/package.json`
- `src/stable/extensions/shuvscode-projects/zellij.js`

### Multiplexer terminals

Projects can launch (or reattach to) a per-project terminal multiplexer
session. Configure once:

- `shuvscode.projects.multiplexerCommand` — e.g. `zellij attach -c ${projectName}` or `tmux new -A -s ${projectSlug}`
- `shuvscode.projects.multiplexerTerminalName` — display name template (default `mux: ${projectName}`)
- `shuvscode.projects.autoOpenMultiplexer` — auto-run on project open (default `false`)

Tokens: `${projectName}` `${projectPath}` `${projectSlug}` `${cwd}`.

Commands:

- `Projects: Open Multiplexer Terminal` from the command palette or the inline
  action on a project tree item.

Under the hood, patches 28 + 29 keep the pty alive across same-window project
switches and reload, and on reattach detect alternate-screen TUIs (zellij,
tmux, neovim, btop, lazygit, …). For those the renderer skips the stale cell
snapshot and the pty host delivers a real SIGWINCH so the inner process
redraws from authoritative state instead of being overpainted.

### Managed Zellij fast switching

For deeper Zellij integration, enable managed Zellij mode:

- `shuvscode.projects.zellij.enabled` — enables first-class Zellij project switching.
- `shuvscode.projects.zellij.executablePath` — defaults to `zellij`; use `/usr/bin/zellij` if desktop-launched shuvscode has a reduced PATH.
- `shuvscode.projects.zellij.sessionName` — defaults to `shuvscode-managed`.
- `shuvscode.projects.zellij.autoStart` — creates/reuses the managed session on Projects activation.
- `shuvscode.projects.zellij.openSharedTerminalOnStart` — optionally opens the shared `zellij: shuvscode-managed` terminal on activation.
- `shuvscode.projects.defaultProjectAction` — keep `open-workspace` for normal VS Code folder loads, or choose `fast-switch` after validating the workflow.

Commands:

- `Projects: Fast Switch Project` creates or focuses a per-project Zellij tab and records it as the active project without calling `vscode.openFolder`.
- `Projects: Open Managed Zellij Session` opens the shared integrated terminal attached to the managed session.
- `Projects: Open Active Project as Workspace` converts the active Zellij project into a real VS Code workspace load when language services, Explorer, SCM, or extension context need to follow the project.

The managed session is intentionally named `shuvscode-managed` to avoid colliding
with user-created sessions. shuvscode records ownership metadata and will not
kill, reset, or take over an unowned session without confirmation. A default
Zellij `Tab #1` is reserved as the hub tab; project tabs are named from
`${projectSlug}` by default.

## Built-in extensions

`shuvscode.product.json` bakes in a small set of native-feeling extensions:
BasedPyright, EditorConfig, and GitHub Pull Requests. Their publishers are listed
in `trustedExtensionPublishers` so install/trust prompts do not make these
bundled extensions feel third-party, and GitHub Pull Requests is explicitly
granted its proposed APIs so it starts without `--enable-proposed-api`.

## Validation

Useful checks after touching docs or build metadata:

```bash
./shuvscode-linux-x64/bin/shuvscode --version
node --check src/stable/extensions/shuvscode-projects/extension.js
node --check src/stable/extensions/shuvscode-projects/zellij.js
node --test src/stable/extensions/shuvscode-projects/zellij.test.js
jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null
```

After code, patch, or product metadata changes, rebuild and smoke with:

```bash
./scripts/prepare-shuvscode-tree.sh
./scripts/build-shuvscode.sh
./shuvscode-linux-x64/bin/shuvscode \
  --user-data-dir /tmp/shuvscode-smoke-user-data \
  --extensions-dir /tmp/shuvscode-smoke-extensions \
  --new-window
```

## Upstream

shuvscode inherits from the VSCodium build system and the upstream Microsoft VS Code source tree. See the VSCodium docs for platform-specific dependency details:

- [VSCodium build documentation](https://github.com/VSCodium/vscodium/blob/master/docs/howto-build.md)
- [VS Code contributing build guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
