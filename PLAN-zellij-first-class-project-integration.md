# PLAN: First-Class Zellij Project Integration

## Goal

Make project switching in `shuvscode` feel fast by moving long-lived per-project execution state into a shuvscode-managed Zellij session and reducing how often the VS Code workbench performs a full same-window `vscode.openFolder` reload.

The target experience is:

- `shuvscode` owns one durable managed Zellij session, default name `shuvscode-managed`.
- Each active project gets a named Zellij tab, created on demand.
- One integrated terminal attaches to the managed session and stays shared across project switches.
- Fast project switching focuses the project tab and updates shuvscode project UI state first.
- Full VS Code workspace reload remains available as an explicit command for language services, Explorer, SCM, and extension-context changes.
- Per-project UI customization can be reduced if that buys a materially faster multi-project workflow.

## Current State

The repo already has generic multiplexer support:

- `src/stable/extensions/shuvscode-projects/extension.js`
  - Registers `shuvscodeProjects.openMultiplexerTerminal`.
  - Supports `shuvscode.projects.multiplexerCommand`, `shuvscode.projects.multiplexerTerminalName`, and `shuvscode.projects.autoOpenMultiplexer`.
  - Uses `vscode.window.createTerminal()` and `terminal.sendText(command, true)`.
  - Tracks actual open shuvscode windows through `WindowRegistry` and `windows.json`.
- `src/stable/extensions/shuvscode-projects/package.json`
  - Contributes the current multiplexer settings and Projects commands.
- `patches/user/28-persistent-project-terminals.patch`
  - Keeps terminal processes alive across `ShutdownReason.LOAD` and reload.
- `patches/user/29-multiplexer-friendly-reattach.patch`
  - Detects alternate-screen terminal replay and forces a SIGWINCH redraw for TUIs such as zellij, tmux, neovim, btop, and lazygit.
- `README.md`
  - Documents current multiplexer support as generic, command-template based support.

The current implementation is useful but still treats Zellij as a command launched inside a terminal. It does not model Zellij sessions/tabs as first-class project state.

## Local Zellij Findings

Local installed version:

```bash
zellij 0.44.2
```

Relevant available commands:

```bash
zellij attach --create <session>
zellij attach --create-background <session>
zellij --session <session> action new-tab --cwd <path> --name <name>
zellij --session <session> action list-tabs --json
zellij --session <session> action go-to-tab <position>
zellij --session <session> action go-to-tab-by-id <tab_id>
zellij --session <session> action go-to-tab-name --create <name>
zellij --session <session> action close-tab-by-id <tab_id>
zellij list-sessions --short --no-formatting
```

Important local behavior already observed:

- `zellij attach --create-background <session>` creates a default `Tab #1`.
- Creating two project tabs after that produced project tab positions `1` and `2`.
- Therefore the plan must deliberately handle the initial hub tab instead of assuming the first project tab is position `0`.

Official docs:

- https://zellij.dev/documentation/controlling-zellij-through-cli.html
- https://zellij.dev/documentation/cli-recipes.html
- https://zellij.dev/documentation/programmatic-control.html
- https://zellij.dev/documentation/cli-actions.html

## Product Decisions

- V1 uses a dedicated managed session named `shuvscode-managed`, not `shuvscode`, to avoid colliding with existing user sessions.
- V1 keeps the normal project tree click behavior as "Open Project in This Window". Fast switching is an inline/context command until it is proven.
- V1 creates tabs incrementally through Zellij CLI actions. Generated Zellij layout files are deferred.
- V1 default project tab bootstrap is an idle shell. Custom bootstrap commands are opt-in.
- V1 defers multi-root workspace generation. The first implementation should prove the stable-workbench-plus-Zellij-tabs workflow.
- The managed session must never be killed, reset, or force-recreated without explicit confirmation.

## Core Design

### Managed Session

Add a dedicated `ZellijManager` in the Projects extension. This is explicit Zellij integration, separate from the existing generic multiplexer command template.

