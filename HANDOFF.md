# HANDOFF

## Objective

Keep shuvscode (branded Linux x64 VSCodium build) shipping. GitHub auth bugs
are resolved; next priorities are per-project Zellij tabs and Canvas Phase B.

## Current status

**Running binary:** `v1.120.03314` · commit `641eaa7`
**Branch:** `shuvscode-main` · latest tag `v1.120.03263.shuv1` (39 unreleased commits)
**Unmerged branches:** `pr-2-review`

Done in the last 2 weeks:

- Upstream rebase to VS Code 1.120.0 + Node 22.22.3 (`d163301`).
- **Canvas UI Phase A** — palette, density, titlebar pill, activity-bar avatar,
  SCM amber CTA, `--canvas-pane` token. Gated by `workbench.canvas.enabled`.
- **Native Projects** extension (`src/stable/extensions/shuvscode-projects/`):
  view, favorites, cross-window `windows.json` registry, status bar indicator.
- **Managed Zellij switching** — first commit (`65059ae`). Owns one
  `shuvscode-managed` session, one tab per project. **Do not touch user-created
  sessions** (owner-marker contract).
- **PR extension bundled** (`assets/extensions/GitHub.vscode-pull-request-github-0.144.0.vsix`).
- **`shuvscode-gh`** extension + patch 32 introducing `GhCliFlow` at the head of
  `github-authentication`'s flow list. Strict `findMissingScopes`.
- **Patch 33 (`641eaa7`)** — restores `workbench.getCodeExchangeProxyEndpoints`,
  unbreaking the entire GitHub login flow. See "Resolved bugs" below.
- Reverted: dense panel-split patches 30/31, Ember UI identity.

Not done: per-project Zellij tabs beyond the managed session; Canvas Phase B+;
a `v1.120.03314.shuv1` AUR cut.

## Resolved bugs (this session)

1. **`viewsWelcome` body blank for `github:login`** — by design now. shuvscode
   strips VS Code's welcome-content rendering as part of the patch-15/16/22 set;
   the shuvscode-gh extension intentionally registers a real TreeDataProvider
   instead. Three login rows ("Use gh CLI account", "Refresh gh CLI detection",
   "Open GitHub profile") render correctly. See `extension.js` lines 11-15 for
   the comment documenting the choice. **No further work needed.**

2. **`GhCliFlow` falls through silently** — fixed by patch 33. Root cause was
   *not* in `GhCliFlow` itself; `GhCliFlow.trigger()` was never reached because
   patch 15 (`strip-accounts-sync-telemetry`) dropped the import that registers
   `workbench.getCodeExchangeProxyEndpoints`. The bundled `github-authentication`
   extension's `GitHubServer.login()` awaits `this.getRedirectEndpoint()` inside
   the `redirectUri` argument it passes to every IFlow.trigger() call. With the
   command missing, every flow died at the same await and upstream's standard
   "try a different way? (device code)" toast surfaced. Patch 33 registers just
   the command (returning `undefined`, matching upstream's default for users
   without `options.codeExchangeProxyEndpoints`) without bringing back the
   account-management UI patch 15 deliberately removed.

   **Verified:** clicking "Use gh CLI account" completes auth, the
   `github-pull-requests` viewlet renders Pull Requests / Issues /
   Notifications panes with real upstream data.

## Key context

- **Three-layer stack:** vendored `vscode/` ← `src/stable/` overlay ← numbered
  patches. Edits inside `vscode/` after build are wiped by the next
  `prepare-shuvscode-tree.sh`.
- **Patch numbering gaps are intentional:** 19, 30, 31 are reverts. Next slot is 34.
- **Build script gets killed by interactive shells.** `nohup ... & disown`
  alone is not enough under opencode's bash tool — descendants get SIGHUP/SIGTERM
  when the tool wrapper exits. Use:
  `setsid nohup ./scripts/build-shuvscode.sh > /tmp/build.log 2>&1 < /dev/null & disown`
  (~5–8 min wall-clock). The build will quietly exit mid-`valid-layers-check`
  if you forget `setsid` or `</dev/null`.
