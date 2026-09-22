FROM debian:11

ARG NODE_VERSION=24.18.0
ARG PNPM_VERSION=11.5.2
ARG DEBIAN_SECURITY_SNAPSHOT=20260803T000000Z

ENV DEBIAN_FRONTEND=noninteractive \
    CI=true \
    LIBCLANG_PATH=/usr/lib/llvm-11/lib

RUN printf '%s\n' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian bullseye main' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian bullseye-updates main' \
      "deb https://snapshot.debian.org/archive/debian-security/${DEBIAN_SECURITY_SNAPSHOT} bullseye-security main" \
    > /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Valid-Until=false -o Acquire::https::Verify-Peer=false update \
    && apt-get -o Acquire::Check-Valid-Until=false -o Acquire::https::Verify-Peer=false install -y --no-install-recommends \
      ca-certificates \
      build-essential \
      clang \
      curl \
      git \
      libasound2-dev \
      libclang-dev \
      libssl-dev \
      pkg-config \
      python3 \
      xz-utils \
      binutils \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    node_archive="node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"; \
    tar -xJf "${node_archive}" -C /usr/local --strip-components=1; \
    rm -f "${node_archive}"; \
    corepack enable; \
    corepack prepare "pnpm@${PNPM_VERSION}" --activate; \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal

ENV PATH=/root/.cargo/bin:$PATH

WORKDIR /src
