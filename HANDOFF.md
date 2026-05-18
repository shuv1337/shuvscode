# HANDOFF

## Objective

Keep shuvscode (branded Linux x64 VSCodium build) shipping. Two open bugs in the
GitHub auth path are the immediate blocker; Zellij project-tab work and Canvas
Phase B are the next features after that.

## Current status

**Running binary:** `v1.120.03303` · commit `876626a`
**Branch:** `shuvscode-main` · latest tag `v1.120.03263.shuv1` (37 unreleased commits)
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
- Reverted: dense panel-split patches 30/31, Ember UI identity.

Not done: the two bugs below; per-project Zellij tabs beyond the managed session;
Canvas Phase B+; a `v1.120.03303.shuv1` AUR cut.

## Broken (priority order)

1. **`viewsWelcome` body blank for `github:login`** — even an unconditional
   fallback entry doesn't render. `892d17b` sidestepped by using ordinary view
   contents, but the underlying cause is unexplained. Suspect patch 16
   (`strip-heavy-optional-workbench`) or 22 (`strip-outline-pane`) accidentally
   removed the render path.
2. **`GhCliFlow` falls through silently** — no scope-warning toast; user lands
   on upstream device-code fallback. Theories: notification position,
   `getGhCliToken` parse failure, `$PATH` in the renderer. None instrumented.

Both reproduce on `v1.120.03291` / commit `824bf92` per the kick-off script
under "Validation" below.

## Key context

- **Three-layer stack:** vendored `vscode/` ← `src/stable/` overlay ← numbered
  patches. Edits inside `vscode/` after build are wiped by the next
  `prepare-shuvscode-tree.sh`.
- **Patch numbering gaps are intentional:** 19, 30, 31 are reverts. Next slot is 33.
- **Build script gets SIGHUP under `interactive_shell`.** Use
  `nohup ./scripts/build-shuvscode.sh > /tmp/build.log 2>&1 & disown` (~5–7 min).
- **CDP smoke trap:** always pass `--cdp 9333` to *every* `agent-browser` command
  and `tab 0` the shuvscode workbench. `agent-browser connect 9333` steals the
  target with a fresh Chrome window.
- **Branding is lowercase `shuvscode`.** Never `shuvcode` (different fork).
- Patches that don't compose are removed, not nursed (see Ember + 30/31 reverts).
- AI assistant integration is deferred until Canvas Phase B chrome stabilizes.

## Important files

- `src/stable/extensions/shuvscode-gh/extension.js` (245 LoC) — gh probe, ctx keys
- `patches/user/32-github-auth-gh-cli.patch` — `GhCliFlow` + `findMissingScopes`
- `src/stable/extensions/shuvscode-projects/extension.js` (1,252 LoC) — monolith;
  splitting `WindowRegistry` + `ProjectStore` out is the obvious next refactor
- `src/stable/extensions/shuvscode-projects/zellij.js` (353 LoC) + `.test.js` (69)
- `PLAN-zellij-first-class-project-integration.md` (582 lines) — full spec
- `PLAN-canvas-ui.md` (190 lines) — Phase A done, B+ pending
- `src/stable/src/vs/code/electron-browser/workbench/shuvscode.css` (436 LoC)
- `shuvscode.product.json` — built-in extension list, defaults
- Recap (visual): https://files.shuv.me/shuvscode-recap-2026-05-17.html

## Next steps

1. **Bug 1 — `viewsWelcome` rendering.** Snapshot the DOM around `github:login`
   via `agent-browser --cdp 9333 eval` to see whether VS Code even emits
   welcome-content nodes. If not, audit patches 16 and 22.
2. **Bug 2 — `GhCliFlow` silent fall-through.** Sprinkle
   `console.error('[GhCli][step-N]', …)` through `flows.ts` and
   `node/ghCli.ts`, rebuild, recapture patch 32 via `git diff`, then read
   `Log (Extension Host)` to find the short-circuit.
3. **Confirm `gh` on `$PATH` in the extension host.** Open the integrated
   terminal and run `which gh && gh auth token | head -c 20`.
4. After bugs resolve: cut `v1.120.03303.shuv1` and bump the AUR PKGBUILD.
5. Continue Zellij per the plan: per-project tab create + focus behind
   `shuvscode.projects.zellij.enabled`; expand `zellij.test.js` to cover
   owner-marker, stale-heartbeat, and foreign-session contracts.

## Validation

Repro kick-off (from the previous session, verified):

```bash
pkill -9 -f shuvscode-linux-x64/shuvscode 2>/dev/null; sleep 1
mkdir -p /tmp/shuvscode-gh-cdp/workspace
(cd /tmp/shuvscode-gh-cdp/workspace && git init -q && echo smoke > README.md \
  && git remote add origin git@github.com:shuv1337/shuvscode.git)

nohup /home/shuv/repos/shuvscode/shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox --disable-gpu --new-window \
  --remote-debugging-port=9333 \
  --user-data-dir /tmp/shuvscode-gh-cdp/userdata \
  --extensions-dir /tmp/shuvscode-gh-cdp/exts \
  /tmp/shuvscode-gh-cdp/workspace > /tmp/shuvscode-cdp.log 2>&1 & disown

sleep 6 && curl -sf http://localhost:9333/json/version >/dev/null && echo "CDP up"
agent-browser --cdp 9333 tab 0
agent-browser --cdp 9333 eval 'document.title'   # → "* - shuvscode"
```

To re-derive patch 32 after editing `vscode/extensions/github-authentication/src/`:

```bash
cd /home/shuv/repos/shuvscode/vscode
git add -N extensions/github-authentication/src/node/ghCli.ts \
           extensions/github-authentication/src/browser/ghCli.ts
git diff --no-color -- \
  extensions/github-authentication/src/flows.ts \
  extensions/github-authentication/src/githubServer.ts \
  extensions/github-authentication/src/test/flows.test.ts \
  extensions/github-authentication/src/node/ghCli.ts \
  extensions/github-authentication/src/browser/ghCli.ts \
  > ../patches/user/32-github-auth-gh-cli.patch
```

## Risks / open questions

- The user's `gh` token is missing `read:user` and `user:email` scopes (it has
  `delete_repo, gist, read:org, read:project, repo, workflow`). The scope check
  *should* trigger; if it doesn't even fire, instrumentation is the only path.
- 1,252-LoC `shuvscode-projects/extension.js` will keep growing as Zellij
  phases land. Refactor before phase 2 if at all possible.
- Patch 32 has no in-tree comment documenting `findMissingScopes` semantics or
  the 30s `isGhCliAvailable()` cache TTL — three commits of context only.

## Resume prompt

> Pick up shuvscode at commit `892d17b`. Two open bugs in the GitHub auth path
> (viewsWelcome blank + GhCliFlow silent). Start with bug 1 — DOM-snapshot the
> `github:login` view via the CDP repro script in this file. See the visual
> recap at https://files.shuv.me/shuvscode-recap-2026-05-17.html for the
> two-week context.