Proposed settings in `src/stable/extensions/shuvscode-projects/package.json`:

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `shuvscode.projects.zellij.enabled` | boolean | `false` | Enables first-class Zellij project integration. |
| `shuvscode.projects.zellij.executablePath` | string | `zellij` | Binary path or command name. Important for GUI-launched shuvscode where PATH may differ from the user's shell. |
| `shuvscode.projects.zellij.sessionName` | string | `shuvscode-managed` | Managed session name. |
| `shuvscode.projects.zellij.autoStart` | boolean | `true` | Create the managed background session when Projects activates. |
| `shuvscode.projects.zellij.openSharedTerminalOnStart` | boolean | `false` | Open one terminal attached to the managed session on activation. Default false avoids surprise terminals. |
| `shuvscode.projects.zellij.fastSwitchMode` | string enum | `zellij-only` | `zellij-only`, `zellij-then-folder`, or `folder-only`. |
| `shuvscode.projects.zellij.tabNameTemplate` | string | `${projectSlug}` | Stable project tab names. |
| `shuvscode.projects.zellij.bootstrapCommand` | string | `` | Optional shell command for new project tabs. Empty means idle shell. |
| `shuvscode.projects.defaultProjectAction` | string enum | `open-workspace` | `open-workspace` or `fast-switch`; keep `open-workspace` for V1. |

Keep the existing generic multiplexer settings for tmux/custom users. Treat `shuvscode.projects.zellij.*` as the preferred path for managed Zellij workflows.

### Session Ownership

The manager must distinguish a shuvscode-owned session from a user-created session with the same name.

Store ownership metadata in extension global storage:

```text
User/globalStorage/shuvscode.shuvscode-projects/zellij-managed-session.json
```

Suggested shape:

```json
{
  "version": 1,
  "sessionName": "shuvscode-managed",
  "createdBy": "shuvscode-projects",
  "createdAt": 1780000000000,
  "lastSeenAt": 1780000000000
}
```

Rules:

- If the configured session exists and metadata matches, treat it as managed.
- If the configured session exists and metadata is missing, treat it as unowned. Do not modify destructive state; show a warning and offer to use it, rename the managed session, or cancel.
- If a reset/restart command is added, require confirmation and only enable it for owned sessions.
- Never call `zellij kill-session` automatically.

### Initial Hub Tab

Background session creation creates a default `Tab #1`. V1 should intentionally use that tab as a hub instead of fighting it.

Startup rules:

- After session creation, list tabs.
- If only the default tab exists, rename it to `hub` if Zellij exposes a reliable action for doing so in the target version.
- If renaming from the extension host is unreliable, leave it as `Tab #1` but treat it as reserved and do not map it to a project.
- Project tab lookup must ignore the reserved hub/default tab unless a project explicitly matches it.
- Acceptance tests must assert that the first project tab can be focused even when a default hub tab exists at position `0`.

### Active Project State

Fast switching cannot rely on `vscode.workspace.workspaceFolders` because the whole point is to avoid reloading the workbench.

Add active-project state before adding the final fast-switch command:

```text
User/globalStorage/shuvscode.shuvscode-projects/active-project.json
```

Suggested shape:

```json
{
  "version": 1,
  "name": "shuvscode",
  "rootPath": "/home/shuv/repos/shuvscode",
  "source": "zellij-fast-switch",
  "updatedAt": 1780000000000
}
```

UI rules:

- `workspace` means the actual VS Code workspace folder from `vscode.workspace.workspaceFolders`.
- `active` means the current fast-switch/Zellij-focused project.
- `zellij` means a known Zellij tab exists for the project.
- If `active.rootPath !== workspace.rootPath`, the status bar should show both facts clearly, for example `$(terminal) shuvscode` with tooltip `Active Zellij project: ...; Workspace: ...`.
- Add `Open Active Project as Workspace` to convert the active project into a real `vscode.openFolder` load.

### Open Windows Semantics

`WindowRegistry` currently tracks actual shuvscode windows by workspace root. Fast switching must not make "Open Windows" lie.

Revise registry entries to allow both roots:

```json
{
  "windowId": "abc123",
  "pid": 12345,
  "workspaceName": "hub",
  "workspaceRoot": "/home/shuv/repos",
  "activeProjectName": "shuvscode",
  "activeProjectRoot": "/home/shuv/repos/shuvscode",
  "updatedAt": 1780000000000
}
```

Rules:

- The Open Windows group remains about actual windows.
- Descriptions may show `workspace: hub` and `active: shuvscode` when they differ.
- Switching to an Open Window should still focus/load the actual window workspace behavior that exists today; active-project handoff across windows is a later enhancement.

### ZellijManager Responsibilities

