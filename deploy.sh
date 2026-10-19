#!/bin/bash
# Same as deploy-app.sh (kept so the old command still works).
exec bash "$(dirname "$0")/deploy-app.sh" "$@"
