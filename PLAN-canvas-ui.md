# PLAN-canvas-ui.md

shuvscode "Canvas" UI implementation plan.

Target: shuvscode 1.120.0, branch `shuvscode-main`.

Mockup source: `/tmp/pi-clipboard-880b381c-8a33-46f5-99f7-f56d4f7f18d1.png` (workbench rendered as floating rounded cards on a deep navy canvas, amber accents, Phosphor product icons, custom titlebar with command pill + Share button).

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Ambition level | **Reskin + custom chrome** (CSS + titlebar/activitybar/SCM patches). No GridView rewrite. |
| 2 | Theme default | **Default-on with Classic escape hatch** via `workbench.canvas.enabled` setting. |
| 3 | Projects pane | **Hybrid** — pinned section on top + recent workspaces below. |
| 4 | AI Assistant | **Needs more discussion** — not in scope for Phase A/B. |
| 5 | Floating canvas | **Research spike** behind `workbench.canvas.floating` flag, one view only (Outline). Phase D. |
| 6 | Phase A scope | card-css, palette, density, titlebar-label, activitybar-avatar, scm-cta. (Share button deferred.) |

## Visual contract (the look we're hitting)

| Token | Value | Notes |
|---|---|---|
| `--canvas-bg` | `#0F1421` | Deep navy backdrop between cards |
| `--canvas-surface` | `#1A2032` | Card body |
| `--canvas-surface-elevated` | `#202740` | Hovered/active card |
| `--canvas-border` | `rgba(255,255,255,0.06)` | Card outline |
| `--canvas-border-strong` | `rgba(255,255,255,0.12)` | Tab/divider |
| `--canvas-accent` | `#F3B042` | Amber — Commit CTA, run button, Share |
| `--canvas-accent-fg` | `#1A1410` | Text on amber |
| `--canvas-accent-soft` | `rgba(243,176,66,0.14)` | Hover wash |
| `--canvas-text` | `#E6EAF2` | Primary text |
| `--canvas-text-dim` | `#8B95A9` | Secondary/muted |
| `--canvas-radius` | `10px` | Card corner |
| `--canvas-gap` | `8px` | Sash/gutter between cards |

Replace existing red `--shuv-accent` palette in `shuvscode.css` entirely. The angled clip-paths on tabs/buttons go away (mockup is all soft-rounded).

## Phase A — Canvas reskin + chrome (this branch)

Goal: ship the ~80% visual hit with low patch risk. One PR, multiple atomic commits.

### A1 · Setting + activation gate

- **New product setting** `workbench.canvas.enabled` (default `true`).
- Implementation: in `src/stable/extensions/shuvscode-defaults/package.json`, register a configuration default. Add a workbench contribution that toggles a `data-canvas="on"` attribute on `body`.
- All Canvas CSS keys off `body[data-canvas="on"]` — flipping the setting reverts to stock chrome instantly without a reload (or with a one-time reload prompt; decide during implementation).
- Files: new patch `patches/user/23-canvas-mode-setting.patch` + tweak `shuvscode-defaults`.

### A2 · Palette + card CSS treatment (`shuvscode.css` rewrite)

- Replace contents of `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` with Canvas tokens above.
- Apply rounded card treatment to all `.part` elements (sidebar, panel, auxiliarybar, editor groups):
  - `border-radius: var(--canvas-radius)`
  - `background: var(--canvas-surface)`
  - `border: 1px solid var(--canvas-border)`
  - `margin: var(--canvas-gap)` to fake gutters between panes
  - Outer workbench gets `background: var(--canvas-bg)` so gutters show through.
- Remove `clip-path` polygons on tabs/buttons.
- Activity bar: transparent background (lives directly on canvas), no card.
- Status bar: edge-to-edge at bottom, slight elevation shadow.
- Scrollbar tuning, hover wash, focus rings — all Canvas-tinted.

### A3 · Phosphor product-icon tuning

- Already shipping `shuvscode-phosphor-product-icons`. Bump weight/size to match mockup (icons read heavier in mockup than current).
- Tune via `producticons/shuvscode-phosphor-product-icon-theme.json` if needed.

### A4 · Density preset

- Tighter list-row line-heights, larger pane padding (`12px` instead of stock `4px`), tab height `34px`.
- All scoped under `body[data-canvas="on"]` so Classic mode is unaffected.

### A5 · Titlebar: label + centered command pill

- Patch `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts` (and/or its windows/linux subclass).
- Add a left-side label slot rendering `workbench.canvas.titlebarLabel` (default `"Workbench Canvas"`).
- The "Go to Anything" command center already exists as a contribution — restyle via CSS to look like the mockup's pill, ensure it's centered.
- New patch: `patches/user/24-canvas-titlebar.patch`.

### A6 · Activity bar: avatar on top, profile/settings pinned bottom

- Activity bar already separates `accounts-container` and `global-activity` from the main view list. Visually we need:
  - A user-avatar tile at the very top (above the view actions). Source: `IAuthenticationService` if any provider connected, else default Phosphor avatar.
  - Push settings + accounts to bottom (already there structurally — just restyle).
  - Restyling-only is achievable in CSS; the avatar tile likely needs a small patch.
- New patch: `patches/user/25-canvas-activitybar.patch` (small DOM injection) + CSS.

### A7 · Git Changes: amber Commit CTA + action row

- SCM viewlet primary button restyle:
  - Full-width amber button, `min-height: 36px`, weight 600, no clip-path.
  - Drop-down split caret on the right (matches mockup).
