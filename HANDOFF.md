# HANDOFF

## Status as of 2026-05-17 03:50 PDT

**In flight, not resolved**: GitHub PR/Issues UX improvements (`shuvscode-gh`
extension + `github-authentication` patch). Two bugs remain, both reproducible
on `v1.120.03291` / commit `824bf92152f7964ac4bb460b992dba61024cc950`.

**Built binary**: `/home/shuv/repos/shuvscode/shuvscode-linux-x64/bin/shuvscode`
**Symlink**: `~/.local/bin/shuvscode` -> the binary
**Desktop entry**: `~/.local/share/applications/shuvscode.desktop`

## What works

- `shuvscode-gh` extension activates correctly. Output channel `shuvscode GitHub`
  shows the expected log lines:
  ```
  activating shuvscode-gh
  registered placeholder TreeDataProvider for github:login
  gh detected=true authenticated=true user=shuv1337
  ```
- `gh` CLI detection works (user is `shuv1337`).
- Activity bar shows the GitHub icon (rendered as `</>` because the
  `shuvscode-phosphor` product icon theme remaps `$(github)`).
- After registering a placeholder TreeDataProvider, the GITHUB: LOGIN view no
  longer shows VS Code's raw `"There is no data provider registered..."`
  fallback string.
- Patch 32 (`patches/user/32-github-auth-gh-cli.patch`) applies cleanly and the
  bundled `github-authentication/dist/extension.js` contains the new strings
  (`gh CLI`, `missing scope`, etc.).
- The `findMissingScopes` rewrite is correct and matches GitHub OAuth scope
  inclusion semantics (strict, not prefix-loose).

## What is still broken

### Bug 1: `viewsWelcome` content not rendering at all

After clicking the GitHub activity-bar icon in an isolated profile with a
workspace open:
- The GITHUB: LOGIN view header renders ("GITHUB: LOGIN")
- The body is **blank** -- no welcome content shows
- Even the fallback `viewsWelcome` entry with NO `when` clause does not render

We have 5 welcome entries in `src/stable/extensions/shuvscode-gh/package.json`
including one unconditional fallback (`{ "view": "github:login", "contents":
"Sign in to GitHub..." }` -- no when clause).

This is the second of two failure modes:
- Before commit `b4d61bb`: `"There is no data provider registered..."`
  (no TDP was registered for the view).
- After commit `b4d61bb`: blank panel (TDP registered, but our welcome
  contributions don't render).

**Open theories** (not yet validated):
1. Upstream `vscode-pull-request-github` later registers its own real TDP
   that returns NON-EMPTY children, which suppresses welcome content entirely.
2. Welcome contributions from a different extension than the view owner are
   filtered or de-prioritised by VS Code in some state.
3. Some patch we ship (e.g. patch 16 `strip-heavy-optional-workbench`,
   patch 22 `strip-outline-pane`, or another) strips the welcome view rendering
   path. Patch 16 removes `multiDiffEditor` which is unrelated, but worth
   ruling out for other strips.
4. Our `viewsWelcome` `when` clauses use context keys with dots
   (`shuvscode.gh.detected`). Although context key NAMES with dots are valid
   in upstream (`config.git.enabled`, `git.state == initialized`), the
   no-clause fallback should still render and doesn't -- so this is a weaker
   theory unless even no-clause entries are silently skipped.

### Bug 2: `GhCliFlow` falls through silently; user sees device-code prompt

When the user clicks "Sign in with GitHub" from the Accounts menu:
- Expected: GhCliFlow runs first, hits the missing-scope code path (user's
  `gh` token lacks `read:user` and `user:email`), shows a warning toast with
  `[Run gh auth refresh]` and `[Use Browser Instead]` buttons.
- Actual: no warning toast is seen. The user sees the upstream prompt
  *"You have not yet finished authorizing... try a different way? (device
  code)"* which means GhCli + LocalServer + UrlHandler all already ran and
  failed/cancelled.

**Open theories** (not yet validated):
1. `window.showWarningMessage(..., btn1, btn2)` may not be visible to the
   user (notifications collapsed to the bell icon? user setting hides them?
   `workbench.notifications.position` is `bottom-left` in our defaults).
2. `getGhCliToken` throws before reaching the scope check. Possible causes:
   - `gh auth status --show-token` parse fails (some `gh` versions emit a
     slightly different format), `tokenScopes` ends up `[]`, but we still
     reach the scope check.
   - `gh auth token` succeeds but `gh auth status` exits non-zero for a
     stylistic reason (e.g. SSH/HTTPS protocol nag) -- we'd parse stderr
     incorrectly.