Add `ZellijManager` alongside `ProjectStore` and `WindowRegistry` in `src/stable/extensions/shuvscode-projects/extension.js`, or split it into `src/stable/extensions/shuvscode-projects/zellij.js` if the file becomes unwieldy.

Responsibilities:

- Resolve the configured executable path.
- Diagnose missing/unusable Zellij with actionable messages.
- Start the managed session in the background.
- Attach the shared terminal with `zellij attach --create <session>`.
- List tabs with `zellij --session <session> action list-tabs --json`.
- Create a project tab if missing.
- Focus a project tab with the most reliable action proven in Phase 0.
- Cache project root to Zellij tab metadata in extension global storage.

Use `child_process.execFile()` or `spawn()` with argument arrays for Zellij control. Do not build shell strings for paths, session names, or tab names.

Only use a shell when the user explicitly configured `bootstrapCommand`; treat that setting as trusted local code and document it as such.

### Project Tab State

Suggested storage file:

```text
User/globalStorage/shuvscode.shuvscode-projects/zellij-projects.json
```

Suggested shape:

```json
{
  "version": 1,
  "sessionName": "shuvscode-managed",
  "projects": {
    "/home/shuv/repos/shuvscode": {
      "name": "shuvscode",
      "slug": "shuvscode",
      "tabName": "shuvscode",
      "tabId": 3,
      "tabPosition": 1,
      "lastFocusedAt": 1780000000000
    }
  }
}
```

Treat `tabId` and `tabPosition` as cached hints, not source of truth. Always refresh from `list-tabs --json` before issuing a focus action. Tab names are user-visible and can be renamed inside Zellij, so recovery must handle missing or changed tabs.

### Package Contributions

The plan must include package metadata work, not just extension code.

Update `src/stable/extensions/shuvscode-projects/package.json`:

- Add activation events for new commands:
  - `onCommand:shuvscodeProjects.fastSwitchProject`
  - `onCommand:shuvscodeProjects.openProjectWorkspace`
  - `onCommand:shuvscodeProjects.openActiveProjectAsWorkspace`
  - `onCommand:shuvscodeProjects.openManagedZellij`
  - `onCommand:shuvscodeProjects.refreshZellijState`
  - optional confirmed command: `onCommand:shuvscodeProjects.restartManagedZellij`
- Add command contributions with icons:
  - `Projects: Fast Switch Project`
  - `Projects: Open Project Workspace`
  - `Projects: Open Active Project as Workspace`
  - `Projects: Open Managed Zellij Session`
  - `Projects: Refresh Zellij State`
- Add inline/context menu items:
  - Fast switch on normal project items.
  - Open workspace as the explicit heavier action.
  - Open/focus Zellij tab only when Zellij is enabled.
- Add configuration schema for all `shuvscode.projects.zellij.*` settings.
- Add context keys if needed, such as `shuvscode.projects.zellij.enabled`, `shuvscode.projects.zellij.available`, and `shuvscode.projects.hasActiveProject`.

## Implementation Plan

### Phase 0: Prove Zellij Control From Outside the Session

This phase is a blocker. Do not implement the extension integration until this behavior is proven with a visible attached client.

- [x] Create a throwaway session:

```bash
zellij attach --create-background shuvscode-zellij-proof
```

- [x] Attach a visible client in a terminal.
- [x] From a separate shell, create two tabs:

```bash
zellij --session shuvscode-zellij-proof action new-tab --cwd /tmp --name proof-a
zellij --session shuvscode-zellij-proof action new-tab --cwd /tmp --name proof-b
```

- [x] Compare focus behavior for:

```bash
zellij --session shuvscode-zellij-proof action go-to-tab-name proof-a
zellij --session shuvscode-zellij-proof action go-to-tab-by-id <tab_id>
zellij --session shuvscode-zellij-proof action go-to-tab <position>
zellij --session shuvscode-zellij-proof action switch-session shuvscode-zellij-proof --tab-position <position>
```

- [x] Choose the most reliable focus primitive and update this plan if needed.
- [x] Record whether the default `Tab #1` can be renamed or should remain the reserved hub tab.
- [x] Clean up only the throwaway proof session:

```bash
zellij kill-session shuvscode-zellij-proof
```

### Phase 1: Baseline and Safety

- [x] Add debug timing around current full workspace switching in `chooseAndOpenProject()` and `switchToWindow`.
- [x] Capture rough timings for:
  - Projects command invoked.
  - `vscode.openFolder` requested.
  - Projects extension reactivated.
  - `WindowRegistry.update()` completed.
  - terminal reattached and visible.
