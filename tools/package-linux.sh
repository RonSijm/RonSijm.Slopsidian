#!/usr/bin/env bash
# Publish only the native project and its dependencies; never copy a checkout or vault.
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
if [[ "$(uname -s)" != Linux ]]; then
  echo "Build Linux packages on Linux." >&2
  exit 1
fi
case "${1:-$(uname -m)}" in
  x86_64|linux-x64) rid=linux-x64; deb_arch=amd64 ;;
  aarch64|linux-arm64) rid=linux-arm64; deb_arch=arm64 ;;
  *) echo "Usage: tools/package-linux.sh [linux-x64|linux-arm64]" >&2; exit 1 ;;
esac
native_project="$repo_dir/src/RonSijm.Slopsidian.Linux/RonSijm.Slopsidian.Linux.csproj"
native_version="$(dotnet msbuild "$native_project" -nologo -getProperty:Version)"
if [[ ! "$native_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  echo "The native project must declare a SemVer version: $native_version" >&2
  exit 1
fi
# Debian sorts '~preview' before the corresponding stable version.
deb_version="${native_version%%+*}"
deb_version="${deb_version/-/\~}"
if [[ "${GITHUB_REF:-}" == refs/tags/linux-v* && "${GITHUB_REF#refs/tags/linux-v}" != "$native_version" ]]; then
  echo "The Linux release tag must match the native project version: linux-v$native_version" >&2
  exit 1
fi
work_dir="$repo_dir/.runtime/native-linux/$rid"
publish_dir="$work_dir/publish"
bundle="Slopsidian-Native-$native_version-$rid"
stage_dir="$work_dir/$bundle"
out_dir="$work_dir/out"
# These paths are fixed below this script's repository, never supplied by the caller.
rm -rf -- "$publish_dir" "$stage_dir" "$work_dir/deb"
mkdir -p "$publish_dir" "$stage_dir/app" "$out_dir"
dotnet publish src/RonSijm.Slopsidian.Linux -c Release -r "$rid" --self-contained true \
  -p:RestoreSources=https://api.nuget.org/v3/index.json -p:DebugType=None -p:DebugSymbols=false \
  -p:ContinuousIntegrationBuild=true --nologo -o "$publish_dir"
cp -a "$publish_dir/." "$stage_dir/app/"
cat > "$stage_dir/slopsidian-native" <<'LAUNCHER'
#!/usr/bin/env sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec "$app_dir/app/RonSijm.Slopsidian.Linux" "$@"
LAUNCHER
chmod 755 "$stage_dir/slopsidian-native" "$stage_dir/app/RonSijm.Slopsidian.Linux"
cp Docs/Features/NATIVE-LINUX.md "$stage_dir/README.md"
cp tools/linux/THIRD-PARTY-NOTICES.txt "$stage_dir/THIRD-PARTY-NOTICES.txt"
cp -a tools/linux/licenses "$stage_dir/licenses"
tar -C "$work_dir" -czf "$out_dir/$bundle.tar.gz" "$bundle"
if command -v dpkg-deb >/dev/null 2>&1; then
  deb_dir="$work_dir/deb"
  mkdir -p "$deb_dir/DEBIAN" "$deb_dir/usr/lib/slopsidian-native" "$deb_dir/usr/bin" \
    "$deb_dir/usr/share/applications" "$deb_dir/usr/share/icons/hicolor/256x256/apps" \
    "$deb_dir/usr/share/doc/slopsidian-native"
  cp -a "$publish_dir/." "$deb_dir/usr/lib/slopsidian-native/"
  cat > "$deb_dir/usr/bin/slopsidian-native" <<'LAUNCHER'
#!/usr/bin/env sh
exec /usr/lib/slopsidian-native/RonSijm.Slopsidian.Linux "$@"
LAUNCHER
  chmod 755 "$deb_dir/usr/bin/slopsidian-native"
  cp tools/linux/slopsidian-native.desktop "$deb_dir/usr/share/applications/"
  cp tools/linux/slopsidian-native.png "$deb_dir/usr/share/icons/hicolor/256x256/apps/"
  cp tools/linux/THIRD-PARTY-NOTICES.txt "$deb_dir/usr/share/doc/slopsidian-native/copyright"
  cp -a tools/linux/licenses "$deb_dir/usr/share/doc/slopsidian-native/licenses"
  cat > "$deb_dir/DEBIAN/control" <<CONTROL
Package: slopsidian-native
Version: $deb_version
Section: editors
Priority: optional
Architecture: $deb_arch
Maintainer: Slopsidian contributors
Depends: libc6 (>= 2.35), libgcc-s1, libstdc++6, libicu70 | libicu72 | libicu74 | libicu76 | libicu78, libssl3 | libssl3t64, zlib1g, libfontconfig1, libfreetype6, libx11-6, libice6, libsm6, libxext6, libxi6, libxrandr2, libxcursor1
Recommends: xdg-desktop-portal, xdg-desktop-portal-gtk | xdg-desktop-portal-kde
Description: Native Slopsidian workspace for Linux
 Standalone .NET/Avalonia editor with local vaults, search and native Markdown
 reading. Includes its .NET runtime; does not use Electron or a WebView.
CONTROL
  dpkg-deb --root-owner-group --build "$deb_dir" "$out_dir/slopsidian-native_${deb_version}_${deb_arch}.deb"
fi
(
  cd "$out_dir"
  sha256sum "$bundle.tar.gz" > SHA256SUMS.txt
  if [[ -f "slopsidian-native_${deb_version}_${deb_arch}.deb" ]]; then sha256sum "slopsidian-native_${deb_version}_${deb_arch}.deb" >> SHA256SUMS.txt; fi
)
echo "Packages ready: $out_dir"
