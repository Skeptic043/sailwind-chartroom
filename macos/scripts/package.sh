#!/bin/bash
# Builds Sailwind Chartroom.app and writes SailwindChartroom-macos-universal-<version>.zip.
#
#   package.sh <version> [output folder]
#
# <version> is 0.6.0 for a release or 0.6.0-rc.1 for a release candidate.
# SPARKLE_PUBLIC_KEY  the update-signing public key (from make-update-key.mjs). Required.
# SPARKLE_FEED_URL    the appcast address. Defaults to the project's appcast.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
version=${1:?Usage: package.sh <version> [output folder]}
out=${2:-$root/artifacts}
public_key=${SPARKLE_PUBLIC_KEY:?Set SPARKLE_PUBLIC_KEY to the update-signing public key.}
feed_url=${SPARKLE_FEED_URL:-https://raw.githubusercontent.com/Skeptic043/sailwind-chartroom/appcast/appcast.xml}

# Sparkle orders updates by the build number and ignores any "-rc" suffix. The build number is
# <major>.<minor>.<patch x 1000 + candidate>, with 999 for the release itself, so 0.6.0-rc.1 is
# build 0.6.1, 0.6.0 is build 0.6.999 and 0.6.1-rc.1 is build 0.6.1001.
if [[ $version =~ ^([0-9]+\.[0-9]+)\.([0-9]+)-rc\.([0-9]+)$ && ${BASH_REMATCH[3]} -lt 999 ]]; then
  build="${BASH_REMATCH[1]}.$((BASH_REMATCH[2] * 1000 + BASH_REMATCH[3]))"
elif [[ $version =~ ^([0-9]+\.[0-9]+)\.([0-9]+)$ ]]; then
  build="${BASH_REMATCH[1]}.$((BASH_REMATCH[2] * 1000 + 999))"
else
  echo "Invalid version: $version" >&2
  exit 1
fi

cd "$root"
flags=(-c release --arch arm64 --arch x86_64 --package-path macos)
swift build "${flags[@]}"
binary="$(swift build "${flags[@]}" --show-bin-path)/SailwindChartroom"
archs=$(lipo -archs "$binary")
[[ $archs == *arm64* && $archs == *x86_64* ]] || { echo "Not a universal binary: $archs" >&2; exit 1; }

# Assembled in a fresh folder from an explicit list, so nothing stale or local reaches the package.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
app="$stage/Sailwind Chartroom.app"
web="$app/Contents/Resources/web"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks" "$web/src" "$web/assets/sailwind"
cp "$binary" "$app/Contents/MacOS/Sailwind Chartroom"
sed -e "s|@VERSION@|$version|" -e "s|@BUILD@|$build|" -e "s|@FEED_URL@|$feed_url|" -e "s|@PUBLIC_KEY@|$public_key|" \
  macos/Resources/Info.plist > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist" > /dev/null
iconutil -c icns macos/Resources/AppIcon.iconset -o "$app/Contents/Resources/AppIcon.icns"
cp index.html styles.css "$web/"
cp src/*.mjs "$web/src/"
cp assets/sailwind/* "$web/assets/sailwind/"
cp LICENSE "$web/LICENSE.txt"
cp THIRD-PARTY-NOTICES.md "$web/THIRD-PARTY-NOTICES.txt"

framework=$(find macos/.build/artifacts -type d -name Sparkle.framework -path '*macos*' | head -n 1)
[[ -n $framework ]] || { echo "Sparkle.framework was not found in the build." >&2; exit 1; }
ditto "$framework" "$app/Contents/Frameworks/Sparkle.framework"

# Ad-hoc signature: enough to run on Apple silicon, not a Developer ID.
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"

mkdir -p "$out"
zip="$out/SailwindChartroom-macos-universal-$version.zip"
rm -f "$zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"

# The package must still be a valid, signed app with its framework links after extraction.
check=$(mktemp -d)
ditto -x -k "$zip" "$check"
extracted="$check/Sailwind Chartroom.app"
codesign --verify --deep --strict "$extracted"
[[ -L "$extracted/Contents/Frameworks/Sparkle.framework/Sparkle" ]] || { echo "The ZIP lost the framework's links." >&2; exit 1; }
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$extracted/Contents/Info.plist") == "$version" ]]
[[ -f "$extracted/Contents/Resources/web/index.html" && -f "$extracted/Contents/Resources/AppIcon.icns" ]]
rm -rf "$check"
echo "Verified: $zip (version $version, build $build, $archs)"
