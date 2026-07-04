# 安全响应头配置指南

当前状态：安全响应头已经由后端中间件
`backend/src/middleware/security.rs` 添加，并在 `backend/src/main.rs` 的 router
上启用。生产部署中，浏览器请求先进入 Myriad `proxy`，再转发到 backend/frontend。

## 后端已添加的响应头

- `Content-Security-Policy`：生产环境默认启用，`connect-src` 可用
  `CSP_CONNECT_SRC` 覆盖。
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`
- `Strict-Transport-Security`：仅 `ENVIRONMENT=production` 时添加。

开发环境默认不启用 CSP。如需本地验证 CSP：

```env
ENABLE_CSP_DEV=true
```

## 当前生产拓扑

```text
client -> optional TLS entrypoint -> Myriad proxy:${HTTP_PORT:-80}
                                    ├-> frontend:1102
                                    └-> backend:1103
```

外层 Nginx/Caddy/负载均衡器如果存在，应代理到 Myriad `proxy` 的宿主端口，
不要直接代理到 backend `1103`，否则会绕过维护页和 updater 救援路径。

## Nginx TLS 入口示例

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:80; # Myriad HTTP_PORT
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果 `.env` 中设置了 `HTTP_PORT=8080`，把 `proxy_pass` 改为
`http://127.0.0.1:8080`。

## 验证

生产路径：

```bash
curl -I https://your-domain.com
```

本机直接验证 proxy：

```bash
curl -I http://localhost:${HTTP_PORT:-80}
```

本地开发直接验证 backend：

```bash
curl -I http://localhost:1103/health
```

应该能看到 `x-frame-options`、`x-content-type-options`、`referrer-policy`、
`permissions-policy` 等响应头。生产环境还应看到
`strict-transport-security`。

## 相关配置

- `ENVIRONMENT=production`：启用生产 CSP 和 HSTS。
- `CSP_CONNECT_SRC`：覆盖生产 CSP 的 `connect-src`，默认为 `'self' https:`。
- `ENABLE_CSP_DEV=true`：开发环境也启用 CSP。

更多部署细节见 [Docker 部署](../deployment/DOCKER_DEPLOYMENT.md) 和
[端口清单](../deployment/PORTS.md)。
