# PLAN-open-issues-end-to-end.md

## Scope

Plan to implement all currently open shuvscode GitHub issues end to end:

| Issue | Title | URL |
| --- | --- | --- |
| #3 | Balance canvas UI with more amber accent states | https://github.com/shuv1337/shuvscode/issues/3 |
| #4 | Explore first-class gh-dash integration for GitHub PRs and issues | https://github.com/shuv1337/shuvscode/issues/4 |
| #5 | Add locked-by-default opinionated workbench layout | https://github.com/shuv1337/shuvscode/issues/5 |

Live repo state at planning time:

- Branch: `shuvscode-main`, clean and aligned with `origin/shuvscode-main`.
- Latest local commits include `a945603 feat(shuvscode-gh): colocate Pull Requests / Issues / Notifications with Source Control`, `baee80b packaging(aur): bump shuvscode-bin to 1.120.03315.shuv1`, and `0da3427 docs: HANDOFF reflects colocation shipped as v1.120.03315.shuv1`.
- Current architectural pattern: tracked overlays live under `src/stable/...`; generated `vscode/...` and `shuvscode-linux-x64/...` should be refreshed through `./scripts/prepare-shuvscode-tree.sh` and `./scripts/build-shuvscode.sh`.
- Plan file state: this document is intentionally untracked until the user chooses to commit it; do not treat its presence as implementation drift.

## Implementation Strategy

Deliver this as three coherent PR/commit batches. Order is **#5 → #3 → #4** so amber tuning lands against the final cockpit chrome rather than against today's pre-layout sidebar, and so gh-dash UX is built on top of the locked GitHub view colocation rather than racing it:

1. **Opinionated cockpit layout (#5)**: largest batch; add a versioned layout orchestrator in `shuvscode-bootstrap` (not a new extension), Projects-in-Explorer default placement, editor/terminal grid, reset/unlock commands, and browser evidence. SCM-on-right is already deterministic via `patches/user/26-canvas-scm-secondary-sidebar.patch` and is **not** re-implemented here — the orchestrator only opens the view, never moves the container.
2. **Amber selection language (#3)**: low-risk visual/theming pass against the post-#5 cockpit so selection contrast is tuned with the real Explorer/Projects/SCM density.
3. **Terminal-first GitHub workflow (#4)**: extends the existing `shuvscode-gh` extension with `gh-dash` detection, launch, install guidance, and docs while preserving the bundled GitHub Pull Requests extension.

Do not close any issue until its own acceptance criteria are validated in the built app. #5 must land first because Phase 2 view-placement changes invalidate any prior amber tuning baseline.

### Versioning and release target

Cut these as a single release `v1.120.03316.shuv1` once all three batches are source-complete, smoke-tested, and the AUR PKGBUILD + `.SRCINFO` are updated. Tag and AUR push happen only after the three issues' acceptance criteria are proven in the built app.

## Issue #3: Amber Accent Balance

### Relevant Files

- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css`
- `src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme.json`
- `src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme-noitalic.json`
- `src/stable/extensions/shuvscode-defaults/package.json`
- `PLAN-canvas-ui.md`

### Tasks

- [ ] Tune Night Owl theme keys in both theme variants:
  - [ ] `panelTitle.activeBorder` should use `#F3B042` or a close amber token.
  - [ ] `list.activeSelectionBackground` should shift from navy-blue to subtle amber.
  - [ ] `list.inactiveSelectionBackground` should remain visible but softer than active selection.
  - [ ] `list.focusBackground` and focus/outline keys should support keyboard focus without making hover and selected states identical.
- [ ] Strengthen Canvas CSS list/tree selected states:
  - [ ] Replace the current `rgba(243, 176, 66, 0.08)` selected/focused wash with a stronger but still restrained amber background.
  - [ ] Add an inset left rail or border for selected rows so Explorer, Projects, SCM, and quick lists read consistently.
  - [ ] Keep hover softer than selected/focused.
  - [ ] Verify Git status foregrounds/icons remain legible.
- [ ] Add Projects-specific polish only if generic list styling is insufficient:
  - [ ] Current project rows.
  - [ ] Favorite/open-window rows.
  - [ ] Section headers like `Git Repositories (...)`.
- [ ] Keep all source changes in tracked overlay/theme files; do not hand-edit generated output.
- [ ] Capture a baseline screenshot of the post-#5 cockpit *before* tuning amber, store under `docs/recaps/` for diff.

### Validation

```bash
jq . src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme.json >/dev/null
jq . src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme-noitalic.json >/dev/null
./scripts/prepare-shuvscode-tree.sh
setsid nohup ./scripts/build-shuvscode.sh > /tmp/shuvscode-build-amber.log 2>&1 < /dev/null & disown
```

After the build finishes:

```bash
./shuvscode-linux-x64/bin/shuvscode --version
rm -rf /tmp/shuvscode-amber-smoke
mkdir -p /tmp/shuvscode-amber-smoke/workspace
setsid nohup ./shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox --disable-gpu --new-window \
  --remote-debugging-port=9333 \
  --user-data-dir /tmp/shuvscode-amber-smoke/userdata \
  --extensions-dir /tmp/shuvscode-amber-smoke/exts \
  /tmp/shuvscode-amber-smoke/workspace \
  > /tmp/shuvscode-amber-cdp.log 2>&1 < /dev/null & disown
agent-browser --cdp 9333 tab t1
agent-browser --cdp 9333 screenshot /tmp/shuvscode-amber.png
```

Deterministic CSS check (avoids eyeballed regressions):

```bash
# Active list row background should resolve to an amber rgba, not navy.
agent-browser --cdp 9333 eval \
  "(()=>{const r=document.querySelector('.monaco-list-row.selected, .monaco-list-row.focused');return r?getComputedStyle(r).backgroundColor:'no row';})()"

# Active panel title border should resolve to amber #F3B042 or close.
agent-browser --cdp 9333 eval \
  "(()=>{const t=document.querySelector('.panel-switcher-container .action-item .active');return t?getComputedStyle(t).borderBottomColor||getComputedStyle(t).boxShadow:'no title';})()"
```

Verify visually:

- [ ] Active lower-panel/SCM title underline is amber.
- [ ] Explorer selected rows have visible amber selection without overpowering file colors.
- [ ] Projects selected/current rows match the Explorer selection language.
- [ ] The UI no longer reads as mostly navy in high-traffic navigation surfaces.
- [ ] Save the post-tune screenshot to `docs/recaps/` for the release recap.

## Issue #4: First-Class gh-dash Integration

### Relevant Files

- `src/stable/extensions/shuvscode-gh/extension.js`
- `src/stable/extensions/shuvscode-gh/package.json`
- `src/stable/extensions/shuvscode-projects/extension.js`
- `src/stable/extensions/shuvscode-projects/zellij.js`
- `README.md`
- `HANDOFF.md`
- `shuvscode.product.json`

### Product Decision

Implement `gh-dash` as an **augmenting terminal-first GitHub workflow**, not a hard replacement for GitHub Pull Requests yet.

Rationale:

- The bundled GitHub Pull Requests extension still provides inline comments, auth-provider activation, and GUI deep links.
- `gh-dash` fits high-frequency PR/issue triage in the integrated terminal.
- Keeping both paths lets #5 place SCM/GitHub state on the right while command palette actions launch terminal workflows.

### Settings namespace

All new settings live under the existing `shuvscode.gh.*` namespace so they grep alongside `shuvscode.gh.colocateWithSourceControl`. gh-dash is a sub-feature of the existing gh integration, not a parallel one. Use `shuvscode.gh.dash.*`.

### Tasks

- [ ] Extend `shuvscode-gh` detection state:
  - [ ] Keep existing `gh` detection/authentication.
  - [ ] Detect `gh-dash` via three first-class probes, tried in order:
    1. If `shuvscode.gh.dash.executablePath` is set, run `<path> --help` and treat it as a standalone command.
    2. Otherwise resolve `gh` to an executable path (configured shell `PATH`, then common desktop fallback paths such as `/usr/bin`, `/usr/local/bin`, and `$HOME/.local/bin`) and run `<resolved-gh> dash --help`.
    3. Otherwise resolve `gh-dash` the same way and run `<resolved-gh-dash> --help`.
  - [ ] Remember which probe succeeded and store a launch descriptor `{ command, args, kind }`, where `command` is an absolute path for `gh`/`gh-dash` whenever resolution succeeds. Do not store only the display command string.
  - [ ] Add context keys `shuvscode.gh.dash.detected` and `shuvscode.gh.dash.enabled`.
- [ ] Add settings in `src/stable/extensions/shuvscode-gh/package.json`:
  - [ ] `shuvscode.gh.dash.enabled` default `true`.
  - [ ] `shuvscode.gh.dash.executablePath` default empty. When set, used as-is; when unset, detection falls back to `gh dash` then `gh-dash`.
  - [ ] `shuvscode.gh.dash.terminalName` default `gh-dash`.
  - [ ] `shuvscode.gh.dash.autoPromptInstall` default `true`.
  - [ ] Do not add `shuvscode.gh.dash.terminalMode` in the first implementation batch unless the deferred Zellij path is also fully specified and smoked.
- [ ] Add commands (all under `shuvscode` palette category):
  - [ ] `shuvscode.gh.dash.open`
  - [ ] `shuvscode.gh.dash.openPullRequests`
  - [ ] `shuvscode.gh.dash.openIssues`
  - [ ] `shuvscode.gh.dash.openNotifications`
  - [ ] `shuvscode.gh.dash.install`
  - [ ] `shuvscode.gh.dash.refreshDetection`
- [ ] Consolidate `shuvscode-gh` activation events while adding the above. Current `activationEvents` is `["*", "onStartupFinished", ...redundant onView/onCommand entries]`; with `*` every other entry is dead. Reduce to `["onStartupFinished"]` plus the explicit `onView:` and `onCommand:` entries (including the new `shuvscode.gh.dash.*` commands), or keep `["*"]` only — pick one and drop the redundancies.
- [ ] Terminal behavior:
  - [ ] Reuse an existing terminal whose name matches `shuvscode.gh.dash.terminalName` when present.
  - [ ] Avoid interrupting an active session unless the user explicitly chooses restart.
  - [ ] Launch with a command string that works from desktop-reduced `PATH` where possible (use the absolute path the detection probe resolved, not bare `gh`, unless the user explicitly configured a bare executable path).
  - [ ] If `gh` is missing, show the existing GitHub CLI guidance.
  - [ ] If `gh` is installed but unauthenticated, route to `gh auth login`.
  - [ ] If `gh-dash` is missing, prompt before running `gh extension install dlvhdr/gh-dash` and show the exact command. Honor `shuvscode.gh.dash.autoPromptInstall = false` as silent skip.
- [ ] UX integration:
  - [ ] Add launcher rows to the existing `github:login` TreeDataProvider when authenticated.
  - [ ] Add command palette entries under category `shuvscode`.
  - [ ] Consider a status/log line in the existing `shuvscode GitHub` output channel.
  - [ ] Preserve current PR/Issues/Notifications view colocation behavior.
- [ ] Managed Zellij integration is **deferred out of the first #4 implementation batch** unless explicitly pulled back in after integrated-terminal smoke passes:
  - [ ] Keep the `shuvscode.gh.dash.terminalMode` setting documented as experimental only if implemented; otherwise omit it from the initial settings set.
  - [ ] If implemented later, call a narrow exported helper from `shuvscode-projects`/`zellij.js` rather than shelling out independently.
  - [ ] Do not mutate or kill user-created Zellij sessions; follow the ownership model already used by `src/stable/extensions/shuvscode-projects/zellij.js`.
  - [ ] Keep this optional until a real smoke proves the terminal UX is better than plain integrated terminal reuse.
- [ ] Docs:
  - [ ] Update README with recommended GitHub workflow: GUI views for inline review, `gh-dash` for PR/issue dashboard triage.
  - [ ] Document install prompt behavior and settings.
  - [ ] Mention `repoPaths` and `.gh-dash.yml` as user-owned config, not something shuvscode overwrites.

### Tests and Validation

Add focused tests only where practical with the current extension structure. If `extension.js` remains plain JS without a test harness, keep command builders/detection helpers pure enough to test with Node.

```bash
node --check src/stable/extensions/shuvscode-gh/extension.js
jq . src/stable/extensions/shuvscode-gh/package.json >/dev/null
```

Manual detection matrix:

- [ ] Missing `gh`.
- [ ] `gh` installed but unauthenticated.
- [ ] `gh` authenticated but `gh-dash` missing.
- [ ] `gh` authenticated and `gh-dash` installed.
- [ ] Desktop-launched shuvscode with reduced `PATH`.

Electron smoke:

```bash
rm -rf /tmp/shuvscode-ghdash-smoke
mkdir -p /tmp/shuvscode-ghdash-smoke/workspace
setsid nohup ./shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox --disable-gpu --new-window \
  --remote-debugging-port=9335 \
  --user-data-dir /tmp/shuvscode-ghdash-smoke/userdata \
  --extensions-dir /tmp/shuvscode-ghdash-smoke/exts \
  /tmp/shuvscode-ghdash-smoke/workspace \
  > /tmp/shuvscode-ghdash-cdp.log 2>&1 < /dev/null & disown
agent-browser --cdp 9335 tab t1
agent-browser --cdp 9335 press "Control+Shift+p"
agent-browser --cdp 9335 keyboard type "shuvscode: Open gh-dash"
agent-browser --cdp 9335 press Enter
agent-browser --cdp 9335 screenshot /tmp/shuvscode-ghdash.png
```

Acceptance:

- [ ] Command opens or reuses a terminal.
- [ ] Missing-tool prompts are clear and non-silent.
- [ ] Install command is never run without confirmation.
- [ ] Existing GitHub PR/Issues GUI surfaces still activate and colocate with SCM.

## Issue #5: Locked-By-Default Opinionated Workbench Layout

### Relevant Files

- `src/stable/extensions/shuvscode-bootstrap/extension.js`
- `src/stable/extensions/shuvscode-bootstrap/package.json`
- `src/stable/extensions/shuvscode-defaults/package.json`
- `src/stable/extensions/shuvscode-projects/package.json`
- `src/stable/extensions/shuvscode-projects/extension.js`
- `src/stable/extensions/shuvscode-gh/extension.js`
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css`
- `patches/user/26-canvas-scm-secondary-sidebar.patch`
- `patches/user/27-shuvscode-projects-top-activitybar.patch`
- `shuvscode.product.json`
- `README.md`
- `HANDOFF.md`

### Design Decision

Implement the layout as a **versioned first-run/reset orchestrator** hosted inside the existing `shuvscode-bootstrap` extension (not a new `shuvscode-layout` extension; not `shuvscode-defaults` which stays config-only). `shuvscode-bootstrap` already owns the one bootstrap memento (`shuvscode.bootstrapped`) and the canvas-SCM auto-open (`shuvscode.canvas.scmAuxiliaryOpened`), so layout state belongs in the same place.

Source-overlay and numbered core patches are used only where extension APIs cannot deterministically express default view locations. Specifically:

- **SCM placement is already deterministic** via `patches/user/26-canvas-scm-secondary-sidebar.patch` (pins `workbench.view.scm` to `ViewContainerLocation.AuxiliaryBar` at registration). The orchestrator only opens SCM; it never calls `vscode.moveViews` for the SCM container.
- **Projects-in-Explorer** is achieved by changing the contribution in `shuvscode-projects/package.json` from a custom activity-bar container to `views.explorer`, plus a small new core patch that controls its view order relative to the built-in File Explorer view. `patches/user/27-shuvscode-projects-top-activitybar.patch` is **reverted** as part of this change since the activity-bar container it pins no longer exists.
- **`vscode.moveViews` is an internal/private API** (today shuvscode-gh uses it for one-shot colocation; that's fine as a migration helper but not as the source of default placement).

Rules:

- Fresh profiles get the opinionated layout automatically.
- Existing profiles are not forcibly migrated.
- Reset command re-applies the current layout version.
- Unlock command persists an opt-out and stops automatic reassertion.
- "Hard-ish lock" means use upstream group locks and controlled reassertion, not invasive drag/drop prevention.

### Desired Default Layout

- Left primary sidebar visible.
- Explorer visible.
- shuvscode Projects view pinned above the normal file tree in Explorer.
- Right secondary sidebar visible.
- Source Control visible on the right, including non-git folders.
- GitHub PR/Issues/Notifications remain colocated with Source Control when present.
- Center editor grid:
  - Large left editor group.
  - Upper-right editor/diff group.
  - Lower-right terminal/function pane, preferably terminal-in-editor group.
- Command palette escape hatches:
  - `shuvscode: Reset Opinionated Layout`
  - `shuvscode: Unlock Opinionated Layout`
  - optional `shuvscode: Lock Opinionated Layout`

### Phase 1: State Model and Commands

State keys live in `ctx.globalState`. Setting keys live in `vscode.workspace.getConfiguration`. They are **separate namespaces**; do not reuse the same string for both.

- [ ] Add layout **state** keys (globalState mementos, mutated by code only):
  - [ ] `shuvscode.layout.appliedVersion` — integer; absent on profiles that have never had the orchestrator apply. Do **not** store sentinel strings such as `"inherited"` here because version comparison uses numeric ordering.
  - [ ] `shuvscode.layout.unlocked` — boolean; persists opt-out.
  - [ ] `shuvscode.layout.lastApplyStatus` — `"ok" | "failed" | "skipped:<reason>"`.
  - [ ] `shuvscode.layout.lastApplyAt` — ISO timestamp for the output-channel log.
- [ ] Add **settings** (user-editable in `settings.json`):
  - [ ] `shuvscode.layout.enabled` default `true`.
  - [ ] `shuvscode.layout.targetVersion` default the current integer the orchestrator ships with. Apply runs when `appliedVersion` is numeric and `targetVersion > appliedVersion`, or when reset explicitly forces apply. (Renamed from the original `shuvscode.layout.defaultVersion` to avoid collision with the memento.)
  - [ ] `shuvscode.layout.reassertOnStartup` default `true` for fresh profiles only.
  - [ ] `shuvscode.layout.debugLogging` default `true`, routes to the existing `shuvscode GitHub`-style output channel. Do not name this "telemetry"; shuvscode ships with telemetry stripped (`patches/user/15-strip-accounts-sync-telemetry.patch`).
- [ ] Add commands (all under `shuvscode` palette category):
  - [ ] `shuvscode.layout.reset`
  - [ ] `shuvscode.layout.unlock`
  - [ ] `shuvscode.layout.lock`
  - [ ] `shuvscode.layout.status`
- [ ] Ensure commands are visible in the Command Palette with lowercase `shuvscode` category/title conventions.
- [ ] Add output-channel logging for:
  - [ ] first apply
  - [ ] reset
  - [ ] unlock
  - [ ] skipped existing/customized user (with the sentinel reason; see Phase 4)
  - [ ] apply failure

### Phase 2: View Placement

- [ ] Make Projects live in Explorer by default:
  - [ ] Change `src/stable/extensions/shuvscode-projects/package.json` contributions: drop the `viewsContainers.activitybar` `shuvscode-projects` entry, move the `shuvscodeProjects.projects` view into `views.explorer` with a low `order` so it pins above the built-in File Explorer view.
  - [ ] **Revert `patches/user/27-shuvscode-projects-top-activitybar.patch`** — the container it pinned no longer exists. Delete the file and ensure `scripts/prepare-shuvscode-tree.sh` no longer applies it.
  - [ ] If the public `order` field alone does not pin the view above the built-in `workbench.explorer.fileView`, add a new numbered core patch (`patches/user/34-shuvscode-projects-explorer-order.patch`) that registers/orders the view above File Explorer at the view-registry level.
  - [ ] Register a Command Palette launcher `shuvscode.projects.focus` that calls `workbench.view.explorer` and then reveals/focuses `shuvscodeProjects.projects` (prefer the generated focus command `shuvscodeProjects.projects.focus` if available in the built app). Do **not** call `workbench.view.extension.shuvscode-projects` after deleting the activity-bar container because that container command should no longer exist. **Locked decision:** the activity-bar container is dropped; the Palette command is the surviving entry point.
- [ ] Show Explorer on the left:
  - [ ] Use `workbench.view.explorer`.
  - [ ] Avoid repeatedly stealing focus after first apply/reset.
- [ ] Show Source Control on the right:
  - [ ] **No move is performed.** `patches/user/26-canvas-scm-secondary-sidebar.patch` already pins the SCM container to `ViewContainerLocation.AuxiliaryBar` at registration. The orchestrator only:
    - [ ] Keeps `workbench.secondarySideBar.defaultVisibility: "visible"` in `shuvscode-defaults`.
    - [ ] Calls `workbench.view.scm` once on first apply (matches the existing `shuvscode-bootstrap` line 18-23 behavior, which is consolidated into the orchestrator).
- [ ] Hand off GitHub view colocation cleanly to `shuvscode-gh`:
  - [ ] **Locked decision:** `shuvscode-gh` remains the sole owner of GitHub view placement (`pr:github` / `issues:github` / `notifications:github`). The orchestrator never moves these views.
  - [ ] After SCM is open, the orchestrator sets a context key `shuvscode.layout.scmReady = true` for menus/diagnostics and exposes an awaitable readiness API for code-level consumers.
  - [ ] Implement the awaitable readiness API explicitly; do **not** rely on `globalState` for cross-extension events because VS Code extension mementos are extension-scoped and context keys are not awaitable. Preferred shape: `shuvscode-bootstrap` exports an API from `activate` with `whenScmReady(): Promise<boolean>` and `getScmReadyState(): boolean`; `shuvscode-gh` calls `vscode.extensions.getExtension('shuvscode.shuvscode-bootstrap')?.activate()` and awaits `whenScmReady()`.
  - [ ] `shuvscode-gh`'s `colocateWithSourceControlIfNeeded` (currently in `extension.js:220`) is updated to await that API with a short fallback timeout (≈2s) for profiles where the orchestrator is disabled or the API is unavailable. This replaces the current race-prone activation ordering.
  - [ ] `shuvscode.gh.colocateWithSourceControl` opt-out is preserved.
  - [ ] On unlock or reset, the orchestrator does **not** re-run gh-colocation — that flag is one-shot per profile by design. Users who want to redo the move call `shuvscode.gh.resetColocation` and reload.

### Phase 3: Editor Grid and Terminal Pane

Use these exact command IDs (validated against upstream VS Code 1.120 + the shuvscode patch set; do not substitute):

- [ ] Prototype with built-in commands, in this order:
  - [ ] `workbench.action.splitEditorRight` — create the upper-right editor group.
  - [ ] `workbench.action.splitEditorOrthogonal` (or `workbench.action.splitEditorDown` when run with the right group focused) — split the right group downward.
  - [ ] `workbench.action.createTerminalEditor` — open a terminal in the lower-right editor slot. **Not** `workbench.action.terminal.toggleTerminal` (that opens the bottom panel and conflicts with the desired pane layout).
  - [ ] `workbench.action.lockEditorGroup` — lock the lower-right group so the terminal stays put.
  - [ ] `workbench.action.focusFirstEditorGroup` — leave the large left group active for editing.
- [ ] Set `terminal.integrated.defaultLocation: "editor"` in `shuvscode-defaults` so subsequent terminals also open in the editor area by default.
- [ ] If command sequencing is unstable, add a narrow core/default-layout patch instead of timing hacks.
- [ ] Decide exact terminal behavior:
  - [ ] Prefer terminal-in-editor for the lower-right function pane.
  - [ ] Do not replace the managed Zellij session; this is the default function pane, not project switching.
  - [ ] Avoid auto-running commands in the default terminal.
- [ ] Add layout drift detection:
  - [ ] Detect missing secondary sidebar/SCM/Explorer at startup.
  - [ ] Detect missing layout version.
  - [ ] Reassert only when `enabled && !unlocked && profile is fresh or reset was requested`.

### Phase 4: Fresh Profile Boundary

Define "fresh" using a **multi-sentinel** gate so the first build that ships the orchestrator does not clobber existing users (every current user has `appliedVersion` absent, so `appliedVersion`-absent alone is not sufficient).

Compute the fresh-profile decision **before** writing or updating any legacy bootstrap sentinels. The current bootstrap writes `shuvscode.canvas.scmAuxiliaryOpened` early; preserving that order would make a truly fresh profile look like an existing profile before layout application runs.

- [ ] A profile is **fresh** iff *all* of these are true:
  - [ ] `globalState.get('shuvscode.layout.appliedVersion')` is undefined.
  - [ ] `globalState.get('shuvscode.layout.unlocked')` is not `true`.
  - [ ] **And neither of these existing sentinels is set**, indicating this profile predates the orchestrator:
    - [ ] `globalState.get('shuvscode.bootstrapped')` is undefined (set by current `shuvscode-bootstrap/extension.js:3`).
    - [ ] `globalState.get('shuvscode.canvas.scmAuxiliaryOpened')` is undefined (set by current `shuvscode-bootstrap/extension.js:4`).
- [ ] On first activation after upgrade, for any profile where the orchestrator is not fresh by the above rule:
  - [ ] Write `lastApplyStatus = 'skipped:existing-profile'` and `lastApplyAt = <ISO timestamp>` to the memento so future restarts log clean skips and the user's customized layout is preserved.
  - [ ] Leave `appliedVersion` unset or `0` for skipped existing profiles; do not write a string sentinel. Future automatic applies must remain gated by the existing-profile sentinel/unlocked state, not by string version comparisons.
  - [ ] Surface a one-time information message pointing to `shuvscode: Reset Opinionated Layout` as the explicit migration path.
- [ ] Existing users:
  - [ ] Do not migrate automatically.
  - [ ] Log skipped state.
  - [ ] Offer reset command as the explicit migration path.
- [ ] New empty windows and newly opened folders:
  - [ ] Apply if profile is fresh and `appliedVersion` is absent, or if `appliedVersion` is numeric and `targetVersion > appliedVersion`.
  - [ ] Reuse current profile state for subsequent windows.
  - [ ] Do not repeatedly reset after the user customizes layout unless reset command is run.

### Phase 5: Tests

- [ ] Add pure helper tests if layout state helpers are factored:
  - [ ] fresh profile decision
  - [ ] unlocked skip
  - [ ] version bump apply
  - [ ] reset forces apply
  - [ ] existing profile skip
- [ ] Existing extension checks:

```bash
node --check src/stable/extensions/shuvscode-bootstrap/extension.js
jq . src/stable/extensions/shuvscode-bootstrap/package.json >/dev/null
node --check src/stable/extensions/shuvscode-gh/extension.js
node --check src/stable/extensions/shuvscode-projects/extension.js
node --check src/stable/extensions/shuvscode-projects/zellij.js
node --test src/stable/extensions/shuvscode-projects/zellij.test.js
jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null
jq . src/stable/extensions/shuvscode-defaults/package.json >/dev/null
```

### Phase 6: Browser/Electron Smoke Matrix

Use CDP for every browser command and target `tab t1`.

Fresh non-git folder:

```bash
rm -rf /tmp/shuvscode-layout-nongit
mkdir -p /tmp/shuvscode-layout-nongit/workspace
setsid nohup ./shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox --disable-gpu --new-window \
  --remote-debugging-port=9336 \
  --user-data-dir /tmp/shuvscode-layout-nongit/userdata \
  --extensions-dir /tmp/shuvscode-layout-nongit/exts \
  /tmp/shuvscode-layout-nongit/workspace \
  > /tmp/shuvscode-layout-nongit.log 2>&1 < /dev/null & disown
agent-browser --cdp 9336 tab t1
agent-browser --cdp 9336 snapshot --compact
agent-browser --cdp 9336 screenshot /tmp/shuvscode-layout-nongit.png
```

Fresh git folder:

```bash
rm -rf /tmp/shuvscode-layout-git
mkdir -p /tmp/shuvscode-layout-git/workspace
git -C /tmp/shuvscode-layout-git/workspace init -q -b master
printf "layout smoke\n" > /tmp/shuvscode-layout-git/workspace/README.md
setsid nohup ./shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox --disable-gpu --new-window \
  --remote-debugging-port=9334 \
  --user-data-dir /tmp/shuvscode-layout-git/userdata \
  --extensions-dir /tmp/shuvscode-layout-git/exts \
  /tmp/shuvscode-layout-git/workspace \
  > /tmp/shuvscode-layout-git.log 2>&1 < /dev/null & disown
agent-browser --cdp 9334 tab t1
agent-browser --cdp 9334 snapshot --compact
agent-browser --cdp 9334 screenshot /tmp/shuvscode-layout-git.png
```

Command smoke:

- [ ] Run `shuvscode: Unlock Opinionated Layout`, restart, verify no reassertion.
- [ ] Manually drift the layout, run `shuvscode: Reset Opinionated Layout`, verify reapply.
- [ ] Restart after reset, verify layout remains stable without repeated disruptive resets.

Acceptance evidence:

- [ ] Screenshot for non-git folder with SCM empty/init state on the right.
- [ ] Screenshot for git folder with SCM changes on the right.
- [ ] Screenshot showing Projects above file tree on the left.
- [ ] Screenshot showing editor/terminal grid.
- [ ] Output-channel log lines for first apply, reset, unlock, and skip.

## Cross-Issue Build and Release Checklist

Target release: **`v1.120.03316.shuv1`** (one tag covering #3, #4, #5).

Run after all three issue batches are source-complete:

```bash
git status --short --branch
node --check src/stable/extensions/shuvscode-gh/extension.js
node --check src/stable/extensions/shuvscode-bootstrap/extension.js
node --check src/stable/extensions/shuvscode-projects/extension.js
node --check src/stable/extensions/shuvscode-projects/zellij.js
node --test src/stable/extensions/shuvscode-projects/zellij.test.js
jq . src/stable/extensions/shuvscode-gh/package.json >/dev/null
jq . src/stable/extensions/shuvscode-bootstrap/package.json >/dev/null
jq . src/stable/extensions/shuvscode-defaults/package.json >/dev/null
jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null
jq . src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme.json >/dev/null
jq . src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme-noitalic.json >/dev/null
jq . shuvscode.product.json >/dev/null
./scripts/prepare-shuvscode-tree.sh
setsid nohup ./scripts/build-shuvscode.sh > /tmp/shuvscode-open-issues-build.log 2>&1 < /dev/null & disown
```

After build:

```bash
./shuvscode-linux-x64/bin/shuvscode --version
```

Release only after smoke evidence is captured:

- [ ] Commit the implementation with conventional commit messages (one logical commit per issue: #5 layout orchestrator, #3 amber tuning, #4 gh-dash integration). Add a `Co-authored-by: Codex <noreply@openai.com>` trailer only if Codex actually authored or materially contributed to the implementation being committed.
- [ ] Save final screenshots into `docs/recaps/` (non-git folder, git folder, post-amber list-row, gh-dash terminal).
- [ ] Tag `v1.120.03316.shuv1` if the user asks to ship it.
- [ ] Update AUR `packaging/aur/shuvscode-bin/PKGBUILD` (`pkgver` + `sha256sum`) and regenerate `.SRCINFO` via `makepkg --printsrcinfo` only as part of an explicit release/install step.
- [ ] Update `HANDOFF.md` from live state after implementation and validation.
- [ ] Close #3, #4, and #5 only after each issue's acceptance criteria is proven in the built app.

## Risks

- Projects-in-Explorer ordering may not be deterministic from public extension APIs. SCM-in-secondary is already deterministic via patch 26 — do not redo it. For Projects, prefer the new core patch (`34-shuvscode-projects-explorer-order.patch`) over timing-dependent command loops if smoke shows view placement races.
- Editor-group grid and terminal-in-editor lock behavior may depend on internal command availability. Command IDs in Phase 3 are pinned, but validate in the built app before committing to a pure-extension approach.
- `vscode.moveViews` is an internal/private API. It is fine for one-shot migrations (existing `shuvscode-gh` colocation, and the orchestrator's reset command) but is **not** the source of default placement.
- `gh-dash` config is user-owned. shuvscode should document recommended `.gh-dash.yml` patterns but should not overwrite global or repo config without explicit consent.
- Fresh-profile detection must be conservative to avoid clobbering existing users' customized layouts. The multi-sentinel gate in Phase 4 is the contract; do not relax it.
- Build scripts can be killed by non-detached shells; use `setsid nohup ... < /dev/null & disown` for long builds (per `HANDOFF.md:74-79`).

## Locked implementation decisions

1. **Projects activity-bar surface after the Explorer move:** the activity-bar container `shuvscode-projects` is dropped entirely. `shuvscode.projects.focus` is registered as the Command Palette launcher to keep the surface recoverable. `patches/user/27-shuvscode-projects-top-activitybar.patch` is reverted in the same commit.
2. **GitHub view placement ownership on fresh profiles:** `shuvscode-gh` stays the single owner of GitHub view placement. The layout orchestrator emits `shuvscode.layout.scmReady` as a context key and exposes an explicit exported readiness API; `shuvscode-gh.colocateWithSourceControlIfNeeded` waits on the API with a ≈2s timeout fallback. The one-shot per-profile colocation flag in `shuvscode-gh/extension.js:216-240` is preserved; the orchestrator never re-runs colocation on reset/unlock.
3. **gh-dash Zellij path:** the initial #4 implementation defaults to integrated terminal reuse. Managed Zellij launch is deferred unless the implementation also defines and smokes a narrow safe helper that uses the existing shuvscode Projects ownership model.
