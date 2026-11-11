#!/bin/bash
# Proves a packaged app can update itself: 0.6.0-rc.1 -> 0.6.0-rc.2 on the candidate channel, then
# -> 0.6.0, using a throwaway signing key and a feed served from this machine. A build that does not
# follow the candidate channel must not be offered a candidate.
#
#   update-test.sh <work folder>
#
# Sparkle's own command-line updater does the work, with the same feed parsing, signature check and
# installer as the app. The update window the player sees is not clicked through here.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
work=${1:?Usage: update-test.sh <work folder>}
mkdir -p "$work" && work=$(cd "$work" && pwd)
port=8123
sparkle_version=2.10.1
feed="$work/feed"
install="$work/install"
app="$install/Sailwind Chartroom.app"
rm -rf "$feed" "$install" "$work/key" "$work/smoke" && mkdir -p "$feed" "$install" "$work/packages"

SPARKLE_PUBLIC_KEY=$(node "$root/macos/scripts/make-update-key.mjs" "$work/key")
export SPARKLE_PUBLIC_KEY
export SPARKLE_FEED_URL="http://127.0.0.1:$port/appcast.xml"
for version in 0.6.0-rc.1 0.6.0-rc.2 0.6.0; do
  bash "$root/macos/scripts/package.sh" "$version" "$work/packages"
done
bin="$root/macos/.build/artifacts/sparkle/Sparkle/bin"

# Sparkle's command-line updater is not in its release archive, so it is built from the same version's source.
if [[ ! -d "$work/sparkle" ]]; then
  git clone --quiet --depth 1 --branch "$sparkle_version" https://github.com/sparkle-project/Sparkle "$work/sparkle"
  xcodebuild -quiet -project "$work/sparkle/Sparkle.xcodeproj" -scheme sparkle-cli -configuration Release \
    -derivedDataPath "$work/sparkle/build" CODE_SIGN_IDENTITY=- build
fi
cli=$(find "$work/sparkle/build" -type f -path "*sparkle.app/Contents/MacOS/sparkle" | head -n 1)
[[ -n $cli ]] || { echo "Sparkle's command-line updater was not found." >&2; exit 1; }

installed_version() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$app/Contents/Info.plist"
}

# publish <version> [generate_appcast options]
publish() {
  cp "$work/packages/SailwindChartroom-macos-universal-$1.zip" "$feed/"
  "$bin/generate_appcast" --ed-key-file "$work/key" --download-url-prefix "http://127.0.0.1:$port/" --maximum-deltas 0 "${@:2}" "$feed"
  cat "$feed/appcast.xml"
}

# update [sparkle options]; prints the updater's exit code
update() {
  local code=0
  "$cli" --check-immediately --verbose "$@" "$app" >&2 || code=$?
  echo "$code"
}

ditto -x -k "$work/packages/SailwindChartroom-macos-universal-0.6.0-rc.1.zip" "$install"
node "$root/macos/scripts/smoke.mjs" "$app" "$work/smoke" create

python3 -m http.server "$port" --bind 127.0.0.1 --directory "$feed" > "$work/server.log" 2>&1 &
server=$!
trap "kill $server 2>/dev/null || true" EXIT
sleep 1

publish 0.6.0-rc.2 --channel rc
code=$(update)
[[ $(installed_version) == 0.6.0-rc.1 ]] || { echo "A build off the candidate channel installed a candidate." >&2; exit 1; }
echo "Off the candidate channel: no update offered (updater exit code $code)."

code=$(update --channels rc)
[[ $(installed_version) == 0.6.0-rc.2 ]] || { echo "rc.1 did not update to rc.2 (updater exit code $code)." >&2; exit 1; }
codesign --verify --deep --strict "$app"
echo "Updated 0.6.0-rc.1 -> 0.6.0-rc.2."

publish 0.6.0
code=$(update --channels rc)
[[ $(installed_version) == 0.6.0 ]] || { echo "rc.2 did not update to 0.6.0 (updater exit code $code)." >&2; exit 1; }
codesign --verify --deep --strict "$app"
echo "Updated 0.6.0-rc.2 -> 0.6.0."

# The updated app must not be quarantined again, and must still open the charts made before the updates.
if xattr -p com.apple.quarantine "$app" 2>/dev/null; then
  echo "The updated app is quarantined." >&2
  exit 1
fi
node "$root/macos/scripts/smoke.mjs" "$app" "$work/smoke" verify
echo "Update test passed."