- [x] Add a `README.md` note that current generic multiplexer support remains supported but is not the fast-switch architecture.
- [x] Validate existing behavior before changes:

```bash
node --check src/stable/extensions/shuvscode-projects/extension.js
jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null
./shuvscode-linux-x64/bin/shuvscode --version
```

### Phase 2: ZellijManager Helper Layer

- [x] Add a helper module if useful: `src/stable/extensions/shuvscode-projects/zellij.js`.
- [x] Implement `runZellij(args, options)` using `execFile` with timeout, stdout/stderr capture, and structured errors.
- [x] Implement `zellijAvailable()` using configured `zellij.executablePath`.
- [x] Implement diagnostics for missing executable, bad PATH, unsupported version, and JSON parse failures.
- [x] Implement `ensureManagedSession(sessionName)` using:

```bash
zellij attach --create-background <sessionName>
```

- [x] Implement ownership metadata read/write for `zellij-managed-session.json`.
- [x] Implement unowned-session detection and non-destructive warning UX.
- [x] Implement `listZellijTabs(sessionName)` using:

```bash
zellij --session <sessionName> action list-tabs --json
```

- [x] Implement hub/default-tab handling.
- [x] Implement `ensureProjectTab(sessionName, project)`:
  - Refresh current tabs.
  - Find by exact tab name first.
  - Create with `action new-tab --cwd <rootPath> --name <tabName>` if missing.
  - Refresh and return tab metadata.
- [x] Implement `focusProjectTab(sessionName, tab)` using the Phase 0-proven focus primitive.
- [x] Unit-test helper parsing with fixture JSON from `list-tabs --json`, including a default hub tab and renamed/missing project tab cases.

### Phase 3: Active Project State

- [x] Add active-project read/write helpers.
- [x] Update status bar rendering to prefer active Zellij project when present and show workspace-vs-active difference in the tooltip.
- [x] Update `ProjectItem` description/icon logic so it can render:
  - `workspace`
  - `active`
  - `zellij`
  - `missing`
- [x] Add command `shuvscodeProjects.openActiveProjectAsWorkspace`.
- [x] Update `WindowRegistry.update()` to include both workspace and active-project fields without breaking old entries.
- [x] Keep old `windows.json` readers tolerant of entries that only have `name` and `rootPath`.

### Phase 4: Managed Shared Terminal

- [x] Add `openManagedZellijTerminal()`:
  - Reuse terminal named `zellij: <sessionName>`.
  - Create terminal with current workspace/root cwd if missing.
  - Send `zellij attach --create <sessionName>` once.
- [x] Add command `shuvscodeProjects.openManagedZellij`.
- [x] If `zellij.autoStart` is enabled, start the background session on activation only after ownership checks.
- [x] If `zellij.openSharedTerminalOnStart` is enabled, show the shared terminal on activation or first project switch.
- [x] Ensure this path does not create a new VS Code terminal per project.

### Phase 5: Fast Switch Command

- [x] Add command `shuvscodeProjects.fastSwitchProject`.
- [x] Add inline Projects tree action for fast switching.
- [x] Keep default project item click as `openProject` for V1 unless the user changes `shuvscode.projects.defaultProjectAction`.
- [x] Implement `fastSwitchProject(project)`:
  - Validate project path exists.
  - `store.remember(project)`.
  - `zellijManager.ensureManagedSession()`.
  - `zellijManager.ensureProjectTab(project)`.
  - `openManagedZellijTerminal()`.
  - `zellijManager.focusProjectTab(project)`.
  - Write active-project state.
  - Refresh Projects view/status/window registry.
- [x] If `fastSwitchMode` is `zellij-then-folder`, call `vscode.openFolder` only after Zellij tab focus succeeds.
- [x] If Zellij is disabled or unavailable, show a clear warning and offer the existing `Open Project in This Window` fallback.
- [x] Preserve `openProject` and `openProjectInNewWindow` as explicit workspace/window commands.

### Phase 6: Package Metadata and Documentation

- [x] Update `src/stable/extensions/shuvscode-projects/package.json` activation events, commands, menus, context keys, and configuration schema.
- [x] Update `README.md` Projects Workflow section with first-class Zellij mode.
- [x] Update `AGENTS.md` with operational notes only after the integration is proven.
- [x] Add a migration note explaining that `shuvscode.projects.multiplexerCommand` remains supported but `shuvscode.projects.zellij.*` is preferred for managed Zellij workflows.
- [x] Document defaults:

