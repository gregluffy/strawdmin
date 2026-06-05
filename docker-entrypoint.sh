#!/bin/sh
chown -R node:node /app/data
exec su-exec node "$@"
