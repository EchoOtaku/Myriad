# Extend this image with a reviewed executable at /opt/mcp/entrypoint.
# No credentials, mutable tool installation, or host mounts belong in this image.
FROM python:3.12-alpine@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a
RUN apk add --no-cache bubblewrap=0.12.0-r0 socat=1.8.1.3-r0
COPY docker/mcp-tool/listen.sh /usr/local/bin/myriad-mcp-listen
COPY docker/mcp-tool/sandbox.sh /usr/local/bin/myriad-mcp-sandbox
COPY docker/mcp-tool/guest.sh /usr/local/bin/myriad-mcp-guest
COPY docker/mcp-tool/state_check.py /usr/local/bin/myriad-mcp-state-check.py
COPY docker/mcp-tool/guest_filter.py /tmp/guest_filter.py
RUN mkdir -p /opt/mcp /etc/myriad /var/lib/mcp-state \
    && python /tmp/guest_filter.py /etc/myriad/guest.bpf \
    && rm /tmp/guest_filter.py \
    && chmod 0755 /usr/local/bin/myriad-mcp-listen /usr/local/bin/myriad-mcp-sandbox /usr/local/bin/myriad-mcp-guest
USER 65534:65534
EXPOSE 4444
ENTRYPOINT ["/usr/local/bin/myriad-mcp-listen"]
