# HANDOFF

## Objective
- Continue shuvscode Canvas/Projects polish and native-feeling bundled extension work.
- Latest completed batch:
  - dense split layout support for bottom/side workbench regions
  - trusted built-in extension publishers
  - bundled GitHub Pull Requests and Issues extension from Open VSX

## Current status
- Branch: `shuvscode-main`, tracking `origin/shuvscode-main`.
- Built app exists at `shuvscode-linux-x64/`.
- `./shuvscode-linux-x64/bin/shuvscode --version` returns:
  - version `1.120.03285`
  - commit `2ba41497e560e751cf70af3295b8fcbdf350af6a`
  - arch `x64`
- New uncommitted files:
  - `assets/extensions/GitHub.vscode-pull-request-github-0.144.0.vsix`
  - `patches/user/30-bottom-pane-secondary-sidebar-split.patch`
  - `patches/user/31-sidebar-secondary-sidebar-split.patch`
- Modified metadata/docs:
  - `.gitignore`
  - `AGENTS.md`
  - `shuvscode.product.json`
  - `README.md`
  - `HANDOFF.md`

## Built-in extension trust and GitHub PRs
- `shuvscode.product.json` now defines `trustedExtensionPublishers`:
  - `detachhead`
  - `editorconfig`
  - `github`
  - `shuvscode`
- This uses VS Code's product-level extension trust mechanism so bundled extensions from these publishers feel native and do not trigger trust warnings as third-party installs.
- GitHub Pull Requests and Issues is bundled as a local VSIX-backed built-in extension:
  - extension id: `GitHub.vscode-pull-request-github`
  - version: `0.144.0`
  - local VSIX: `assets/extensions/GitHub.vscode-pull-request-github-0.144.0.vsix`
  - SHA256: `c9358907d2d3a3a70989e264b362a66b8b4f31f718115902dec2a513ec64c372`
- Important implementation detail: the `vsix` path in `shuvscode.product.json` is `../assets/extensions/...` because VS Code's `build/lib/builtInExtensions.ts` resolves it relative to the vendored `vscode/` tree root during build.
- `extensionEnabledApiProposals["GitHub.vscode-pull-request-github"]` mirrors the extension manifest proposals so it can start without launching shuvscode with `--enable-proposed-api GitHub.vscode-pull-request-github`.

## Dense split layout settings

### Bottom pane + secondary side bar split
- Setting: `workbench.bottomPane.experimental.splitWithSecondarySideBar` (default `false`).
- Patch: `patches/user/30-bottom-pane-secondary-sidebar-split.patch`.
- When enabled and the panel is at the bottom/top, the secondary side bar shares the panel row instead of sitting beside the editor.
- Intended use: keep Terminal in the panel and Source Control (or another view container) in the secondary side bar for a persistent horizontal split.

### Primary side bar + secondary side bar vertical split
- Setting: `workbench.sideBar.experimental.splitWithSecondarySideBar` (default `false`).
- Patch: `patches/user/31-sidebar-secondary-sidebar-split.patch`.
- When enabled, the secondary side bar is stacked vertically with the primary side bar in one side column.
- Intended use: keep Explorer and Projects visible at the same time.
- If both split settings are enabled, the side-bar split wins because the secondary side bar can only occupy one target.

## Important files
- `shuvscode.product.json` — built-in extensions, extension trust publishers, proposed API allowlist.
- `assets/extensions/GitHub.vscode-pull-request-github-0.144.0.vsix` — pinned local VSIX for GitHub PRs.
- `patches/user/30-bottom-pane-secondary-sidebar-split.patch` — bottom/top panel row can include the secondary side bar.
- `patches/user/31-sidebar-secondary-sidebar-split.patch` — primary + secondary side bars can stack vertically.
- `patches/user/28-persistent-project-terminals.patch` — pty grace time + detach on RELOAD/LOAD.
- `patches/user/29-multiplexer-friendly-reattach.patch` — alt-buffer aware replay + SIGWINCH bump.
- `src/stable/extensions/shuvscode-projects/extension.js` — Projects provider, Open Windows registry, multiplexer helpers, commands.
- `src/stable/extensions/shuvscode-projects/package.json` — Projects commands/settings/contributions.
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` — Canvas chrome styling.
- `README.md` — documents multiplexer, dense split layouts, and bundled native-feeling extensions.

## Validation completed
- `jq . shuvscode.product.json` passed.
- VSIX checksum verified with `sha256sum assets/extensions/GitHub.vscode-pull-request-github-0.144.0.vsix`.
- `./scripts/build-shuvscode.sh` succeeded after correcting the local VSIX path to be relative to the vendored `vscode/` root.
- `./shuvscode-linux-x64/bin/shuvscode --version` returns `1.120.03285` / `2ba41497e560e751cf70af3295b8fcbdf350af6a` / `x64`.
- Built product validation with `jq shuvscode-linux-x64/resources/app/product.json` confirmed:
  - trusted publishers include `detachhead`, `editorconfig`, `github`, `shuvscode`
  - GitHub PRs is listed in `builtInExtensions`
  - GitHub PRs has the expected proposed API allowlist
- Built bundle contains:
  - `shuvscode-linux-x64/resources/app/extensions/GitHub.vscode-pull-request-github`
  - `shuvscode-linux-x64/resources/app/extensions/github-authentication`
  - `shuvscode-linux-x64/resources/app/extensions/github`

## Manual UI smoke still needed
1. Launch the rebuilt app normally or with an isolated profile.
2. Verify GitHub Pull Requests appears as a built-in/native-feeling extension and does not show trust/proposed-API warnings.
3. Sign in to GitHub and verify PR/issue views activate normally.
4. Put Projects in the secondary side bar if it is not already there.
5. With `workbench.sideBar.experimental.splitWithSecondarySideBar: true`, verify Explorer and Projects stack vertically in the same side column.
6. Disable that setting and enable `workbench.bottomPane.experimental.splitWithSecondarySideBar`; verify Terminal + secondary side bar can share the bottom panel row.
7. Resize the splits and reload the window; check for layout persistence/regression.

## Risks / open questions
- The current side-bar split reuses the existing primary and secondary side bar parts. It does not create four independent side-bar slots; the secondary side bar can only be stacked with the primary side bar or split with the panel, not both simultaneously.
- Initial vertical split sizes default to 50/50 when both side bars are visible. More granular per-split sizing persistence could be added later if needed.
- GitHub Pull Requests uses many proposed APIs; the product allowlist matches version `0.144.0`. Re-check the extension manifest before bumping the VSIX.
- CLI `--list-extensions` did not list the bundled extension in an isolated profile; direct product/package inspection confirmed it is present in `resources/app/extensions`. Use GUI extension view for final native-feel validation.
