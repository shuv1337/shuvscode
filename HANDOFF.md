# HANDOFF

## Objective
- Continue shuvscode Canvas/Projects polish from the live checkout, with the current batch centered on native Projects open-window tracking, Canvas clipping cleanup, and persistent project terminals.

## Current status
- Branch: `shuvscode-main`, tracking `origin/shuvscode-main`.
- HEAD is `8cce7a7 docs: align shuvscode readme with branded build`.
- Working tree contains one cohesive follow-up batch ready for review/commit.
- Rebuilt app exists and `./shuvscode-linux-x64/bin/shuvscode --version` returns `1.120.03260`, commit `ee7963909be0c4489e04bc0a131e5029be548d27`, `x64`.
- `src/stable/extensions/shuvscode-projects/extension.js` now adds an Open Windows group backed by shared `windows.json` global storage, heartbeat/stale pruning, and `shuvscodeProjects.switchToWindow`.
- `src/stable/extensions/shuvscode-projects/package.json` now eagerly activates the Projects extension, declares untrusted workspace support, registers all missing command activation events, adds `Switch to Open Window`, and exposes `shuvscode.projects.showOpenWindows`.
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` removes inner padding from sidebar/panel/auxiliary content to avoid clipped child composites.
- `patches/user/28-persistent-project-terminals.patch` is included and applies cleanly during tree preparation/build.
- `.gitignore` now ignores timestamped previous build backups with `shuvscode-linux-x64.prev-*/`.

## Key context
- Branding is lowercase `shuvscode`; do not use `shuvcode`.
- Native Projects intentionally reimplements Project Manager-style behavior without copying GPL-3.0 implementation.
- Long-running GUI launches should be monitorable/stoppable and use isolated smoke profiles, e.g. `--user-data-dir /tmp/shuvscode-smoke-user-data --extensions-dir /tmp/shuvscode-smoke-extensions`.

## Important files
- `src/stable/extensions/shuvscode-projects/extension.js` — Projects provider, Open Windows registry, status bar, commands.
- `src/stable/extensions/shuvscode-projects/package.json` — commands, menus, activation/capabilities, Projects settings.
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` — Canvas chrome styling and clipping fix.
- `patches/user/28-persistent-project-terminals.patch` — terminal lifecycle patch for reload and same-window workspace loads.
- `PLAN-canvas-ui.md` — current Canvas roadmap and validation checklist.

## Validation completed
- `node --check src/stable/extensions/shuvscode-projects/extension.js` passed.
- `jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null` passed.
- `git diff --check` passed.
- `./scripts/prepare-shuvscode-tree.sh && ./scripts/build-shuvscode.sh` passed.
- `./shuvscode-linux-x64/bin/shuvscode --version` passed with `1.120.03260` / `ee7963909be0c4489e04bc0a131e5029be548d27`.
- Built package contains the edited Projects activation/capabilities metadata.
- The persistent-terminal patch is present in the prepared VS Code tree:
  - `vscode/src/vs/code/electron-main/app.ts` uses a 12-hour pty host grace time.
  - `vscode/src/vs/workbench/contrib/terminal/browser/terminalEditorInput.ts` persists for `RELOAD` and `LOAD`.
  - `vscode/src/vs/workbench/contrib/terminal/browser/terminalService.ts` uses `_shouldDetachProcesses` for `RELOAD` and `LOAD`.
- Open Windows smoke passed with two isolated shuvscode windows using `/tmp/shuvscode-openwindows-user-data` and `/tmp/shuvscode-openwindows-extensions`.
  - Both folders registered in shared `windows.json`.
  - Hyprland showed both shuvscode windows.
  - Extension host logs showed eager activation via `activationEvent: '*'` and registration of `shuvscodeProjects.switchToWindow`.
  - After closing smoke windows, `windows.json` returned to `[]` and no smoke shuvscode process remained.

## Validation not completed
- No direct UI click smoke was performed for `shuvscodeProjects.switchToWindow`.
- No interactive terminal persistence smoke was performed across same-window folder switches.

## Next steps
1. Optionally perform manual UI smoke for `Switch to Open Window` from the Projects tree. Source review indicates `vscode.openFolder(uri, false)` maps to VS Code's existing-window reuse/focus path when another window already owns the folder.
2. Optionally perform manual terminal persistence smoke: open a local terminal running a long-lived process, switch folders in the same window, and confirm the process reattaches or continues as intended.
3. Commit this cohesive batch, then push if this is the intended release branch state.

## Risks / open questions
- `WindowRegistry` writes shared JSON from multiple windows without locking; it uses atomic rename and periodic heartbeat, but simultaneous window start/close could still lose one update until the next heartbeat repairs it.
- Persistent terminal behavior changes shutdown semantics for same-window workspace loads; keep an eye on terminal state restoration edge cases after manual smoke.
