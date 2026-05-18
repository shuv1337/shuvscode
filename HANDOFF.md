# HANDOFF

## Objective
- Continue shuvscode’s next release train for the three open parent issues: #5 opinionated layout, #3 amber accent balance, and #4 gh-dash integration.
- Use the newly created child issues as independently grabbable AFK work slices.

## Current status
- Current local build is already present: `1.120.03315`, commit `8e1621a22fcc931a8a0bb2ac9f2d66e29c0167bd`, `x64`.
- Global binary link is current: `~/.local/bin/shuvscode -> /home/shuv/repos/shuvscode/shuvscode-linux-x64/bin/shuvscode`.
- Walker/GNOME launcher is current: `~/.local/share/applications/shuvscode.desktop` runs `/home/shuv/repos/shuvscode/shuvscode-linux-x64/bin/shuvscode %F`.
- `./scripts/install-dev-launchers.sh` was rerun successfully; no rebuild was needed because there were no tracked source changes.
- `PLAN-open-issues-end-to-end.md` is untracked and intentionally treated as planning context, not implementation drift.
- Child GitHub issues #7-#16 were created with labels `enhancement` and `help wanted`; parent issues #3, #4, and #5 were only referenced, not modified or closed.

## Key context
- Implementation order from the plan is #5 -> #3 -> #4, then release evidence/prep.
- Target release train is `v1.120.03316.shuv1`; do not tag, push AUR metadata, or close parent issues unless explicitly asked.
- Tracked overlays live under `src/stable/...`; generated `vscode/...` and `shuvscode-linux-x64/...` should be refreshed through `./scripts/prepare-shuvscode-tree.sh` and `./scripts/build-shuvscode.sh`.
- Long builds should use `setsid nohup ./scripts/build-shuvscode.sh > /tmp/<log>.log 2>&1 < /dev/null & disown` to survive the shell wrapper.
- Triage defaults used here: AFK-ready child issues are `enhancement` + `help wanted`; no HITL slices were created because product decisions are locked in the plan.

## Important files
- `PLAN-open-issues-end-to-end.md` - source plan and locked decisions for #3/#4/#5 breakdown.
- `scripts/build-shuvscode.sh` - builds and then refreshes local CLI/desktop launchers.
- `scripts/install-dev-launchers.sh` - idempotently points `~/.local/bin/shuvscode` and Walker desktop entry at the dev build.
- `packaging/dev-launcher/shuvscode.desktop` - template copied to the user-local desktop entry.
- `src/stable/extensions/shuvscode-bootstrap/` - planned owner for layout state/orchestrator work.
- `src/stable/extensions/shuvscode-projects/` - Projects view and future Explorer placement changes.
- `src/stable/extensions/shuvscode-gh/` - GitHub colocation and planned gh-dash integration.
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` and Night Owl theme JSON files - amber accent work.

## External references
- #7 Layout state model and commands: https://github.com/shuv1337/shuvscode/issues/7
- #8 Projects in Explorer: https://github.com/shuv1337/shuvscode/issues/8
- #9 SCM readiness + GitHub colocation: https://github.com/shuv1337/shuvscode/issues/9
- #10 Editor grid + terminal pane: https://github.com/shuv1337/shuvscode/issues/10
- #11 Fresh-profile/reset/unlock proof: https://github.com/shuv1337/shuvscode/issues/11
- #12 Amber tuning: https://github.com/shuv1337/shuvscode/issues/12
- #13 gh-dash detection/settings: https://github.com/shuv1337/shuvscode/issues/13
- #14 gh-dash terminal launch: https://github.com/shuv1337/shuvscode/issues/14
- #15 gh-dash onboarding/docs: https://github.com/shuv1337/shuvscode/issues/15
- #16 Build evidence/release prep: https://github.com/shuv1337/shuvscode/issues/16

## Next steps
1. Start with #7, then #8/#9/#10 can proceed in parallel once #7 lands.
2. Complete #11 as the layout proof/hardening gate before amber tuning #12.
3. Complete gh-dash slices #13 -> #14 -> #15 after #9, then #16 for cross-parent validation and evidence.

## Validation
- Ran `./shuvscode-linux-x64/bin/shuvscode --version` and `shuvscode --version`; both reported `1.120.03315` / `8e1621a22fcc931a8a0bb2ac9f2d66e29c0167bd` / `x64`.
- Confirmed `readlink -f ~/.local/bin/shuvscode` resolves to the repo dev build.
- Confirmed user-local desktop entry points at the repo dev build.
- Ran `./scripts/install-dev-launchers.sh`; it refreshed the symlink and desktop entry successfully.
- No tests or builds were run after issue creation because no source implementation changed.

## Risks / open questions
- Parent issue #5 is the riskiest area: Projects-in-Explorer ordering and terminal-in-editor grid behavior may require narrow core patches if public commands are nondeterministic.
- Fresh-profile detection must stay conservative to avoid clobbering existing users.
- `vscode.moveViews` remains acceptable for existing one-shot GitHub colocation, but should not become the source of default SCM placement.
- `gh-dash` config is user-owned; do not overwrite `.gh-dash.yml` or global config.

## Resume prompt
- Pick up at child issue #7 and implement the layout state/commands foundation from `PLAN-open-issues-end-to-end.md`. Keep changes in tracked overlays, validate with targeted `node --check`/`jq`, and only run the long build with `setsid nohup` when source-complete.