```text
session: shuvscode-managed
terminal: zellij: shuvscode-managed
hub tab: Tab #1 or hub
project tab: ${projectSlug}
```

### Phase 7: Multi-Project Strategy Follow-Up

Evaluate these only after the basic fast path is validated:

| Strategy | Pros | Cons |
| --- | --- | --- |
| Stable hub workspace + Zellij tabs | Fastest switching; one terminal; fewer UI rebuilds | Language services and Explorer remain less project-specific unless explicitly opened |
| Multi-root workspace generated from favorites | More VS Code-native cross-project view; no full reload between roots | Can get noisy; extension contexts and SCM may scale poorly with many repos |
| One shuvscode window per important project + shared Zellij session | Preserves per-project UI; Open Windows registry already supports this | More windows; switching relies on WM/window focus instead of one stable surface |

Initial recommendation remains stable hub workspace + Zellij tabs.

## Validation Plan

## Final Implementation Evidence

Completed in this checkout on 2026-05-17.

- Phase 0 proved visible-client Zellij control on local `zellij 0.44.2`:
  - `go-to-tab-name proof-a` and `go-to-tab-by-id <id>` focus the attached client.
  - `go-to-tab <position>` is one-based for the observed local session.
  - `switch-session --tab-position <position>` was not reliable enough for V1 focus.
  - `rename-tab-by-id 0 hub` works for the background-created default tab.
- Source and packaged helper validation passed:
  - `node --check src/stable/extensions/shuvscode-projects/extension.js`
  - `node --check src/stable/extensions/shuvscode-projects/zellij.js`
  - `node --test src/stable/extensions/shuvscode-projects/zellij.test.js`
  - `node --check shuvscode-linux-x64/resources/app/extensions/shuvscode-projects/extension.js`
  - `node --check shuvscode-linux-x64/resources/app/extensions/shuvscode-projects/zellij.js`
  - `node --test shuvscode-linux-x64/resources/app/extensions/shuvscode-projects/zellij.test.js`
- Build validation passed:
  - `./scripts/prepare-shuvscode-tree.sh`
  - `./scripts/build-shuvscode.sh`
  - `./shuvscode-linux-x64/bin/shuvscode --version` returned `1.120.03302`.
- Packaged Zellij smoke passed with a uniquely named disposable session:
  - Created `hub`, `project:alpha-project`, and `project:beta-project`.
  - Persisted both project roots in `zellij-projects.json`.
  - Cleaned the smoke session afterward.
- Attached-client focus smoke passed with the packaged helper:
  - Focused `focus:project-a`, then `focus:project-b`, then returned to `focus:project-a`.
  - Reused the original Project A tab id when returning.
  - Cleaned the smoke session afterward.
- Electron/CDP smoke passed through Vercel `agent-browser 0.27.0`:
  - Launched the rebuilt app with `--remote-debugging-port=9333` and an isolated profile.
  - `agent-browser --cdp 9333 get title` returned `shuvscode-zellij-electron-workspace - shuvscode`.
  - Projects view exposed `Open Managed Zellij Session` and `Refresh Zellij State`.
  - Opening the managed session created the integrated terminal `zellij: shuvscode-managed-electron-smoke`.
  - Running `Projects: Fast Switch Project` for `shuvscode` created/focused Zellij tab `smoke:shuvscode`.
  - `active-project.json` recorded `/home/shuv/repos/shuvscode` with source `zellij-fast-switch`.
  - Status bar distinguished active project `/home/shuv/repos/shuvscode` from workspace `/tmp/shuvscode-zellij-electron-workspace`.
  - Cleaned the Electron profile and smoke Zellij session afterward.

### Static Validation

```bash
node --check src/stable/extensions/shuvscode-projects/extension.js
jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null
```

If a helper file is added:

```bash
node --check src/stable/extensions/shuvscode-projects/zellij.js
```

### Local CLI Validation

Use a throwaway session:

```bash
zellij attach --create-background shuvscode-smoke
zellij --session shuvscode-smoke action new-tab --cwd /tmp --name tmp-a
zellij --session shuvscode-smoke action new-tab --cwd /tmp --name tmp-b
zellij --session shuvscode-smoke action list-tabs --json
zellij --session shuvscode-smoke action go-to-tab-name tmp-a
zellij kill-session shuvscode-smoke
```

