# HANDOFF

## Objective
- Continue polishing the shuvscode Canvas UI and add a native Project Manager-style workflow.
- Latest completed fixes: move Source Control into the secondary sidebar by default, fix the clipped bottom status bar, strengthen amber active-state accents, and add native Projects at the top of the primary activity bar.

## Current status
- Done: rebuilt `shuvscode-linux-x64/bin/shuvscode` after the native Projects and activity-bar order changes.
- Version smoke passes: `1.120.03242`, commit `a6a603d13827683767ea05de79c10e06311c8351`, `x64`.
- App launched with a fresh smoke profile:
  `--user-data-dir /tmp/shuvscode-projects-top-user-data --extensions-dir /tmp/shuvscode-projects-top-extensions --new-window --disable-gpu`
- Fresh-profile storage confirms:
  - `workbench.view.extension.shuvscode-projects` is first in `workbench.activity.pinnedViewlets2` with `order: -10`.
  - Explorer remains next with `order: 0`.
  - `shuvscodeProjects.projects` is visible in the Projects container.
  - `workbench.view.scm` is pinned in `workbench.auxiliarybar.pinnedPanels`.
  - `workbench.auxiliaryBar.empty` is `false`.

## Key changes
- `src/stable/extensions/shuvscode-projects/`
  - Adds a native built-in Projects extension with a primary activity-bar container and tree view.
  - Provides commands to save the current project, edit `projects.json`, list/open projects, open in a new window, refresh, remove saved favorites, and reveal the projects file.
  - Stores saved projects in extension global storage as `projects.json`.
  - Auto-detects Git repositories from configurable base folders and ignores common heavy folders.
  - Shows the current project in the status bar without doing a full discovery scan at startup.
- `patches/user/27-shuvscode-projects-top-activitybar.patch`
  - Assigns the native Projects container activity-bar order `-10` so it appears above Explorer by default.
- `patches/user/26-canvas-scm-secondary-sidebar.patch`
  - Registers the SCM view container in `ViewContainerLocation.AuxiliaryBar`.
- `src/stable/extensions/shuvscode-defaults/package.json`
  - Adds `"workbench.secondarySideBar.defaultVisibility": "visible"`.
- `src/stable/extensions/shuvscode-bootstrap/extension.js`
  - Opens `workbench.view.scm` once on startup via `shuvscode.canvas.scmAuxiliaryOpened`.
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css`
  - Fixes the status bar clipping and uses stronger amber active states for primary activity bar icons.

## Validation
- `node --check src/stable/extensions/shuvscode-projects/extension.js` passed.
- `jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null` passed.
- `./scripts/prepare-shuvscode-tree.sh && ./scripts/build-shuvscode.sh` completed successfully.
- `./shuvscode-linux-x64/bin/shuvscode --version` returned `1.120.03242`.
- Built artifacts contain `shuvscode-linux-x64/resources/app/extensions/shuvscode-projects/`.
- Fresh-profile launch is running as PID `1035280`.
- Fresh-profile storage confirms Projects is pinned first in the primary activity bar.

## Important context
- Do not use `shuvcode`; this project is `shuvscode`.
- Existing unrelated untracked file before this work: `PLAN-canvas-ui.md`.
- Older known issue still not addressed in this pass: titlebar label `"Workbench Canvas"` may still be missing on Linux.
- The new native Projects feature intentionally clones the Project Manager behavior surface without copying its GPL-3.0 implementation.

## Next steps
1. Visually inspect the running fresh-profile window for Projects at the top of the primary activity bar.
2. Exercise the Projects commands from the command palette and sidebar title actions.
3. Decide whether to add tag filtering UI and richer duplicate-name handling in a follow-up.
4. Address the separate titlebar label issue if it remains a priority.
