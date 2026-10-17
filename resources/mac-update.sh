#!/bin/sh
# Every path is passed as a separate argument. Never interpolate release data into shell code.
set -eu
parent_pid="$1"
target="$2"
candidate="$3"
stage="$4"
backup="$stage/previous.app"
exec >>"$stage/install.log" 2>&1
case "$parent_pid" in ''|*[!0-9]*) exit 1 ;; esac
test -d "$target/Contents"
test -d "$candidate/Contents"
test ! -e "$backup"
/usr/bin/touch "$stage/installer-started"
attempt=0
while /bin/kill -0 "$parent_pid" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 120 ]; then echo "Client did not quit; leaving the installed application unchanged"; exit 1; fi
    /bin/sleep 1
done
# Both paths are on the installation volume. Keep the previous bundle for recovery.
/bin/mv "$target" "$backup"
if ! /bin/mv "$candidate" "$target"; then
    /bin/mv "$backup" "$target"
    exit 1
fi
if ! /usr/bin/open -n "$target"; then
    /bin/mv "$target" "$stage/failed.app"
    /bin/mv "$backup" "$target"
    /usr/bin/open -n "$target" || true
    exit 1
fi
echo "Update installed; the previous application remains at $backup"
