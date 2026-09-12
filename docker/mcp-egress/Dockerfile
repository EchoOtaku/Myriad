FROM python:3.12-alpine@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a
RUN apk add --no-cache squid=7.6-r0
COPY docker/mcp-egress/squid.conf /etc/squid/squid.conf
USER 65534:65534
ENTRYPOINT ["squid", "-N", "-d", "1", "-f", "/etc/squid/squid.conf"]
