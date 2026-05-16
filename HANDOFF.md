# HANDOFF

## Objective
- Continue shuvscode Canvas/Projects polish. The current batch adds first-class
  terminal multiplexer support on top of the persistent-project-terminal patch:
  zellij/tmux/nvim/btop/lazygit reattach cleanly across same-window project
  switches and reloads instead of showing a stale, garbled snapshot.

## Current status
- Branch: `shuvscode-main`, tracking `origin/shuvscode-main`.
- HEAD is `8cce7a7 docs: align shuvscode readme with branded build` (not yet
  committed: README, Projects ext, new patch 29).
- Rebuilt app exists and `./shuvscode-linux-x64/bin/shuvscode --version` returns
  `1.120.03266`, commit `34e76507982c04f91ce310e64693422e1e36fd7e`, `x64`.
- `patches/user/29-multiplexer-friendly-reattach.patch` is included and applies
  cleanly during tree preparation/build. Built bundles contain the changes:
  - `vscode/out-vscode/vs/platform/terminal/node/ptyHostMain.js` and the
    minified bundle expose `altBufferActive` from `XtermSerializer` and the
    post-replay SIGWINCH bump in `PersistentTerminalProcess.triggerReplay`.
  - `vscode/out-vscode/vs/workbench/contrib/terminal/common/basePty.js` /
    `workbench.desktop.main.js` contain the alt-buffer early-return in
    `BasePty.handleReplay` (writes `\x1b[?1049h\x1b[2J\x1b[H` instead of the
    stale cell snapshot).
- `src/stable/extensions/shuvscode-projects/extension.js` adds:
  - `shuvscodeProjects.openMultiplexerTerminal` command (palette + inline
    tree-item action),
  - `openMultiplexerTerminal()` helper with token substitution
    (`${projectName} ${projectPath} ${projectSlug} ${cwd}`),
  - `maybeAutoOpenMultiplexerTerminal()` for opt-in auto-launch on project
    open via `shuvscode.projects.autoOpenMultiplexer`.
- `src/stable/extensions/shuvscode-projects/package.json` declares:
  - new command `shuvscodeProjects.openMultiplexerTerminal` with
    `terminal-tmux` icon and activation event,
  - inline `view/item/context` action on project items,
  - settings: `multiplexerCommand`, `multiplexerTerminalName`,
    `autoOpenMultiplexer`.
- User runtime settings already configured:
  - `~/.config/shuvscode/User/settings.json` sets
    `shuvscode.projects.multiplexerCommand` to
    `zellij attach -c ${projectName}` and `multiplexerTerminalName` to
    `zellij: ${projectName}`. `autoOpenMultiplexer` is `false`.

## How the fix works
Patches 28 + 29 work together:

- Patch 28 (persistent project terminals) keeps the pty alive across same-window
  workspace loads and reloads.
- Patch 29 (multiplexer-friendly reattach):
  1. Pty host serializer reports whether the live xterm buffer is on the
     alternate screen (`xterm.buffer.active.type === 'alternate'`) by adding
     `altBufferActive` to the replay event.
  2. Renderer `BasePty.handleReplay` skips the cell snapshot when
     `altBufferActive` is true. Instead it puts xterm into alt-screen mode and
     clears it, ready for the multiplexer's own redraw.
  3. Pty host, after firing the replay event, does a one-row resize bump on
     the real pty so node-pty issues a real `TIOCSWINSZ` → `SIGWINCH` to the
     foreground process group. The multiplexer redraws from authoritative
     state instead of being overpainted by stale cells.

Normal-buffer terminals (shell at a prompt) take the original code path
unchanged.

## Key context
- Branding is lowercase `shuvscode`; do not use `shuvcode`.
- Long-running GUI launches should be monitorable/stoppable; for isolated smoke
  use `--user-data-dir /tmp/shuvscode-smoke-user-data
  --extensions-dir /tmp/shuvscode-smoke-extensions`.
- `disable-update.patch.yet` must exist before running `build-shuvscode.sh` or
  `prepare-shuvscode-tree.sh`. If a build aborted between the `mv .yet → .patch`
  step and the cleanup `mv .patch → .yet`, restore manually with
  `mv patches/disable-update.patch patches/disable-update.patch.yet` (or the
  reverse if the prior cleanup half-completed).

## Important files
- `patches/user/28-persistent-project-terminals.patch` — pty grace time +
  detach on RELOAD/LOAD.
- `patches/user/29-multiplexer-friendly-reattach.patch` — alt-buffer aware
  replay + SIGWINCH bump.
