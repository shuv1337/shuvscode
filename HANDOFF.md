# HANDOFF

## Objective

- Continue shuvscode's open-issues release train for:
  - #5 opinionated layout
  - #3 amber accent balance
  - #4 gh-dash integration
- Child implementation issues #7-#16 have been worked through from live repo/GitHub state.
- Do not tag a release, update AUR metadata, or close parent issues unless the maintainer explicitly asks for those release actions.

## Current status

- Branch: `shuvscode-main`
- Remote: pushed through `62267bf feat(shuvscode-theme): tune amber selection language`
- Current built app:
  - `./shuvscode-linux-x64/bin/shuvscode --version`
  - `1.120.03329`
  - `668afbf0987de9c4267441babd0c4440948424ec`
  - `x64`
- Dev launchers were refreshed by the build:
  - `~/.local/bin/shuvscode -> /home/shuv/repos/shuvscode/shuvscode-linux-x64/bin/shuvscode`
  - `~/.local/share/applications/shuvscode.desktop` points at the repo dev build.
- Release-only actions were intentionally left untouched:
  - no tag created
  - no AUR metadata updated
  - parent issues #3, #4, #5, and #6 left open

## Completed child issues

- #7 Layout state model and commands: `50ab453`
- #8 Projects in Explorer: `ca098f5`
- #9 SCM readiness + GitHub colocation: `943e5b7`
- #10 Editor grid + terminal-in-editor function pane:
  - `f9ae06e`
  - `f6e1946`
  - `9623a94`
- #11 Fresh-profile/reset/unlock proof:
  - `c706ff2`
- #12 Amber tuning:
  - `62267bf`
- #13 gh-dash detection/settings:
  - `ceb35fa`
- #14 gh-dash terminal launch/reuse:
  - `72be50f`
- #15 gh-dash onboarding/docs:
  - `69a4431`
- #16 release evidence:
  - this handoff is the release-train recap artifact

## Validation

Source gates run after the final #12/#16 state:

- `node --check src/stable/extensions/shuvscode-bootstrap/extension.js`
- `node --check src/stable/extensions/shuvscode-bootstrap/layoutState.js`
- `node --test src/stable/extensions/shuvscode-bootstrap/layoutState.test.js` - 7 passing
- `node --check src/stable/extensions/shuvscode-gh/extension.js`
- `jq . src/stable/extensions/shuvscode-gh/package.json >/dev/null`
- `node --check src/stable/extensions/shuvscode-projects/extension.js`
- `node --check src/stable/extensions/shuvscode-projects/zellij.js`
- `node --test src/stable/extensions/shuvscode-projects/zellij.test.js` - 7 passing
- `jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null`
- `jq . src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme.json >/dev/null`
- `jq . src/stable/extensions/shuvscode-night-owl/themes/night-owl-color-theme-noitalic.json >/dev/null`
- `jq . src/stable/extensions/shuvscode-defaults/package.json >/dev/null`
- `jq . shuvscode.product.json >/dev/null`
- `jq . product.json >/dev/null`
- `git diff --check`
- `./scripts/build-shuvscode.sh` passed; latest log: `/tmp/shuvscode-issue12-build.log`

## Built-app evidence

All Electron smokes used the built shuvscode app directly with `agent-browser --session ... --cdp <port>`.
No Chrome plugin, in-app Browser plugin, `agent-browser connect`, or separate Chrome profile was used.

- Non-git fresh layout:
  - `/tmp/shuvscode-issue11-nongit-fresh.png`
  - showed Projects in Explorer, Source Control/GitHub sections on the right, and the terminal-in-editor grid.
- Git fresh layout:
  - `/tmp/shuvscode-issue11-git-fresh.png`
  - after trusting the temp repo, showed right-side SCM Changes/Graph with modified `README.md`.
- Reset after drift:
  - `/tmp/shuvscode-issue11-reset-after-drift.png`
  - state returned to `appliedVersion=2`, `lastApplyStatus=ok`, `unlocked=false`.
- Unlock after restart:
  - `/tmp/shuvscode-issue11-unlocked-restart.png`
  - drifted single-column terminal layout stayed single-column after restart with `unlocked=true`.
- Existing-profile skip:
  - `/tmp/shuvscode-issue11-existing-skip.png`
  - legacy sentinel profile recorded `skipped:existing-profile` without writing layout markers.
- Failure path:
  - `/tmp/shuvscode-issue11-failure-path.png`
  - invalid `appliedVersion` showed the expected failure notification and recovered through reset.
- Amber baseline:
  - `/tmp/shuvscode-issue11-git-fresh.png`
- Amber post-tune:
  - `/tmp/shuvscode-issue12-post-main.png`
  - `/tmp/shuvscode-issue12-post-quick-input.png`
  - computed styles confirmed amber row gradients, amber inset, amber panel active indicator, and amber quick-input focus.
- gh-dash launch/reuse:
  - `/tmp/shuvscode-issue14-ghdash-launch.png`
  - command palette launch opened a `gh-dash` terminal editor.
  - re-running the command prompted reuse/restart with the resolved descriptor `'/usr/bin/gh' 'dash'`.
- gh-dash command surface:
  - `/tmp/shuvscode-issue15-command-palette-ghdash.png`
  - showed `shuvscode: Open gh-dash Pull Requests`, `Open gh-dash`, and `Open gh-dash Issues` in the command palette.

## Notes for next agent

- Open GitHub issues now should only be parent/meta issues #3, #4, #5, #6, unless new work was added after this handoff.
- Parent issues were intentionally not closed because #16 explicitly forbids closing parent issues without maintainer approval.
- If the maintainer asks for release actions, start by refreshing `gh issue list`, `git status`, `git log --oneline -12`, and `./shuvscode-linux-x64/bin/shuvscode --version`.
- Keep using direct Electron CDP targeting with `agent-browser --session <fresh-name> --cdp <port> ...`.
- Old issue comments mention earlier tty/CDP blockers; those are stale. Live desktop CDP validation succeeded in this pass.
