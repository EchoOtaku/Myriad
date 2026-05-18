# syntax=docker/dockerfile:1.6
# rust:1.88+ required (axum 0.8 ecosystem + `time` crate); pin for reproducibility.
FROM rust:1.90-bookworm AS builder
WORKDIR /work

COPY proxy/Cargo.toml proxy/Cargo.toml
COPY proxy/src proxy/src

ARG MYRIAD_VERSION=v0.0.0-dev
ENV MYRIAD_VERSION=${MYRIAD_VERSION}

WORKDIR /work/proxy
RUN cargo build --release --bin myriad-proxy

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /work/proxy/target/release/myriad-proxy /usr/local/bin/myriad-proxy

ENV PROXY_LISTEN=0.0.0.0:80 \
    PROXY_STATE_FILE=/state/maintenance.json \
    PROXY_BACKEND_UPSTREAM=http://backend:3000 \
    PROXY_FRONTEND_UPSTREAM=http://frontend:4321 \
    PROXY_UPDATER_UPSTREAM=http://updater:9090

EXPOSE 80

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/myriad-proxy"]