- **CDP smoke trap:** always pass `--cdp 9333` to *every* `agent-browser` command
  and `tab t1` (not `tab 0`) the shuvscode workbench. `agent-browser connect 9333`
  steals the target with a fresh Chrome window.
- **`agent-browser press`** sends real keystrokes that reach Electron menus.
  `eval`-dispatched KeyboardEvents do not. Use `press "Control+Shift+p"` for
  the command palette, then `keyboard type "..."` then `press Enter`.
- **Branding is lowercase `shuvscode`.** Never `shuvcode` (different fork).
- Patches that don't compose are removed, not nursed (see Ember + 30/31 reverts).
- AI assistant integration is deferred until Canvas Phase B chrome stabilizes.

## Important files

- `src/stable/extensions/shuvscode-gh/extension.js` (245 LoC) — gh probe, ctx keys,
  TreeDataProvider for `github:login` (replaces upstream `viewsWelcome`)
- `patches/user/32-github-auth-gh-cli.patch` — `GhCliFlow` + `findMissingScopes`
- `patches/user/33-restore-code-exchange-proxy-command.patch` — restores the
  command stripped by patch 15; without this, *no* GitHub flow works
- `vscode/src/vs/workbench/contrib/authentication/browser/shuvscode-auth-commands.contribution.ts`
  (created by patch 33, 26 LoC)
- `src/stable/extensions/shuvscode-projects/extension.js` (1,252 LoC) — monolith;
  splitting `WindowRegistry` + `ProjectStore` out is the obvious next refactor
- `src/stable/extensions/shuvscode-projects/zellij.js` (353 LoC) + `.test.js` (69)
- `PLAN-zellij-first-class-project-integration.md` (582 lines) — full spec
- `PLAN-canvas-ui.md` (190 lines) — Phase A done, B+ pending
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` (436 LoC)
- `shuvscode.product.json` — built-in extension list, defaults
- `packaging/aur/shuvscode-bin/PKGBUILD` — currently at `pkgver=1.120.0.shuv2`
- Recap (visual): https://files.shuv.me/shuvscode-recap-2026-05-17.html

## Next steps

1. **Cut `v1.120.03314.shuv1`** — `gh release create v1.120.03314.shuv1 \
   shuvscode-linux-x64.tar.gz shuvscode-linux-x64.tar.gz.sha256`.
   Need to tar up the binary first (no release script exists yet; consider
   writing one).
2. **Bump AUR PKGBUILD** in `packaging/aur/shuvscode-bin/PKGBUILD`. Note the
   source URL currently references `shuvscode-1.120.0-linux-x64.tar.gz` but
   releases use the unversioned `shuvscode-linux-x64.tar.gz` filename — fix
   the URL while bumping.
3. Continue Zellij per the plan: per-project tab create + focus behind
   `shuvscode.projects.zellij.enabled`; expand `zellij.test.js` to cover
   owner-marker, stale-heartbeat, and foreign-session contracts.
4. Refactor `shuvscode-projects/extension.js`: split `WindowRegistry` and
   `ProjectStore` out before Zellij phase 2 lands.
5. Canvas Phase B per `PLAN-canvas-ui.md`.

## Validation (regression smoke)

Repro kick-off:

```bash
pgrep -f shuvscode-linux-x64/shuvscode | xargs -r kill -9 2>/dev/null
rm -rf /tmp/shuvscode-gh-cdp
mkdir -p /tmp/shuvscode-gh-cdp/workspace
git -C /tmp/shuvscode-gh-cdp/workspace init -q -b master
printf "smoke\n" > /tmp/shuvscode-gh-cdp/workspace/README.md
git -C /tmp/shuvscode-gh-cdp/workspace add README.md
git -C /tmp/shuvscode-gh-cdp/workspace -c user.email=smoke@local -c user.name=smoke \
  commit -q -m init