### Built App Validation

Rebuild after source-overlay changes:

```bash
./scripts/prepare-shuvscode-tree.sh
./scripts/build-shuvscode.sh
./shuvscode-linux-x64/bin/shuvscode --version
```

Smoke with an isolated profile:

```bash
./shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox \
  --disable-gpu \
  --new-window \
  --remote-debugging-port=9333 \
  --user-data-dir /tmp/shuvscode-zellij-user-data \
  --extensions-dir /tmp/shuvscode-zellij-extensions \
  /tmp/shuvscode-zellij-workspace
```

Drive with `agent-browser`:

```bash
agent-browser --cdp 9333 get title
agent-browser --cdp 9333 snapshot --compact
agent-browser --cdp 9333 press 'Control+Shift+P'
agent-browser --cdp 9333 keyboard type 'Projects: Fast Switch Project'
agent-browser --cdp 9333 screenshot /tmp/shuvscode-zellij-fast-switch.png
```

### Acceptance Criteria

- [x] Existing user-created Zellij sessions are never killed or reset.
- [x] If a configured session exists without shuvscode ownership metadata, shuvscode warns and offers non-destructive choices.
- [x] With Zellij enabled, activating Projects can create or reuse the managed session without opening surprise terminals.
- [x] The default hub tab is handled deliberately and does not break project-tab focusing.
- [x] Opening the managed terminal attaches to `zellij: shuvscode-managed` and reuses the same VS Code terminal on repeated commands.
- [x] Fast-switching to Project A creates/focuses a Zellij tab for Project A without calling `vscode.openFolder`.
- [x] Fast-switching to Project B focuses or creates Project B's tab in the same Zellij session and same VS Code terminal.
- [x] Returning to Project A reuses the existing Zellij tab.
- [x] The visible integrated terminal actually changes to the target project tab, verified by Zellij tab state and browser-driven UI smoke.
- [x] The Projects status bar indicates the active fast-switch project and distinguishes it from the actual VS Code workspace when they differ.
- [x] `windows.json` remains backward compatible and can represent actual workspace root plus active project root.
- [x] The explicit `Open Project Workspace` command still performs the full VS Code folder load for compatibility.
- [x] Existing generic multiplexer settings continue working when first-class Zellij mode is disabled.
- [x] Reattach after reload still works for the shared Zellij terminal and benefits from patches 28 and 29.

## Risks and Mitigations

### Zellij Focus From Outside the Session

Risk: Some Zellij actions may mutate session state but not focus the visible attached client as expected.

Mitigation: Phase 0 must prove the focus primitive with a visible attached client before implementation. Prefer `go-to-tab-name`, `go-to-tab-by-id`, or `go-to-tab` over `switch-session` if they behave better.

### Session Ownership

Risk: A user may already have a session with the configured name.

Mitigation: Use `shuvscode-managed` by default, record ownership metadata, and never perform destructive lifecycle actions against unowned sessions.

### Default Hub Tab

Risk: The default `Tab #1` shifts project tab positions and makes tab lookup brittle.

Mitigation: Reserve the hub/default tab explicitly and always refresh by name/id before focusing.

### GUI PATH

Risk: `execFile('zellij')` can fail when shuvscode is launched from a desktop entry with a narrower PATH.

Mitigation: Add `shuvscode.projects.zellij.executablePath`, diagnostics, and docs for setting `/usr/bin/zellij` or another explicit path.

### VS Code Extension Context

Risk: Fast switching without `vscode.openFolder` means language servers, SCM providers, Explorer state, and extension activation remain tied to the current VS Code workspace.

Mitigation: Make `workspace` vs `active` visible in the UI, keep explicit workspace-open commands, and avoid making fast switch the default click action in V1.

### Shell Injection Through Bootstrap Commands

Risk: A string bootstrap command requires shell execution.

Mitigation: Treat `bootstrapCommand` as trusted local configuration, keep the default empty, use `execFile` argument arrays for all non-bootstrap Zellij calls, and document the risk.

### Windows vs Tabs Terminology

Risk: Users confuse Zellij project tabs with shuvscode windows.

Mitigation: Use "Zellij tabs" for per-project terminal surfaces and reserve "Open Windows" for actual shuvscode windows tracked by `windows.json`.