- `src/stable/extensions/shuvscode-projects/extension.js` — Projects provider,
  Open Windows registry, multiplexer helpers, commands.
- `src/stable/extensions/shuvscode-projects/package.json` — commands, menus,
  activation/capabilities, Projects + multiplexer settings.
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` — Canvas
  chrome styling and clipping fix.
- `README.md` — has a new "Multiplexer terminals" section describing the
  setting surface.

## Validation completed
- `node --check src/stable/extensions/shuvscode-projects/extension.js` passed.
- `jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null` passed.
- `git apply --ignore-whitespace --check
  patches/user/29-multiplexer-friendly-reattach.patch` against the prepared
  tree (post-patch-28 baseline) passed.
- `./scripts/prepare-shuvscode-tree.sh && ./scripts/build-shuvscode.sh`
  succeeded; build output present at `shuvscode-linux-x64/`.
- `./shuvscode-linux-x64/bin/shuvscode --version` returns `1.120.03266` /
  `34e76507982c04f91ce310e64693422e1e36fd7e`.
- Bundled outputs contain `altBufferActive`, the alt-screen prep sequence
  (`\x1b[?1049h`), and `buffer.active.type==="alternate"` checks.

## Validation not completed (manual UI smoke)
The fix targets renderer corruption that only manifests in the GUI. Run the
following manual smoke to confirm:

1. Launch with an isolated profile and open project A:
   ```bash
   ./shuvscode-linux-x64/bin/shuvscode \
     --user-data-dir /tmp/shuvscode-mux-smoke-user-data \
     --extensions-dir /tmp/shuvscode-mux-smoke-extensions \
     ~/repos/shuvscode
   ```
2. Open an integrated terminal and run `zellij attach -c smoke-A` (or use the
   new `Projects: Open Multiplexer Terminal` command, which will use the
   configured `zellij attach -c ${projectName}`). Create a couple of panes,
   start something visible like `htop` or `watch -n1 date`.
3. From the Projects view, switch to a different project (e.g. `~/repos`).
   This triggers the same-window `vscode.openFolder` path.
4. Switch back to the first project. The terminal should reattach with the
   multiplexer UI cleanly redrawn — no stale cells, no garbled status bar.
5. Repeat steps 1–4 substituting:
   - `tmux new -A -s smoke-B` for zellij.
   - `nvim ~/repos/shuvscode/HANDOFF.md` for a plain TUI editor.
   - `btop` and `lazygit ~/repos/shuvscode` for the harder cases.

Also verify normal (non-alt-buffer) terminals are unaffected:

6. Open a terminal at a shell prompt, run some output, switch projects and
   back. The persistent-terminal patch should still replay scrollback as
   before.

## Next steps
1. Run the manual UI smoke above for zellij/tmux/nvim/btop/lazygit and a
   regular shell terminal. If anything regresses, the most likely fault lines:
   - Renderer alt-screen prep race: bump the `setTimeout` in
     `PersistentTerminalProcess.triggerReplay` from 50ms higher, or send the
     prep + winch in a different order.
   - Multiplexers that don't redraw on SIGWINCH alone (rare): consider also
     forwarding a `printf '\x0c'` (form feed) or `tmux refresh-client`-style
     hook via a per-multiplexer setting.
2. Commit the cohesive batch:
   ```
   git add patches/user/29-multiplexer-friendly-reattach.patch \
           src/stable/extensions/shuvscode-projects \
           README.md HANDOFF.md
   git commit -m "feat: first-class multiplexer terminal support"
   ```
3. Optional: try `shuvscode.projects.autoOpenMultiplexer = true` and decide
   whether that should be the new default.

## Risks / open questions
- The 50ms `setTimeout` between the `+1 rows` resize and the restore resize is
  best-effort. On a heavily loaded system the inner process might not have
  drained the first SIGWINCH before the second arrives. Most multiplexers
  coalesce SIGWINCH cleanly; worst case the user sees one extra refresh.
- `BasePty.handleReplay` writes `\x1b[?1049h\x1b[2J\x1b[H` even on platforms
  where the live terminal was *also* on the alt screen (e.g. nested
  multiplexers). The DECSET 1049 is idempotent so this should be fine, but
  unusual nested setups are an unknown.
- Reload (Cmd-R) takes a different path (Electron full reload) than same-window
  workspace LOAD. Both go through `handleReplay`, so the fix applies; the
  smoke at step 6 also covers reload-vs-replay if you Ctrl+Shift+P → Reload
  Window while a TUI is running.
