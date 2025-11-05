/**
 * Content Security Policy (CSP) 配置
 * 用于防止 XSS、点击劫持等攻击
 * 
 * 注意: 某些安全响应头只能通过 HTTP 响应头设置，不能通过 meta 标签设置:
 * - X-Frame-Options (必须在后端设置)
 * - X-Content-Type-Options (必须在后端设置)
 * - X-XSS-Protection (必须在后端设置)
 * - Strict-Transport-Security (必须在后端设置)
 * 
 * 请参考 docs/SECURITY_HEADERS.md 了解如何在后端配置这些响应头
 */

export const CSP_DIRECTIVES = {
  // 默认源：只允许同源内容
  'default-src': ["'self'"],
  
  // 脚本源：允许同源和内联脚本（Astro需要）
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Astro 内联脚本需要
    "'unsafe-eval'",   // 开发环境需要，生产环境应移除
  ],
  
  // 样式源：允许同源和内联样式
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Tailwind CSS 需要
    'https://fonts.googleapis.com',
  ],
  
  // 字体源
  'font-src': [
    "'self'",
    'https://fonts.gstatic.com',
  ],
  
  // 图片源：允许同源、data URI 和外部图片服务
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https:', // 允许所有 HTTPS 图片（壁纸服务）
    'http://localhost:3000', // 本地开发
  ],
  
  // 媒体源
  'media-src': ["'self'"],
  
  // 连接源：API 请求
  'connect-src': [
    "'self'",
    'http://localhost:3000',
    'https://api.github.com',
    'https://image.pollinations.ai', // AI 图片生成
  ],
  
  // Frame 源：禁止嵌入
  'frame-src': ["'none'"],
  
  // Object 源：禁止插件
  'object-src': ["'none'"],
  
  // Base URI：限制 <base> 标签
  'base-uri': ["'self'"],
  
  // Form 动作：限制表单提交
  'form-action': ["'self'"],
  
  // Frame 祖先：防止点击劫持
  'frame-ancestors': ["'none'"],
  
  // 升级不安全请求（生产环境）
  'upgrade-insecure-requests': [],
};

/**
 * 生成 CSP 字符串
 */
export function generateCSPString(isDev: boolean = false): string {
  const directives = { ...CSP_DIRECTIVES };
  
  // 生产环境移除 unsafe-eval
  if (!isDev && directives['script-src']) {
    directives['script-src'] = directives['script-src'].filter(
      src => src !== "'unsafe-eval'"
    );
  }
  
  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      return `${key} ${values.join(' ')}`;
    })
    .join('; ');
}

/**
 * 其他安全响应头配置
 * 
 * ⚠️ 注意: 这些响应头必须在后端设置，不能通过 HTML meta 标签设置
 * 请在 Rust 后端或 Nginx 反向代理中配置这些响应头
 */
export const SECURITY_HEADERS = {
  // 防止点击劫持 (必须在后端设置)
  'X-Frame-Options': 'DENY',
  
  // 防止 MIME 类型嗅探 (必须在后端设置)
  'X-Content-Type-Options': 'nosniff',
  
  // XSS 保护 - 旧浏览器 (必须在后端设置)
  'X-XSS-Protection': '1; mode=block',
  
  // Referrer 策略 (可以通过 meta 标签设置，已在 Layout.astro 中配置)
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // 权限策略 (必须在后端设置)
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  
  // HSTS - 仅生产环境且使用 HTTPS 时启用 (必须在后端设置)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

/**
 * 将安全头转换为 meta 标签
 * 
 * ⚠️ 注意: 只有 CSP 和 Referrer-Policy 可以通过 meta 标签设置
 * 其他安全响应头必须在后端设置
 */
export function generateSecurityMetaTags(isDev: boolean = false): string {
  const csp = generateCSPString(isDev);
  
  return `
    <meta name="referrer" content="strict-origin-when-cross-origin">
    ${!isDev ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}
  `.trim();
}
