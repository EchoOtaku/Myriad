# 安全响应头配置指南

## 概述

某些安全响应头只能通过 **HTTP 响应头** 设置，不能通过 HTML `<meta>` 标签设置。

### ✅ 可以通过 Meta 标签设置的

- `Content-Security-Policy` ✅ (已在 Layout.astro 中配置)
- `Referrer-Policy` ✅ (已在 Layout.astro 中配置)

### ❌ 必须通过 HTTP 响应头设置的

- `X-Frame-Options`
- `X-Content-Type-Options`
- `X-XSS-Protection`
- `Strict-Transport-Security` (HSTS)
- `Permissions-Policy`

## 后端配置方案

### 方案 1: Axum 中间件 (推荐)

在 `backend/src/main.rs` 中添加安全响应头中间件:

```rust
use axum::{
    middleware::{self, Next},
    response::Response,
    http::{Request, header},
};

// 安全响应头中间件
async fn add_security_headers<B>(
    request: Request<B>,
    next: Next<B>,
) -> Response {
    let mut response = next.run(request).await;

    let headers = response.headers_mut();

    // 防止点击劫持
    headers.insert(
        header::HeaderName::from_static("x-frame-options"),
        header::HeaderValue::from_static("DENY"),
    );

    // 防止 MIME 类型嗅探
    headers.insert(
        header::HeaderName::from_static("x-content-type-options"),
        header::HeaderValue::from_static("nosniff"),
    );

    // XSS 保护 (旧浏览器)
    headers.insert(
        header::HeaderName::from_static("x-xss-protection"),
        header::HeaderValue::from_static("1; mode=block"),
    );

    // 权限策略
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        header::HeaderValue::from_static("geolocation=(), microphone=(), camera=()"),
    );

    // HSTS (仅在生产环境使用 HTTPS 时启用)
    #[cfg(not(debug_assertions))]
    headers.insert(
        header::HeaderName::from_static("strict-transport-security"),
        header::HeaderValue::from_static("max-age=31536000; includeSubDomains; preload"),
    );

    response
}

// 在 main 函数中应用中间件
#[tokio::main]
async fn main() {
    // ... 其他代码 ...

    let app = Router::new()
        .route("/health", get(health_check))
        // ... 其他路由 ...
        .layer(middleware::from_fn(add_security_headers)) // 添加这一行
        .with_state(app_state);

    // ... 其他代码 ...
}
```

### 方案 2: Nginx 反向代理配置

如果使用 Nginx 作为反向代理，在 nginx.conf 中添加:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 安全响应头
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # HSTS (仅用于 HTTPS)
    # add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    location / {
        proxy_pass http://localhost:1103;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 方案 3: Docker + Nginx

在 `docker/nginx.conf` 中添加:

```nginx
http {
    # 全局安全响应头
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # ... 其他配置 ...
}
```

## 验证配置

### 使用 curl 验证

```bash
curl -I http://localhost:1103
```

应该看到类似的输出:

```
HTTP/1.1 200 OK
x-frame-options: DENY
x-content-type-options: nosniff
x-xss-protection: 1; mode=block
permissions-policy: geolocation=(), microphone=(), camera=()
```

### 使用浏览器开发者工具

1. 打开网站
2. 按 F12 打开开发者工具
3. 切换到 "Network" 标签
4. 刷新页面
5. 点击第一个请求
6. 查看 "Response Headers" 部分

### 在线安全检查工具

- [Security Headers](https://securityheaders.com/)
- [Mozilla Observatory](https://observatory.mozilla.org/)

## 当前状态

### ✅ 已实现 (前端)

- Content-Security-Policy (通过 meta 标签)
- Referrer-Policy (通过 meta 标签)
- CSRF Token 保护
- Rate Limiting
- 输入验证和清洗

### ⚠️ 待实现 (后端)

需要在 Rust 后端或 Nginx 中添加:

- X-Frame-Options
- X-Content-Type-Options
- X-XSS-Protection
- Permissions-Policy
- Strict-Transport-Security (生产环境)

## 优先级

1. **高优先级** - 应在部署到生产前添加:
   - X-Frame-Options
   - X-Content-Type-Options
2. **中优先级** - 增强安全性:
   - Permissions-Policy
   - X-XSS-Protection
3. **HTTPS 后添加**:
   - Strict-Transport-Security (HSTS)

## 参考资源

- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [MDN - HTTP Headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers)
- [Axum Security Best Practices](https://docs.rs/axum/latest/axum/)
