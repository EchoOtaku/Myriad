/**
 * 路由配置
 * 定义所有应用路由及其对应的组件
 */

export interface RouteConfig {
  path: string;
  component: () => Promise<{ default: React.ComponentType<any> }>;
  title: string;
  description?: string;
  requiresAuth?: boolean;
  requiresAdmin?: boolean;
}

export const routes: RouteConfig[] = [
  {
    path: '/',
    component: () => import('../views/Home.tsx'),
    title: 'Myriad - 数字自我发现',
    description: '一键聚合你的多平台数据，生成AI个人分析报告',
  },
  {
    path: '/library',
    component: () => import('../views/Library.tsx'),
    title: '资料库 - Myriad',
    description: '浏览你的多平台数据收藏',
  },
  {
    path: '/account',
    component: () => import('../views/Account.tsx'),
    title: '账户管理 - Myriad',
    requiresAuth: true,
  },
  {
    path: '/config',
    component: () => import('../views/Config.tsx'),
    title: '系统配置 - Myriad',
    requiresAuth: true,
    requiresAdmin: true,
  },
  {
    path: '/data-management',
    component: () => import('../views/DataManagement.tsx'),
    title: '数据管理 - Myriad',
    requiresAuth: true,
    requiresAdmin: true,
  },
  {
    path: '/login',
    component: () => import('../views/Login.tsx'),
    title: '登录 - Myriad',
  },
  {
    path: '/details',
    component: () => import('../views/Details.tsx'),
    title: '详情 - Myriad',
  },
  {
    path: '/setup',
    component: () => import('../views/Setup.tsx'),
    title: '初始化设置 - Myriad',
  },
];

/**
 * 根据路径查找路由配置
 */
export function findRoute(path: string): RouteConfig | undefined {
  return routes.find(route => route.path === path);
}

/**
 * 路由动画配置
 */
export const routeAnimations = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.3, ease: 'easeInOut' },
};
