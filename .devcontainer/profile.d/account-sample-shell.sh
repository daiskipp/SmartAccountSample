#!/usr/bin/env bash
# Login shell tweaks for the devcontainer (history persistence + prompt).
# Sourced from /etc/bash.bashrc (see Dockerfile).

# Persist bash history across container restarts via the home-state volume.
HISTDIR="${HOME}/.account-sample-devcontainer"
mkdir -p "${HISTDIR}" 2>/dev/null || true
export HISTFILE="${HISTDIR}/.bash_history"
export HISTSIZE=10000
export HISTFILESIZE=20000
export HISTCONTROL=ignoreboth
shopt -s histappend

# Prefix the prompt so it's obvious we're inside the devcontainer.
case "$-" in
  *i*)
    PS1="[devcontainer] ${PS1:-\u@\h:\w\$ }"
    ;;
esac
