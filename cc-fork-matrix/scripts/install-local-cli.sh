#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
package_dir="$(CDPATH= cd -- "${script_dir}/.." && pwd)"
target_dir="${HOME}/.local/bin"
target="${target_dir}/cc-fork-matrix"
wrapper="${package_dir}/bin/cc-fork-matrix"

if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s\n' "cc-fork-matrix: pnpm is required to install the local CLI." >&2
  exit 127
fi

pnpm --dir "$package_dir" install
pnpm --dir "$package_dir" build

mkdir -p "$target_dir"
cp "$wrapper" "$target"
chmod +x "$target"

"$target" --help >/dev/null

printf '%s\n' "Installed cc-fork-matrix local CLI: ${target}"
