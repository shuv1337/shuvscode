#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

source ./shuvscode.env

if [[ -f ./shuvscode.env.local ]]; then
  source ./shuvscode.env.local
fi

node_version="$(cat .nvmrc)"
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash --shims)"
  eval "$(mise hook-env -s bash)" || true
  mise_node_bin="$(mise where node@"$node_version" 2>/dev/null)/bin"
  if [[ -d "$mise_node_bin" ]]; then
    export PATH="$mise_node_bin:$PATH"
  fi
elif command -v nvm >/dev/null 2>&1; then
  nvm use "$node_version"
elif [[ -s /usr/share/nvm/init-nvm.sh ]]; then
  source /usr/share/nvm/init-nvm.sh
  nvm use "$node_version"
fi

export npm_config_python="${npm_config_python:-$(uv python find 3.11)}"

orig_product="$(mktemp)"
cp "$REPO_ROOT/product.json" "$orig_product"

cleanup() {
  cp "$orig_product" "$REPO_ROOT/product.json"
  rm -f "$orig_product"
  if [[ -f "$REPO_ROOT/patches/disable-update.patch" && ! -f "$REPO_ROOT/patches/disable-update.patch.yet" ]]; then
    mv "$REPO_ROOT/patches/disable-update.patch" "$REPO_ROOT/patches/disable-update.patch.yet"
  fi
}
trap cleanup EXIT

jq -s '.[0] * .[1]' "$orig_product" shuvscode.product.json > "$REPO_ROOT/product.json"

# Upstream scripts assume some vars can be unset.
set +u
. ./get_repo.sh
. ./build.sh
set -u

case "${OS_NAME}" in
  osx)
    VSCODE_PLATFORM="darwin"
    ;;
  windows)
    VSCODE_PLATFORM="win32"
    ;;
  *)
    VSCODE_PLATFORM="linux"
    ;;
esac

BUILD_OUTPUT="VSCode-${VSCODE_PLATFORM}-${VSCODE_ARCH}"
BRANDED_OUTPUT="${APP_NAME}-${VSCODE_PLATFORM}-${VSCODE_ARCH}"

if [[ -d "$REPO_ROOT/$BUILD_OUTPUT" && "$BUILD_OUTPUT" != "$BRANDED_OUTPUT" ]]; then
  rm -rf "$REPO_ROOT/$BRANDED_OUTPUT"
  mv "$REPO_ROOT/$BUILD_OUTPUT" "$REPO_ROOT/$BRANDED_OUTPUT"
fi

if [[ "${VSCODE_PLATFORM}" == "darwin" ]]; then
  echo "Built: ${BRANDED_OUTPUT}/${APP_NAME}.app"
else
  echo "Built: ${BRANDED_OUTPUT}/bin/${BINARY_NAME}"
fi

# Refresh the user-local CLI symlink and Walker/GNOME .desktop entry so both
# `shuvscode` from the shell and the Walker application launcher point at this
# fresh build instead of any system-installed copy. Linux only; failures here
# are non-fatal -- the build itself already succeeded.
if [[ "${VSCODE_PLATFORM}" == "linux" && -x "${REPO_ROOT}/scripts/install-dev-launchers.sh" ]]; then
  "${REPO_ROOT}/scripts/install-dev-launchers.sh" || echo "warning: install-dev-launchers.sh failed (build is otherwise OK)" >&2
fi
