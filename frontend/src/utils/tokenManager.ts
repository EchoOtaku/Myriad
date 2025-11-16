/**
 * Token 管理器 - 统一管理认证 Token 的存储和访问
 * 支持 localStorage 和 HttpOnly Cookie 双模式
 */

export class TokenManager {
  private static readonly TOKEN_KEY = 'auth_token';
  private static readonly COOKIE_NAME = 'auth_token';
  
  /**
   * 验证 JWT Token 格式是否有效
   */
  private static isValidToken(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    return parts.length === 3 && parts.every(part => part.length > 0);
  }

  /**
   * 从 Cookie 中读取 Token
   */
  private static getTokenFromCookie(): string | null {
    try {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === this.COOKIE_NAME && value) {
          return decodeURIComponent(value);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取 Token（优先从 Cookie，其次从 localStorage）
   */
  static getToken(): string | null {
    try {
      // 优先从 HttpOnly Cookie 读取（更安全）
      const cookieToken = this.getTokenFromCookie();
      if (cookieToken && this.isValidToken(cookieToken)) {
        return cookieToken;
      }

      // 回退到 localStorage（向后兼容）
      const storageToken = localStorage.getItem(this.TOKEN_KEY);
      if (storageToken && this.isValidToken(storageToken)) {
        return storageToken;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 设置 Token（同时保存到 localStorage，Cookie 由后端设置）
   */
  static setToken(token: string): void {
    try {
      if (!this.isValidToken(token)) {
        throw new Error('Invalid token format');
      }
      
      // 保存到 localStorage（向后兼容）
      localStorage.setItem(this.TOKEN_KEY, token);
      
      // HttpOnly Cookie 由后端在 Set-Cookie 头中设置，前端无法设置
      // 这里只是文档说明
    } catch (e) {
      console.error('Failed to store token:', e);
      throw e;
    }
  }

  /**
   * 移除 Token
   */
  static removeToken(): void {
    try {
      // 清除 localStorage
      localStorage.removeItem(this.TOKEN_KEY);
      
      // 清除 Cookie（设置过期时间为过去）
      document.cookie = `${this.COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
    } catch (e) {
      console.error('Failed to remove token:', e);
    }
  }

  /**
   * 检查用户是否已认证
   */
  static isAuthenticated(): boolean {
    const token = this.getToken();
    return token !== null && this.isValidToken(token);
  }

  /**
   * 解析 Token 获取 Payload（不验证签名）
   */
  static decodeToken(token?: string): any {
    try {
      const t = token || this.getToken();
      if (!t) return null;

      const parts = t.split('.');
      if (parts.length !== 3) return null;

      const payload = parts[1];
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }

  /**
   * 检查 Token 是否即将过期（默认 5 分钟内）
   */
  static isTokenExpiringSoon(thresholdMs: number = 300000): boolean {
    try {
      const payload = this.decodeToken();
      if (!payload || !payload.exp) return true;

      const expirationTime = payload.exp * 1000; // JWT exp 是秒，转换为毫秒
      const now = Date.now();
      return expirationTime - now < thresholdMs;
    } catch {
      return true;
    }
  }

  /**
   * 获取 Token 过期时间
   */
  static getTokenExpiration(): Date | null {
    try {
      const payload = this.decodeToken();
      if (!payload || !payload.exp) return null;
      return new Date(payload.exp * 1000);
    } catch {
      return null;
    }
  }
}

export default TokenManager;
