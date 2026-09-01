#!/bin/sh
set -eu

secret_dir=/run/account-sample-relayer
mkdir -p "${secret_dir}"
umask 077

if [ ! -s "${secret_dir}/api-key" ]; then
  dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 > "${secret_dir}/api-key"
fi
if [ ! -s "${secret_dir}/admin-secret" ]; then
  dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 > "${secret_dir}/admin-secret"
fi

# The volume is mounted only by development services. The Relayer runs as a
# non-root user, so make these generated files readable inside those services.
chmod 0444 "${secret_dir}/api-key" "${secret_dir}/admin-secret"
