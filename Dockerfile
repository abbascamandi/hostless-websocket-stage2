# Reuse the Aether image that was proven to work in Stage 1.
FROM ghcr.io/cluvexstudio/aether:latest AS aether

# Official Xray-core image; copy only the executable into the final image.
FROM ghcr.io/xtls/xray-core:26.11.9 AS xray

# One container is intentional: Xray must reach Aether through localhost.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=aether /usr/local/bin/aether /usr/local/bin/aether
COPY --from=aether /usr/local/bin/pt /usr/local/bin/pt
COPY --from=xray /usr/local/bin/xray /usr/local/bin/xray

WORKDIR /app
COPY server.js generate-config.js wait-port.js ./
COPY start.sh /usr/local/bin/start.sh
RUN chmod 0755 /usr/local/bin/start.sh \
    && chmod 0755 /usr/local/bin/aether /usr/local/bin/xray

ENV AETHER_SOCKS=127.0.0.1:1819 \
    AETHER_CONFIG=/tmp/aether.toml \
    AETHER_MASQUE_CONFIG=/tmp/aether-masque.toml \
    AETHER_SCAN=balanced \
    AETHER_NOIZE=balanced \
    XRAY_LOCAL_PORT=10000 \
    XRAY_CONFIG_FILE=/tmp/xray-config.json

CMD ["/usr/local/bin/start.sh"]
