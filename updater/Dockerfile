# syntax=docker/dockerfile:1.6

# ---------- builder ----------
FROM rust:1.83-bookworm AS builder
WORKDIR /work

COPY updater/Cargo.toml updater/Cargo.toml
COPY updater/src updater/src

ARG MYRIAD_VERSION=v0.0.0-dev
ENV MYRIAD_VERSION=${MYRIAD_VERSION}

WORKDIR /work/updater
RUN cargo build --release --bins

# ---------- runtime ----------
FROM debian:bookworm-slim AS runtime
ARG TARGETARCH

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
    UPDATER_LISTEN=0.0.0.0:9090

EXPOSE 9090

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/myriad-updater"]
