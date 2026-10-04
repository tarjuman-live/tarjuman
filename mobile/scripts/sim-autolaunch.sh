#!/bin/bash
# Auto-launch Tarjuman on every booted iOS simulator (dev convenience).
#
# Runs as a macOS LaunchAgent (~/Library/LaunchAgents/live.tarjuman.sim-autolaunch.plist,
# installed by `bash mobile/scripts/sim-autolaunch.sh --install`). Every 3s it
# lists the booted iPhone/iPad simulators. For each newly booted one it:
#   1. installs Tarjuman if it's missing — from the cached build
#      (~/Library/Caches/tarjuman/Tarjuman.app, refreshed after every Xcode
#      build), or, if there is no build anywhere, runs one `expo run:ios`
#      build (minutes; one at a time) and caches it;
#   2. makes sure the dev servers are up — Metro on :8081 (the app's JS) and
#      the Next.js dev server on :3000 (the app's /api);
#   3. launches the app.
# A cached build only goes stale when NATIVE dependencies change; JS always
# comes live from Metro.
#
# Once per boot: if you quit the app, it stays quit until that simulator boots
# again. Servers are only started when their port is free, so a Metro / dev
# server you started yourself (e.g. in a terminal tab) is reused, never doubled.
#
# Logs:      ~/Library/Logs/tarjuman/
# Install:   bash mobile/scripts/sim-autolaunch.sh --install
# Uninstall: bash mobile/scripts/sim-autolaunch.sh --uninstall
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$MOBILE/.." && pwd)"
BUNDLE_ID="live.tarjuman.app"
LABEL="live.tarjuman.sim-autolaunch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/tarjuman"
mkdir -p "$LOG_DIR"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

case "${1:-}" in
  --install)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Standard</string>
  <key>StandardOutPath</key><string>$LOG_DIR/autolaunch.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/autolaunch.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "installed: $PLIST"
    exit $?
    ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    rm -f "$PLIST" && echo "uninstalled"
    exit 0
    ;;
esac

log() { echo "$(date '+%F %T') $*"; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Start each server at most once a minute: a server that crashes on boot
# (e.g. a broken dependency) must not be respawned every 3 seconds.
last_metro=0
last_web=0
start_servers() {
  local now
  now=$(date +%s)
  if ! listening 8081 && [ $((now - last_metro)) -ge 60 ]; then
    last_metro=$now
    log "starting Metro on :8081"
    (cd "$MOBILE" && nohup bunx expo start --port 8081 </dev/null >>"$LOG_DIR/metro.log" 2>&1 &)
  fi
  if ! listening 3000 && [ $((now - last_web)) -ge 60 ]; then
    last_web=$now
    log "starting web dev server on :3000"
    (cd "$REPO" && nohup bun run dev </dev/null >>"$LOG_DIR/web-dev.log" 2>&1 &)
  fi
}

ensure_servers() {
  start_servers
  for _ in $(seq 1 90); do
    listening 8081 && return 0
    sleep 1
  done
  log "Metro did not come up within 90s (see $LOG_DIR/metro.log)"
  return 1
}

APP_CACHE="$HOME/Library/Caches/tarjuman/Tarjuman.app"

# Newest Debug-iphonesimulator build in DerivedData (or ios/build), if any.
derived_app() {
  ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/Tarjuman-*/Build/Products/Debug-iphonesimulator/Tarjuman.app \
    "$MOBILE"/ios/build/Build/Products/Debug-iphonesimulator/Tarjuman.app 2>/dev/null | head -1
}

# A finished Debug build has both the launcher and the linked app dylib; a
# build that died at link time leaves a bundle without the dylib. Never cache
# or install one of those.
complete_app() {
  [ -f "$1/Info.plist" ] && [ -x "$1/Tarjuman" ] && [ -f "$1/Tarjuman.debug.dylib" ]
}

# Keep a stable copy of the newest COMPLETE build so a wiped DerivedData or a
# fresh simulator never forces a rebuild.
refresh_cache() {
  local d
  d="$(derived_app)"
  [ -n "$d" ] && complete_app "$d" || return 0
  if [ ! -d "$APP_CACHE" ] || [ "$d" -nt "$APP_CACHE" ]; then
    mkdir -p "$(dirname "$APP_CACHE")"
    rm -rf "$APP_CACHE" && cp -R "$d" "$APP_CACHE" && log "cached build from $d"
  fi
}

# Install Tarjuman on $1 if it isn't there. Returns non-zero if it can't yet.
ensure_installed() {
  local u="$1"
  xcrun simctl get_app_container "$u" "$BUNDLE_ID" >/dev/null 2>&1 && return 0
  refresh_cache
  if [ -d "$APP_CACHE" ] && complete_app "$APP_CACHE"; then
    log "installing Tarjuman on $u"
    xcrun simctl install "$u" "$APP_CACHE" && return 0
  fi
  # No build anywhere: build once (this also installs on $u). mkdir is an
  # atomic lock so two booting simulators never start two builds.
  if mkdir "$LOG_DIR/build.lock" 2>/dev/null; then
    log "no build found — building Tarjuman for $u (see $LOG_DIR/build.log)"
    ensure_servers
    if (cd "$MOBILE" && bunx expo run:ios --device "$u" --no-bundler --no-install </dev/null >>"$LOG_DIR/build.log" 2>&1); then
      rmdir "$LOG_DIR/build.lock"
      refresh_cache
      xcrun simctl get_app_container "$u" "$BUNDLE_ID" >/dev/null 2>&1 && return 0
    else
      rmdir "$LOG_DIR/build.lock"
    fi
    log "build failed (see $LOG_DIR/build.log)"
  fi
  return 1
}

booted_udids() {
  xcrun simctl list devices booted -j 2>/dev/null | /usr/bin/python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for runtime, devices in data.get("devices", {}).items():
    if ".iOS-" not in runtime:          # iPhone/iPad only (skip watch/tv/vision)
        continue
    for d in devices:
        if d.get("state") == "Booted":
            print(d["udid"])
' | tr '\n' ' '
}

rmdir "$LOG_DIR/build.lock" 2>/dev/null   # stale lock from a crash mid-build
log "watching for booted simulators (repo: $REPO)"
launched=" "
while true; do
  current=" $(booted_udids) "

  # Forget simulators that shut down, so their next boot launches again.
  still=" "
  for u in $launched; do
    case "$current" in *" $u "*) still="$still$u " ;; esac
  done
  launched="$still"

  # While any simulator is booted, keep the servers alive (cheap port checks;
  # restarts are throttled in start_servers).
  [ "$current" != "  " ] && start_servers

  for u in $current; do
    case "$launched" in *" $u "*) continue ;; esac
    # One attempt per boot, success or not — a failing build must never loop.
    launched="$launched$u "
    xcrun simctl bootstatus "$u" >/dev/null 2>&1   # wait for SpringBoard
    ensure_installed "$u" || continue
    ensure_servers
    if xcrun simctl launch "$u" "$BUNDLE_ID" >/dev/null 2>&1; then
      log "launched Tarjuman on $u"
    else
      log "launch failed on $u"
    fi
  done
  sleep 3
done