git -C /tmp/shuvscode-gh-cdp/workspace remote add origin \
  git@github.com:shuv1337/shuvscode.git

setsid nohup /home/shuv/repos/shuvscode/shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox --disable-gpu --new-window \
  --remote-debugging-port=9333 \
  --user-data-dir /tmp/shuvscode-gh-cdp/userdata \
  --extensions-dir /tmp/shuvscode-gh-cdp/exts \
  /tmp/shuvscode-gh-cdp/workspace > /tmp/shuvscode-cdp.log 2>&1 < /dev/null & disown

sleep 7 && curl -sf http://localhost:9333/json/version >/dev/null && echo "CDP up"
agent-browser --cdp 9333 tab t1
agent-browser --cdp 9333 eval 'document.title'   # → "* - shuvscode"

# Drive sign-in
agent-browser --cdp 9333 eval "(()=>{const a=Array.from(document.querySelectorAll('.activitybar .action-item a')).find(x=>(x.getAttribute('aria-label')||x.title)==='GitHub');a?.click();return 'clicked';})()"
sleep 2
agent-browser --cdp 9333 eval "(()=>{const rows=Array.from(document.querySelectorAll('.monaco-list-row'));const t=rows.find(r=>r.textContent.includes('Use gh CLI account'));t?.click();return t?'clicked':'no row';})()"
sleep 6

# Re-open the viewlet and confirm 3 panes
agent-browser --cdp 9333 eval "(()=>{const a=Array.from(document.querySelectorAll('.activitybar .action-item a')).find(x=>(x.getAttribute('aria-label')||x.title)==='GitHub');a?.click();})()"
sleep 1
agent-browser --cdp 9333 eval "(()=>{const v=document.querySelector('.composite.viewlet[id*=\"github-pull-requests\"]');return v?Array.from(v.querySelectorAll('.pane')).map(p=>p.querySelector('.title')?.textContent?.trim()):'no viewlet';})()"
# Expected: ["Pull Requests","Issues","Notifications"]
```

To re-derive patch 32 or 33 after editing `vscode/`:

```bash
cd /home/shuv/repos/shuvscode/vscode
# For patch 33 (single file changes):
git diff --no-color -- src/vs/workbench/workbench.common.main.ts > /tmp/wcm.diff
# Hand-merge with the new shuvscode-auth-commands.contribution.ts shim addition.
# (Capturing as raw `git diff` from working tree is unreliable because the
# tree has all earlier patches applied — diff will include them.)
```

## Risks / open questions

- 1,252-LoC `shuvscode-projects/extension.js` will keep growing as Zellij
  phases land. Refactor before phase 2 if at all possible.
- Patch 32 has no in-tree comment documenting `findMissingScopes` semantics or
  the 30s `isGhCliAvailable()` cache TTL — three commits of context only.
- Patch 33's shim file lives in `vscode/src/vs/workbench/contrib/authentication/browser/`
  rather than `src/stable/`. If the upstream rebase touches that dir, expect
  conflicts. Consider relocating to `src/stable/src/vs/workbench/contrib/...`
  next time patches are reshuffled.
- AUR PKGBUILD source URL is stale (`shuvscode-1.120.0-linux-x64.tar.gz` vs
  actual asset name `shuvscode-linux-x64.tar.gz`). Fix during the next bump.

## Resume prompt

> Pick up shuvscode at commit `641eaa7`. GitHub auth bugs resolved (patch 33
> restored `workbench.getCodeExchangeProxyEndpoints`); PRs and Issues render
> correctly. Next: cut `v1.120.03314.shuv1` (tar, gh release, sha256), bump
> AUR PKGBUILD (note the stale source URL), then start per-project Zellij
> tabs per `PLAN-zellij-first-class-project-integration.md`. See the visual
> recap at https://files.shuv.me/shuvscode-recap-2026-05-17.html for the
> two-week context.
