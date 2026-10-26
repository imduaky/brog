#!/bin/sh
# Starts brog (as the unprivileged node user, on 127.0.0.1:8080) and nginx (port 80) in one container.
# If either process stops, the container stops, so the orchestrator restarts it.
set -eu

# setpriv execs brog directly, so the PID we wait on is brog itself.
setpriv --reuid=node --regid=node --init-groups node /app/dist/server/main.mjs &
BROG=$!

# nginx runs in the foreground (daemon off); its master process starts as root to bind port 80.
nginx -g 'daemon off;' &
NGINX=$!

stop() {
  kill -TERM "$BROG" "$NGINX" 2>/dev/null || true
  wait "$BROG" 2>/dev/null || true
  wait "$NGINX" 2>/dev/null || true
  exit 0
}
trap stop TERM INT

while kill -0 "$BROG" 2>/dev/null && kill -0 "$NGINX" 2>/dev/null; do
  sleep 1 &
  wait $!
done
stop
