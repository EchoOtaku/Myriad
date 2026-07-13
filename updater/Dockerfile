# syntax=docker/dockerfile:1.6

# ---------- builder ----------
# rust:1.88+ required: some transitive deps (axum 0.8 ecosystem, `time` crate) need
# edition2024 and minor stdlib features only available in 1.88+. Pin to a known-good
# version rather than `latest` for reproducibility.
FROM rust:1.90-bookworm AS builder
WORKDIR /work

COPY updater/Cargo.toml updater/Cargo.toml
COPY updater/src updater/src

ARG MYRIAD_VERSION=v0.0.0-dev
ENV MYRIAD_VERSION=${MYRIAD_VERSION}
ARG MYRIAD_COMMIT_SHA=unknown
ENV MYRIAD_COMMIT_SHA=${MYRIAD_COMMIT_SHA}

WORKDIR /work/updater
RUN cargo build --release --bins

# ---------- runtime ----------
FROM debian:bookworm-slim AS runtime
ARG TARGETARCH
ARG MYRIAD_COMMIT_SHA=unknown
LABEL org.opencontainers.image.revision=${MYRIAD_COMMIT_SHA}

# Install docker CLI + compose v2 plugin from Docker's official repo (the only reliable
# place to get an up-to-date docker-ce-cli for Debian).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg tar gzip coreutils tini; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://download.docker.com/linux/debian/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; \
    chmod a+r /etc/apt/keyrings/docker.gpg; \
    echo "deb [arch=${TARGETARCH:-amd64} signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        docker-ce-cli docker-compose-plugin; \
    apt-get purge -y gnupg; apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /work/updater/target/release/myriad-updater /usr/local/bin/myriad-updater
COPY --from=builder /work/updater/target/release/myriad-rescue  /usr/local/bin/myriad-rescue

# cosign CLI for release.json signature verification (M2). Single static binary, ~50 MB.
ARG COSIGN_VERSION=v2.4.1
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) cs_arch=amd64 ;; \
        arm64) cs_arch=arm64 ;; \
        *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/cosign \
        "https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign-linux-${cs_arch}"; \
    chmod +x /usr/local/bin/cosign; \
    cosign version

# Required bind mounts in compose:
#   /state                  state directory (host: ./state)
#   /host/compose           compose project dir (host: .)
#   /host/.env              env file (host: ./.env)
#   /host/pgdata            postgres data (host: ./pgdata)
#   /var/run/docker.sock    host docker socket
VOLUME ["/state"]

ENV UPDATER_STATE_DIR=/state \
    UPDATER_COMPOSE_DIR=/host/compose \
    UPDATER_ENV_FILE=/host/.env \
    UPDATER_PGDATA=/host/pgdata \
    UPDATER_LISTEN=0.0.0.0:1101

EXPOSE 1101

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/myriad-updater"]
