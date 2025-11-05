/**
 * CSRF (Cross-Site Request Forgery) 防护工具
 */

const CSRF_TOKEN_KEY = 'csrf_token';
const CSRF_TOKEN_HEADER = 'X-CSRF-Token';

/**
 * 生成随机 CSRF Token
 */
export function generateCSRFToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 获取当前 CSRF Token，如果不存在则生成新的
 */
export function getCSRFToken(): string {
  let token = sessionStorage.getItem(CSRF_TOKEN_KEY);
  
  if (!token || token.length !== 64) {
    token = generateCSRFToken();
    sessionStorage.setItem(CSRF_TOKEN_KEY, token);
  }
  
  return token;
}

/**
 * 验证 CSRF Token 格式
 */
export function isValidCSRFToken(token: string): boolean {
  return typeof token === 'string' && token.length === 64 && /^[a-f0-9]{64}$/.test(token);
}

/**
 * 清除 CSRF Token（登出时调用）
 */
export function clearCSRFToken(): void {
  sessionStorage.removeItem(CSRF_TOKEN_KEY);
}

/**
 * 获取 CSRF Token Header 名称
 */
export function getCSRFHeaderName(): string {
  return CSRF_TOKEN_HEADER;
}

/**
 * 为请求添加 CSRF Token
 */
export function addCSRFToken(headers: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers,
    [CSRF_TOKEN_HEADER]: getCSRFToken()
  };
}
