FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NODE_VERSION=24.16.0
ARG TARGETARCH

# bubblewrap is required by Codex CLI sandboxing. libdbus-1-3 is required by
# the prebuilt stellar CLI binary (dynamically linked against it). python3
# gives us a zero-dependency static server for previewing
# docs/recovery-levels-demo.html (no bundler/build step exists in this repo).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bubblewrap \
      just \
      libdbus-1-3 \
      python-is-python3 \
      python3-pip \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Node.js (pinned tarball install). This repo has no JS build system — Node
# is here solely to install the Claude Code / Codex CLIs via npm.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) node_arch="x64" ;; \
      arm64) node_arch="arm64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1; \
    rm "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    node --version; \
    npm --version; \
    corepack enable

# StellarView Explorer is a Bun workspace. Keep the toolchain version aligned
# with its pinned packageManager field so it can run beside the Vite frontend.
RUN npm install --global bun@1.2.15 \
    && bun --version

# 🔵 Intent: rtk (https://github.com/rtk-ai/rtk) — Rust LLM token-reduction
#   CLI that Claude Code hooks shell out to (see ~/.claude/RTK.md). Pinned via
#   RTK_VERSION for reproducible rebuilds. After rebuild, run `rtk init -g`
#   once per user to enable auto-rewriting.
ARG RTK_VERSION=v0.42.0
RUN set -eux; \
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh \
      | RTK_INSTALL_DIR=/usr/local/bin RTK_VERSION="${RTK_VERSION}" sh; \
    rtk --version

# GitHub CLI (gh) for PR / issue workflows from inside the container.
ARG GH_VERSION=2.93.0
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) gh_arch="amd64" ;; \
      arm64) gh_arch="arm64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${gh_arch}.tar.gz"; \
    tar -xzf "gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" -C /tmp; \
    mv "/tmp/gh_${GH_VERSION}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh; \
    rm -rf "gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" "/tmp/gh_${GH_VERSION}_linux_${gh_arch}"; \
    gh --version

COPY profile.d/account-sample-shell.sh /etc/profile.d/account-sample-shell.sh
RUN printf '\nif [ -f /etc/profile.d/account-sample-shell.sh ]; then\n  . /etc/profile.d/account-sample-shell.sh\nfi\n' >>/etc/bash.bashrc