3. The `await isGhCliAvailable()` cache in `getFlows` runs `gh --version`
   inside the renderer/extension-host process which might have a stripped
   `$PATH`. (Counter-evidence: our `shuvscode-gh` extension's `detectGh()`
   uses the same `execFile('gh', ...)` and succeeds. They run in the same
   extension host process, so PATH should be the same. Worth confirming.)

## How to reproduce

User `gh` state:
```
gh auth status --hostname github.com --show-token
github.com
  ✓ Logged in to github.com account shuv1337 (keyring)
  - Active account: true
  - Git operations protocol: ssh
  - Token: <REDACTED — revoke if seen; rotated via `gh auth refresh`>
  - Token scopes: 'delete_repo', 'gist', 'read:org', 'read:project', 'repo', 'workflow'
```

The PR extension requests `read:user user:email repo workflow`. Missing:
`read:user`, `user:email`. So scope check SHOULD trigger the warning.

Repro steps:
1. `pkill -9 -f shuvscode-linux-x64/shuvscode || true`
2. `rm -rf /tmp/shuvscode-gh-cdp && mkdir -p /tmp/shuvscode-gh-cdp/workspace`
3. `(cd /tmp/shuvscode-gh-cdp/workspace && git init -q && echo smoke > README.md && git remote add origin git@github.com:shuv1337/shuvscode.git)`
4. Launch with CDP enabled (see "Debugging tooling" below).
5. Click the `</>` GitHub icon in the activity bar.
6. Observe: GITHUB: LOGIN view header but blank body (bug 1).
7. Click `[Sign in with GitHub to use GitHub Pull Requests]` in the accounts
   menu (bottom-left). Observe: no scope warning, eventually a "device code"
   fallthrough prompt (bug 2).
8. Output channel `shuvscode GitHub` should still show the success lines from
   "What works".

## Debugging tooling -- agent-browser via CDP

This project has `agent-browser` (Vercel Labs CLI) installed at
`/home/shuv/.local/share/pnpm/agent-browser`. The Electron app exposes CDP via
`--remote-debugging-port`. From `AGENTS.md`:

> For browser-driven Electron smoke tests, launch `shuvscode` with
> `--remote-debugging-port=<port>` and an isolated profile. The VS Code CLI
> warns that `remote-debugging-port` is unknown, but still passes it through
> to Electron/Chromium and exposes CDP.
>
> Start a disposable session such as
> `./shuvscode-linux-x64/bin/shuvscode --no-sandbox --disable-gpu --new-window
> --remote-debugging-port=9333 --user-data-dir /tmp/shuvscode-smoke-user-data
> --extensions-dir /tmp/shuvscode-smoke-extensions <workspace>`, then attach
> with `agent-browser --cdp 9333 get title`, `agent-browser --cdp 9333 snapshot`,
> `agent-browser --cdp 9333 click @ref`, or `agent-browser --cdp 9333 screenshot
> <path>`.

### Pitfall encountered in the previous session

We ran `agent-browser connect 9333` which auto-opened a fresh Chrome window
and made it the default target for subsequent commands. Screenshots came back
blank/black because they were of the empty new Chrome page, not the shuvscode
workbench.

**Always use `--cdp 9333` on EVERY command** and explicitly select the
shuvscode tab with `agent-browser --cdp 9333 tab 0` (or by URL pattern
`--url "*workbench.html*"`). Confirm the active target with
`agent-browser --cdp 9333 tab` and then `agent-browser --cdp 9333 eval
'document.title'` -- it should be `"workspace - shuvscode"` (or similar).

Suggested kick-off script:
```bash
pkill -9 -f shuvscode-linux-x64/shuvscode 2>/dev/null
sleep 1
mkdir -p /tmp/shuvscode-gh-cdp/workspace
(cd /tmp/shuvscode-gh-cdp/workspace && git init -q && echo smoke > README.md && git remote add origin git@github.com:shuv1337/shuvscode.git)

nohup /home/shuv/repos/shuvscode/shuvscode-linux-x64/bin/shuvscode \
  --no-sandbox --disable-gpu --new-window \
  --remote-debugging-port=9333 \
  --user-data-dir /tmp/shuvscode-gh-cdp/userdata \
  --extensions-dir /tmp/shuvscode-gh-cdp/exts \
  /tmp/shuvscode-gh-cdp/workspace \
  > /tmp/shuvscode-cdp.log 2>&1 < /dev/null & disown

sleep 6
curl -sf http://localhost:9333/json/version >/dev/null && echo "CDP up"

agent-browser --cdp 9333 tab            # confirm the workbench tab is there
agent-browser --cdp 9333 tab 0          # target it explicitly
agent-browser --cdp 9333 eval 'document.title'  # should be "* - shuvscode"
agent-browser --cdp 9333 screenshot /tmp/shot.png  # confirm we see the workbench
```

