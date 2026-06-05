#!/bin/sh
chown -R node:node /app/data

PLACEHOLDER="/openadmin-base-path-placeholder"
RUNTIME_BASE="${BASE_PATH:-}"

find /app/.next -type f \( -name "*.js" -o -name "*.json" -o -name "*.rsc" -o -name "*.html" \) -print0 | xargs -0 sed -i "s|$PLACEHOLDER|$RUNTIME_BASE|g"
sed -i "s|$PLACEHOLDER|$RUNTIME_BASE|g" /app/server.js

exec su-exec node "$@"
