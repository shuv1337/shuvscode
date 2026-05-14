# HANDOFF

## Objective
Ship shuvscode Canvas UI — a "floating card" workbench aesthetic with deep navy canvas, rounded panels, amber accents, and custom chrome (titlebar label, activity bar avatar, amber SCM CTA).

## Current status
- **Phase A ✅ BUILT AND RUNNING** — 7 commits pushed to `shuvscode-main`:
  1. `feat(canvas): add workbench.canvas.enabled setting + body data-attr gate`
  2. `feat(canvas): rewrite shuvscode.css with Canvas palette + card treatment`
  3. `feat(canvas): tighten density (tab height, pane padding, breadcrumb height)`
  4. `feat(canvas): titlebar label + command center pill styling`
  5. `feat(canvas): activity bar avatar tile + styling`
  6. `feat(canvas): style scm commit button + dropdown split as amber CTA`
  7. `docs: update HANDOFF with Canvas UI Phase A status and roadmap`
- **Binary built and launched** — `1.120.03218` at `shuvscode-linux-x64/bin/shuvscode`
- Process running with smoke profile: `--user-data-dir /tmp/shuvscode-canvas-smoke --extensions-dir /tmp/shuvscode-canvas-ext`

## What's working
Per user review:
1. ✅ Deep navy canvas (`#0F1421`) showing between panels
2. ✅ Rounded corners and borders on panels
3. ❌ **Titlebar label "Workbench Canvas" NOT showing**
4. ✅ Circular avatar tile at top of activity bar
5. ✅ Amber accents visible

## What's NOT working / needs fixing
1. **Titlebar label missing** — patch `24-canvas-titlebar.patch` modifies `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts` (base class). On Linux desktop, the actual titlebar may use `src/vs/workbench/electron-sandbox/parts/titlebar/titlebarPart.ts` which could override `createContentArea` or not inherit the base method. Need to investigate which file actually constructs the Linux titlebar DOM and patch the right one.
2. **Auxiliary bar (right panel) open by default and empty** — looks weird. Need to either:
   - Add a default setting to keep it closed on first launch
   - Or add CSS to make an empty auxiliary bar look better (collapse it visually)

## Key files
- `patches/user/23-canvas-mode-setting.patch` — `workbench.canvas.enabled` gate
- `patches/user/24-canvas-titlebar.patch` — **titlebar label injection (needs fix for Linux)**
- `patches/user/25-canvas-activitybar-avatar.patch` — activity bar avatar tile
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` — all Canvas CSS
- `src/stable/extensions/shuvscode-defaults/package.json` — defaults including `window.commandCenter: true`

## Next steps
1. Fix titlebar label for Linux — find the correct `titlebarPart.ts` file used on Linux desktop and patch it.
2. Fix auxiliary bar being open by default — add `workbench.tree.indent` or similar setting, or CSS to hide empty auxiliary bar.
3. Rebuild (`prepare` + `build`) and relaunch to verify fixes.
4. Phase B — Hybrid Projects pane (pinned + recent workspaces).

## Resume prompt
The shuvscode Canvas UI binary is built and running. Two issues need fixing: (1) titlebar label "Workbench Canvas" not showing on Linux — investigate which titlebarPart file actually renders the Linux titlebar and patch it; (2) auxiliary bar is open by default and empty — add CSS or a default setting to keep it closed. After fixes, rebuild with `./scripts/prepare-shuvscode-tree.sh && ./scripts/build-shuvscode.sh` and relaunch.