### Useful one-liners for the bugs

```bash
# Force the GitHub view container open via VS Code command
agent-browser --cdp 9333 eval '
  (async () => {
    // VS Code exposes commands via the global vscode (renderer-only); easier
    // path: dispatch the command from the keybinding layer if any.
    return location.href;
  })()
'

# Find the GITHUB: LOGIN view DOM and dump its innerHTML to see if welcome
# nodes are rendered at all.
agent-browser --cdp 9333 eval '
  const els = document.querySelectorAll("[id*=\"github:login\"], [aria-label*=\"GITHUB\"]");
  Array.from(els).slice(0, 5).map(e => ({
    id: e.id, cls: e.className, aria: e.getAttribute("aria-label"),
    text: (e.textContent || "").substring(0, 120)
  }))
'

# Check whether ANY welcome content elements exist
agent-browser --cdp 9333 eval '
  Array.from(document.querySelectorAll(".welcome-view, .welcome-view-content, .monaco-tree-row [role=\"treeitem\"]"))
    .slice(0, 20)
    .map(e => ({ cls: e.className, text: (e.textContent || "").substring(0, 80) }))
'
```

### Adding debug logging to GhCliFlow

The bundled extension is `shuvscode-linux-x64/resources/app/extensions/github-authentication/dist/extension.js`.
It's bundled/minified -- can't edit in place. To add ad-hoc logging, you
must edit the **patch** source then rebuild:

- Edit `vscode/extensions/github-authentication/src/flows.ts` (the
  `GhCliFlow.trigger` method) and add `console.error('[GhCliFlow] step', ...)`
  lines.
- Rebuild with `./scripts/build-shuvscode.sh > /tmp/shuvscode-build.log 2>&1`.
- After rebuild, re-capture the patch:
  ```bash
  cd /home/shuv/repos/shuvscode/vscode
  git add -N extensions/github-authentication/src/node/ghCli.ts extensions/github-authentication/src/browser/ghCli.ts
  git diff --no-color -- \
    extensions/github-authentication/src/flows.ts \
    extensions/github-authentication/src/githubServer.ts \
    extensions/github-authentication/src/test/flows.test.ts \
    extensions/github-authentication/src/node/ghCli.ts \
    extensions/github-authentication/src/browser/ghCli.ts \
    > ../patches/user/32-github-auth-gh-cli.patch
  ```
- console.error from extension host shows up in the extension host's stderr,
  visible via the Output channel `Log (Extension Host)` or in the runtime
  log if launched with `--inspect-extensions`.

## Things to verify in next session

In rough order of value:

1. **Why is `viewsWelcome` not rendering even with no `when` clause?**
   This is the bigger mystery. Options to try:
   - Snapshot the DOM around `github:login` view to see if VS Code is even
     attempting to render welcome content nodes.
   - Try registering a `TreeDataProvider` that returns a single placeholder
     item -- maybe the issue is that returning `[]` is being treated
     differently than expected.
   - Move the welcome content into a DIFFERENT view we own outright (e.g.
     contribute our own view `shuvscode.gh.welcome` in our own view container)
     to confirm `viewsWelcome` works at all in this build, then narrow down
     why it doesn't for `github:login`.
   - Check if patch 22 (`strip-outline-pane`) or any other strip patch
     accidentally removed welcome view rendering code.

2. **Why does `GhCliFlow` not show its scope-warning toast?**
   Add aggressive `console.error('[GhCli][step-N]', ...)` logging in
   `flows.ts`. Then trigger sign-in via the accounts menu and read the
   Extension Host output channel. We'll see exactly which line throws or
   short-circuits.

3. **Is `gh` available to the extension host process?**
   In the CDP-driven shuvscode, open the integrated terminal (`Ctrl+\``) and
   run `which gh && gh auth token | head -c 20`. (User confirmed this works
   from a regular shuvscode session, but the CDP-launched profile may have
   different env.)

## Files / commits

