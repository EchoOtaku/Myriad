export const SITE = {
  title: 'Myriad',
  description: 'Multi-platform personal information aggregation and analysis platform',
  defaultLanguage: 'en-us',
} as const;

// 智能 API URL 检测：
// 1. 优先使用环境变量 PUBLIC_API_URL（开发环境）
// 2. 如果是浏览器环境，使用当前域名（生产环境）
// 3. 否则使用 localhost（SSR/构建时）
export const API_URL = import.meta.env.PUBLIC_API_URL || 
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