- Below it, ensure the existing action row (refresh/stage all/unstage all/discard) is styled as iconified pill buttons in a horizontal strip.
- CSS-only — no patch needed beyond what's already there. Selectors target `.scm-view .monaco-button-dropdown`.

### Phase A — commit plan

1. `feat(canvas): add workbench.canvas.enabled setting + body data-attr gate`
2. `feat(canvas): rewrite shuvscode.css with Canvas palette + card treatment`
3. `feat(canvas): tighten density (line-heights, pane padding, tab height)`
4. `feat(canvas): style scm commit button + action row as Canvas amber CTA`
5. `feat(canvas): titlebar label + centered command pill restyle`
6. `feat(canvas): activity bar avatar tile + bottom-pinned profile`
7. `chore(canvas): tune Phosphor product icon weight/size`
8. `docs: add Canvas screenshots + PLAN status to HANDOFF.md`

Risk: each commit is independently revertable. CSS commits never break the build.

## Phase B — Projects pane (hybrid)

Goal: replace the top of the Explorer sidebar with a curated "Projects" card showing **pinned** projects on top and **recent workspaces** below.

### B1 · Storage + service

- New stored state `shuvscode.pinnedProjects` via `IStorageService` (APPLICATION scope).
- Schema: `{ id, name, uri, iconColor, iconSymbol, pinnedAt }[]`.

### B2 · View container

- Register a new ViewContainer `workbench.view.canvas.projects` placed above the standard Explorer view in the SideBar (or replace Explorer's "Open Editors" slot).
- Two tree views inside:
  - `pinnedProjects` — drag to reorder, right-click to unpin / change icon color.
  - `recentWorkspaces` — sourced from `IWorkspacesService.getRecentlyOpened()`, with a right-click "Pin" action that promotes into the pinned list.
- `+ Add Project` button at the bottom triggers the standard "Open Folder" picker, auto-pins on success.

### B3 · Tile rendering

- Custom renderer drawing each row as a tile with:
  - Colored square icon (background = `iconColor`, Phosphor glyph centered).
  - Project name (semibold) + path (mono, dimmed) below.
- Active project gets the amber left-stripe (per mockup).

### Phase B — commit plan

1. `feat(projects): pinned projects storage service`
2. `feat(projects): canvas projects view container + tree views`
3. `feat(projects): tile renderer with Phosphor icons + amber active stripe`
4. `feat(projects): pin/unpin actions + context menu`
5. `feat(projects): add-project button + auto-pin on open`

## Phase C — Floating-canvas spike (research, flag-gated)

Goal: prove we can make a single view (Outline) detach from GridView and float as a draggable/resizable card, before deciding whether to generalize.

- New setting `workbench.canvas.floating` (default `false`).
- When enabled, the Outline view is rendered into an overlay layer outside `WorkbenchLayoutService`, positioned absolute, draggable by its title, resizable from corners, position persisted to storage.
- Implementation sketch: a new contribution that observes `IViewsService.onDidChangeViewContainerLocation`, takes ownership of the Outline view when the flag is on, and re-mounts it into a sibling `<div>` of the workbench root.
- Outcome of the spike is a **go/no-go decision** on Phase D (generalize to all views) — do not generalize until we ship + live with the Outline-only version for a week.

## Out of scope (revisit later)

- **AI Assistant card** — needs separate decision (local LLM? OpenAI-compat? stub?). Hide the panel for now; reserve the mockup's real estate.
- **Share button** — deferred from Phase A. Stub later when we know what "share" means in shuvscode.
- **Replacing GridView wholesale** — explicitly off the table per Decision 1.

## Validation checklist (per phase)

For every PR:

1. `./scripts/build-shuvscode.sh` completes clean.
2. `./shuvscode-linux-x64/bin/shuvscode --version` → `1.120.0…`.
3. GUI smoke test with `--user-data-dir /tmp/shuvscode-canvas-smoke --extensions-dir /tmp/shuvscode-canvas-ext`:
   - Workbench renders with Canvas chrome.
   - Toggle `workbench.canvas.enabled` → reverts to Classic without rendering glitches.
   - All existing strip-* patches still apply (welcome suppressed, no Copilot etc.).
4. Patches reapply cleanly on top of next upstream bump (test by running `scripts/prepare-shuvscode-tree.sh` against the next stable tag in a worktree).

## File index (Phase A)

New / modified:

- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` — rewritten
- `src/stable/extensions/shuvscode-defaults/package.json` — add `workbench.canvas.*` config defaults
- `patches/user/23-canvas-mode-setting.patch` — `data-canvas` body attribute + setting
- `patches/user/24-canvas-titlebar.patch` — titlebar label + command pill markup
- `patches/user/25-canvas-activitybar.patch` — avatar tile injection
- `HANDOFF.md` — phase status

No changes to:

- `patches/brand.patch`, `patches/cli.patch`, `patches/disable-copilot.patch` (orthogonal)
- Existing strip-* user patches
- `prepare_vscode.sh`, build scripts, AUR PKGBUILD (until Phase A ships and we cut a release)

## Open questions to answer before Phase B starts

1. AI Assistant: stub vs local-only vs OpenAI-compat — needs to be locked.
2. Projects pane location: replace Explorer's `Open Editors` slot, or live as a new top-level view container in the activity bar?
3. Does the Classic toggle revert *instantly* (preferred) or require a reload? Test during A1.
