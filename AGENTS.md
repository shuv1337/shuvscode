# shuvscode Agent Notes

## Project purpose

This repository packages a branded Linux x64 build of VS Code/VSCodium as `shuvscode`, with the built application currently emitted under `shuvscode-linux-x64/` and the launcher script at `shuvscode-linux-x64/bin/shuvscode`.

## Key files and directories

- `HANDOFF.md` — current project status, completed phases, known risks, and next steps.
- `shuvscode.env` — branding/build environment values.
- `shuvscode.product.json` — product metadata overlay merged into VS Code product metadata during builds.
- `scripts/build-shuvscode.sh` — main build wrapper.
- `scripts/prepare-shuvscode-tree.sh` — prepares the vendored VS Code tree.
- `scripts/generate-shuvscode-assets.sh` — regenerates branded assets from the source PNG.
- `patches/user/` — shuvscode-specific patches applied to the VS Code tree.
- `shuvscode-linux-x64/` — local built application output.

## Operational notes

- Prefer launching the built app directly with `./shuvscode-linux-x64/bin/shuvscode` from the repository root.
- Use `interactive_shell` for GUI/long-running launches instead of plain `bash` so the process can be monitored or stopped safely.
- For smoke tests, consider an isolated profile such as `--user-data-dir /tmp/shuvscode-smoke-user-data --extensions-dir /tmp/shuvscode-smoke-extensions` to avoid mutating the user's main editor state.
- Do not use `shuvcode` for this project; that name belongs to a separate opencode fork. Use the explicit built-app path or `/usr/bin/shuvscode` when testing the installed AUR package.
- Branding should remain lowercase `shuvscode`.
- `git-lfs` is required for working with the VS Code source tree.
- For browser-driven Electron smoke tests, launch `shuvscode` with `--remote-debugging-port=<port>` and an isolated profile. The VS Code CLI warns that `remote-debugging-port` is unknown, but still passes it through to Electron/Chromium and exposes CDP.
- Managed Zellij project switching lives in `src/stable/extensions/shuvscode-projects/zellij.js` and defaults to the `shuvscode-managed` session. Do not kill or reset user-created Zellij sessions automatically; ownership is recorded in extension global storage before destructive lifecycle actions are allowed.

## Validation hints

- A basic launch smoke test is: `./shuvscode-linux-x64/bin/shuvscode --version`.
- GUI smoke checks from `HANDOFF.md`: welcome suppression, extension activation, Open VSX install, first-run defaults.
- For local VSIX-backed entries in `shuvscode.product.json`, the `vsix` path is resolved by VS Code's build from the vendored `vscode/` tree root, not this repository root. Use `../assets/extensions/...` for files stored in this repo's top-level `assets/extensions/` directory.
- To drive the Electron app with Vercel Labs `agent-browser`, start a disposable session such as `./shuvscode-linux-x64/bin/shuvscode --no-sandbox --disable-gpu --new-window --remote-debugging-port=9333 --user-data-dir /tmp/shuvscode-smoke-user-data --extensions-dir /tmp/shuvscode-smoke-extensions <workspace>`, then use per-command CDP targeting with a fresh session name: `agent-browser --session shuvscode-smoke --cdp 9333 get title`, `agent-browser --session shuvscode-smoke --cdp 9333 snapshot`, `agent-browser --session shuvscode-smoke --cdp 9333 click @ref`, or `agent-browser --session shuvscode-smoke --cdp 9333 screenshot <path>`. For shuvscode Electron smoke tests, control that CDP port directly; do not use the Chrome plugin, the in-app Browser plugin, or `agent-browser connect 9333`. In this Electron setup those flows can leave subsequent commands attached to a separate `about:blank` Chrome session instead of the shuvscode workbench.
- After Projects/Zellij changes, run `node --check src/stable/extensions/shuvscode-projects/extension.js`, `node --check src/stable/extensions/shuvscode-projects/zellij.js`, `node --test src/stable/extensions/shuvscode-projects/zellij.test.js`, and `jq . src/stable/extensions/shuvscode-projects/package.json >/dev/null`.
