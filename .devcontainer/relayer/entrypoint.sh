#!/bin/sh
set -eu

secret_dir=/run/account-sample-relayer
[ -s "${secret_dir}/api-key" ] || { echo "missing generated Relayer API key" >&2; exit 1; }
[ -s "${secret_dir}/admin-secret" ] || { echo "missing generated Channels admin secret" >&2; exit 1; }
export API_KEY="$(cat "${secret_dir}/api-key")"
export PLUGIN_ADMIN_SECRET="$(cat "${secret_dir}/admin-secret")"

exec /app/openzeppelin-relayer "$@"