- HEAD: `f186c536` (tag `gh-bugfix-pass-shipped-not-resolved`)
- Recent commits:
  - `b4d61bb` -- wip: rewrite findMissingScopes, register placeholder TDP, fallback welcome
  - `47365bc` -- style(canvas): introduce --canvas-pane color
  - `4f9792c` -- build: keep CLI and Walker launchers in sync
  - `e715a67` -- revert: remove dense panel split patches 30 and 31
  - `cd9ee96` -- feat(github): add shuvscode-gh extension and gh CLI auth flow
- Tags (chronological):
  - `before-shuvscode-gh-extension`
  - `shuvscode-gh-extension-shipped`
  - `before-revert-panel-split-patches`
  - `panel-split-patches-reverted`
  - `before-gh-bugfix-pass`
  - `gh-bugfix-pass-shipped-not-resolved` (current)

Touched files:
- `src/stable/extensions/shuvscode-gh/extension.js` -- the companion extension
- `src/stable/extensions/shuvscode-gh/package.json` -- viewsWelcome + commands
- `patches/user/32-github-auth-gh-cli.patch` -- GhCliFlow + ghCli.ts (node + browser stub)
- `AGENTS.md` -- added agent-browser CDP instructions
- `HANDOFF.md` -- this file
- `README.md` -- removed obsolete dense-split section in a prior commit

## Project context (kept from prior HANDOFFs)

### What changed in this session beyond the gh work

- **Reverted dense panel split patches (30 + 31)** and their experimental
  settings `workbench.bottomPane.experimental.splitWithSecondarySideBar` and
  `workbench.sideBar.experimental.splitWithSecondarySideBar`. The layout
  primitives didn't compose with the rest of the Canvas chrome and the
  resulting UX was worse than upstream behavior. Patch 26 (Canvas default of
  SCM in secondary sidebar) is kept -- it is independent of the split logic.

### shuvscode-gh design

`src/stable/extensions/shuvscode-gh/`:
- `extension.js` -- probes `gh` on activation, sets `shuvscode.gh.detected`
  and `shuvscode.gh.authenticated` context keys, registers an empty
  TreeDataProvider for `github:login`, exposes
  `shuvscode.gh.signIn|refreshDetection|openTerminal|openInBrowser`
  commands. Holds zero tokens; sign-in goes through
  `vscode.authentication.getSession('github', ...)`.
- `package.json` -- 5 viewsWelcome contributions for `github:login`,
  including an unconditional fallback.

### github-authentication patch design

`patches/user/32-github-auth-gh-cli.patch`:
- New `extensions/github-authentication/src/node/ghCli.ts`:
  `isGhCliAvailable()`, `getGhCliToken(logger)`, `findMissingScopes(...)`.
- New `extensions/github-authentication/src/browser/ghCli.ts`: stub. The
  existing esbuild plugin aliases `./node/*` -> `./browser/*` for the web
  bundle.
- `flows.ts`: new `GhCliFlow` class inserted at the head of the flow list;
  `getFlows()` is async and gates the new flow behind a 30s cached
  `isGhCliAvailable()` check.
- `githubServer.ts`: `await getFlows(...)`.
- `flows.test.ts`: tests updated to `await getFlows(...)`.

### Validated facts (kept from prior runs)

- `./scripts/build-shuvscode.sh` clean rebuild produces working v1.120.03291
  binary. Builds from a fresh `git checkout -f FETCH_HEAD && git clean -fd`
  on the vendored vscode tree, then `cp -rp src/stable/* vscode/`, then
  applies `patches/*.patch` + `patches/user/*.patch`.
- TS compiles cleanly for both `tsconfig.json` and `tsconfig.browser.json`
  in the github-authentication extension.
- Patch round-trips via `git apply --check` cleanly.
- Bundled `github-authentication/dist/extension.js` contains the expected
  strings (`gh CLI`, `GitHub CLI`, `missing scope`, `gh auth`).
- `shuvscode-gh` lives in the built tree at
  `shuvscode-linux-x64/resources/app/extensions/shuvscode-gh/`.

### Risks / things to remember

- The PR extension requests `[read:user, user:email, repo, workflow]` by
  default. Most `gh auth login` flows don't grant `read:user`/`user:email`
  unless explicitly requested with `-s`.
- VS Code's `viewsWelcome` system has subtler rules than the docs suggest --
  see the open theories under Bug 1.
- `interactive_shell` dispatch sessions for the build script keep getting
  killed by SIGHUP for unknown reasons -- the workaround is plain
  `nohup ./scripts/build-shuvscode.sh > /tmp/shuvscode-build.log 2>&1 & disown`.
  Build takes ~5-7 minutes.
- The bash tool occasionally drops output on long multi-line commands. If
  you see `(no output)` from a command that should have printed, run the
  steps individually.
