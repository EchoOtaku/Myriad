/**
 * Hello World Tapp v1.0
 * 
 * 完整展示 Tapp 的核心能力：
 * - 生命周期管理（onReady / onDestroy）
 * - 页面组件注册（支持全屏模式）
 * - 存储 API（持久化数据）
 * - 主题适配（明暗主题自动切换，使用 CSS 变量）
 * - DOM 安全 API（防 XSS 攻击）
 * - 自适应尺寸（CSS 变量 + 响应式工具类）
 * - 国际化 (i18n) 支持（中/英/日三语）
 * - 后台运行声明（background API）
 * 
 * 架构：混合模式（推荐）
 * - pageHtml: HTML 定义完整页面结构
 * - styles: CSS 定义样式（包括主题适配、动画）
 * - core: 最小 JS，仅处理 i18n 文本替换
 * - page: 生命周期钩子和事件监听
 * 
 * @version 1.0.0
 * @author Myriad Team
 * @license MIT
 */

import type { ExampleTapp, TappCodeStructure } from './types'

// ========== 页面 HTML 模板 ==========
const PAGE_HTML = `<!-- Hello World Tapp v1.0 - 混合架构 -->
<div class="hw-page">
  <!-- 背景装饰光晕 -->
  <div class="hw-bg-glow hw-glow-1"></div>
  <div class="hw-bg-glow hw-glow-2"></div>
  
  <!-- 主内容区 -->
  <main class="hw-main">
    <!-- 标题卡片 -->
    <header class="hw-header">
      <div class="hw-emoji">👋</div>
      <div class="hw-title-row">
        <h1 id="hw-title" class="hw-title">Hello World</h1>
        <span class="hw-version">v1.0.0</span>
      </div>
      <p id="hw-subtitle" class="hw-subtitle tapp-hide-compact">欢迎使用 Tapp 系统！探索下方卡片了解核心功能。</p>
    </header>
    
    <!-- 功能卡片网格 -->
    <div class="hw-grid">
      <!-- 生命周期 -->
      <article class="hw-card" data-color="#8B5CF6" style="--card-color: #8B5CF6; animation-delay: 0s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">🔄</div>
        <h3 id="hw-feat-lifecycle-title" class="hw-card-title">生命周期</h3>
        <p id="hw-feat-lifecycle-desc" class="hw-card-desc tapp-hide-compact">onReady/onDestroy 完整生命周期管理</p>
      </article>
      
      <!-- 存储 API -->
      <article class="hw-card" data-color="#F59E0B" style="--card-color: #F59E0B; animation-delay: 0.05s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">📦</div>
        <h3 id="hw-feat-storage-title" class="hw-card-title">存储 API</h3>
        <p id="hw-feat-storage-desc" class="hw-card-desc tapp-hide-compact">持久化数据存储，跨会话保持</p>
      </article>
      
      <!-- 主题适配 -->
      <article class="hw-card" data-color="#EC4899" style="--card-color: #EC4899; animation-delay: 0.1s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">🎨</div>
        <h3 id="hw-feat-theme-title" class="hw-card-title">主题适配</h3>
        <p id="hw-feat-theme-desc" class="hw-card-desc tapp-hide-compact">自动适应系统明暗主题</p>
      </article>
      
      <!-- 页面组件 -->
      <article class="hw-card" data-color="#3B82F6" style="--card-color: #3B82F6; animation-delay: 0.15s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">📄</div>
        <h3 id="hw-feat-page-title" class="hw-card-title">页面组件</h3>
        <p id="hw-feat-page-desc" class="hw-card-desc tapp-hide-compact">注册自定义页面，支持全屏模式</p>
      </article>
      
      <!-- DOM 安全 -->
      <article class="hw-card" data-color="#EF4444" style="--card-color: #EF4444; animation-delay: 0.2s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">🛡️</div>
        <h3 id="hw-feat-security-title" class="hw-card-title">DOM 安全</h3>
        <p id="hw-feat-security-desc" class="hw-card-desc tapp-hide-compact">内置 XSS 防护的安全渲染</p>
      </article>
      
      <!-- 自适应尺寸 -->
      <article class="hw-card" data-color="#14B8A6" style="--card-color: #14B8A6; animation-delay: 0.25s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">📐</div>
        <h3 id="hw-feat-responsive-title" class="hw-card-title">自适应尺寸</h3>
        <p id="hw-feat-responsive-desc" class="hw-card-desc tapp-hide-compact">CSS 变量驱动的响应式设计</p>
      </article>
      
      <!-- 国际化 -->
      <article class="hw-card" data-color="#6366F1" style="--card-color: #6366F1; animation-delay: 0.3s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">🌐</div>
        <h3 id="hw-feat-i18n-title" class="hw-card-title">国际化</h3>
        <p id="hw-feat-i18n-desc" class="hw-card-desc tapp-hide-compact">多语言支持，实时切换</p>
      </article>
      
      <!-- 后台运行 -->
      <article class="hw-card hw-card-primary" style="--card-color: var(--tapp-primary, #10B981); animation-delay: 0.35s;">
        <div class="hw-card-line"></div>
        <div class="hw-card-icon">⚡</div>
        <h3 id="hw-feat-background-title" class="hw-card-title">后台运行</h3>
        <p id="hw-feat-background-desc" class="hw-card-desc tapp-hide-compact">声明式后台需求管理</p>
      </article>
    </div>
    
    <!-- 页脚 -->
    <footer class="hw-footer tapp-hide-compact">
      <p id="hw-footer">由 Myriad Tapp 系统驱动</p>
    </footer>
  </main>
</div>
`

// ========== CSS 样式 ==========
const STYLES = `/* Hello World Tapp v1.0 - 混合架构样式 */
/* 使用 CSS 变量实现主题适配，减少 JS 依赖 */

/* ========== 页面容器 ========== */
.hw-page {
  position: relative;
  width: 100%;
  min-height: 100%;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--tapp-text);
  background: var(--tapp-bg, #0a0a0a);
  overflow-y: auto;
  overflow-x: hidden;
}

/* ========== 背景装饰光晕 ========== */
.hw-bg-glow {
  position: fixed;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
}

.hw-glow-1 {
  right: -10%;
  top: -10%;
  width: 50%;
  height: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--tapp-primary, #10B981) 12%, transparent), transparent 70%);
  filter: blur(60px);
}

.hw-glow-2 {
  left: -5%;
  bottom: -5%;
  width: 40%;
  height: 40%;
  background: radial-gradient(circle, color-mix(in srgb, var(--tapp-primary, #10B981) 8%, transparent), transparent 70%);
  filter: blur(40px);
}

/* ========== 主内容区 ========== */
.hw-main {
  position: relative;
  z-index: 1;
  max-width: 900px;
  margin: 0 auto;
  padding: calc(24px * var(--tapp-scale, 1));
}

/* ========== 标题卡片 ========== */
.hw-header {
  background: var(--tapp-card-bg);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border-radius: calc(16px * var(--tapp-scale, 1));
  border: 1px solid var(--tapp-border);
  padding: calc(24px * var(--tapp-scale, 1));
  margin-bottom: calc(24px * var(--tapp-scale, 1));
  position: relative;
  overflow: hidden;
}

.hw-emoji {
  font-size: calc(48px * var(--tapp-scale, 1));
  margin-bottom: calc(12px * var(--tapp-scale, 1));
}

.hw-title-row {
  display: flex;
  align-items: center;
  gap: calc(12px * var(--tapp-scale, 1));
  flex-wrap: wrap;
  margin-bottom: calc(8px * var(--tapp-scale, 1));
}

.hw-title {
  font-size: calc(32px * var(--tapp-font-scale, 1));
  font-weight: 800;
  margin: 0;
  color: var(--tapp-text);
}

.hw-version {
  padding: calc(4px * var(--tapp-scale, 1)) calc(10px * var(--tapp-scale, 1));
  background: color-mix(in srgb, var(--tapp-primary, #10B981) 20%, transparent);
  color: var(--tapp-primary, #10B981);
  border-radius: calc(6px * var(--tapp-scale, 1));
  font-size: calc(12px * var(--tapp-font-scale, 1));
  font-weight: 600;
}

.hw-subtitle {
  font-size: calc(14px * var(--tapp-font-scale, 1));
  color: var(--tapp-subtext);
  margin: 0;
  line-height: 1.5;
}

/* ========== 功能卡片网格 ========== */
.hw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(200px * var(--tapp-scale, 1)), 1fr));
  gap: calc(16px * var(--tapp-scale, 1));
  margin-bottom: calc(24px * var(--tapp-scale, 1));
}

/* ========== 功能卡片 ========== */
.hw-card {
  background: var(--tapp-card-bg);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border-radius: calc(12px * var(--tapp-scale, 1));
  border: 1px solid var(--tapp-border);
  padding: calc(20px * var(--tapp-scale, 1));
  cursor: default;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  animation: hw-fade-in-up 0.5s ease both;
}

.hw-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px var(--tapp-shadow, rgba(0, 0, 0, 0.2));
  border-color: color-mix(in srgb, var(--card-color, #10B981) 40%, transparent);
}

.hw-card:hover .hw-card-line {
  opacity: 1;
}

/* 卡片顶部装饰线 */
.hw-card-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--card-color, #10B981) 60%, transparent), transparent);
  opacity: 0;
  transition: opacity 0.3s;
}

.hw-card-icon {
  font-size: calc(28px * var(--tapp-scale, 1));
  margin-bottom: calc(12px * var(--tapp-scale, 1));
  display: inline-block;
}

.hw-card-title {
  font-size: calc(15px * var(--tapp-font-scale, 1));
  font-weight: 700;
  margin: 0 0 calc(6px * var(--tapp-scale, 1));
  color: var(--tapp-text);
}

.hw-card-desc {
  font-size: calc(13px * var(--tapp-font-scale, 1));
  color: var(--tapp-subtext);
  margin: 0;
  line-height: 1.5;
}

/* ========== 页脚 ========== */
.hw-footer {
  text-align: center;
  padding: calc(16px * var(--tapp-scale, 1)) 0;
}

.hw-footer p {
  margin: 0;
  font-size: calc(12px * var(--tapp-font-scale, 1));
  color: var(--tapp-subtext);
  opacity: 0.7;
}

/* ========== 动画 ========== */
@keyframes hw-fade-in-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ========== 滚动条美化 ========== */
.hw-page::-webkit-scrollbar {
  width: 6px;
}

.hw-page::-webkit-scrollbar-track {
  background: transparent;
}

.hw-page::-webkit-scrollbar-thumb {
  background: var(--tapp-border);
  border-radius: 3px;
}

.hw-page::-webkit-scrollbar-thumb:hover {
  background: var(--tapp-subtext);
}
`

// ========== 核心代码（最小 JS） ==========
const CORE_CODE = `// Hello World Tapp v1.0 - 混合架构
// 最小 JS：仅处理 i18n 文本替换

// ========== i18n 翻译表 ==========
var i18n = {
  'zh-CN': {
    title: 'Hello World',
    subtitle: '欢迎使用 Tapp 系统！探索下方卡片了解核心功能。',
    features: {
      lifecycle: { title: '生命周期', desc: 'onReady/onDestroy 完整生命周期管理' },
      storage: { title: '存储 API', desc: '持久化数据存储，跨会话保持' },
      theme: { title: '主题适配', desc: '自动适应系统明暗主题' },
      page: { title: '页面组件', desc: '注册自定义页面，支持全屏模式' },
      security: { title: 'DOM 安全', desc: '内置 XSS 防护的安全渲染' },
      responsive: { title: '自适应尺寸', desc: 'CSS 变量驱动的响应式设计' },
      i18n: { title: '国际化', desc: '多语言支持，实时切换' },
      background: { title: '后台运行', desc: '声明式后台需求管理' },
    },
    footer: '由 Myriad Tapp 系统驱动',
  },
  'en-US': {
    title: 'Hello World',
    subtitle: 'Welcome to Tapp System! Explore the cards below to discover core features.',
    features: {
      lifecycle: { title: 'Lifecycle', desc: 'onReady/onDestroy full lifecycle management' },
      storage: { title: 'Storage API', desc: 'Persistent data storage across sessions' },
      theme: { title: 'Theme Adapt', desc: 'Auto adapt to system light/dark theme' },
      page: { title: 'Page Component', desc: 'Register custom pages with fullscreen' },
      security: { title: 'DOM Security', desc: 'Built-in XSS-safe rendering' },
      responsive: { title: 'Responsive', desc: 'CSS variables driven responsive design' },
      i18n: { title: 'i18n', desc: 'Multi-language with live switch' },
      background: { title: 'Background', desc: 'Declarative background requirements' },
    },
    footer: 'Powered by Myriad Tapp System',
  },
  'ja-JP': {
    title: 'Hello World',
    subtitle: 'Tapp システムへようこそ！下のカードでコア機能をご覧ください。',
    features: {
      lifecycle: { title: 'ライフサイクル', desc: 'onReady/onDestroy 完全なライフサイクル管理' },
      storage: { title: 'ストレージ API', desc: 'セッション間で永続的なデータ保存' },
      theme: { title: 'テーマ適応', desc: 'システムテーマに自動対応' },
      page: { title: 'ページコンポーネント', desc: 'フルスクリーン対応のカスタムページ' },
      security: { title: 'DOM セキュリティ', desc: 'XSS 対策済みの安全なレンダリング' },
      responsive: { title: 'レスポンシブ', desc: 'CSS 変数駆動のレスポンシブデザイン' },
      i18n: { title: '国際化', desc: '多言語対応、リアルタイム切り替え' },
      background: { title: 'バックグラウンド', desc: '宣言的なバックグラウンド要件' },
    },
    footer: 'Myriad Tapp System で動作中',
  },
};

var currentLocale = 'zh-CN';

function normalizeLocale(locale) {
  if (!locale) return 'zh-CN';
  var l = locale.toLowerCase();
  if (l.startsWith('zh')) return 'zh-CN';
  if (l.startsWith('en')) return 'en-US';
  if (l.startsWith('ja')) return 'ja-JP';
  return 'zh-CN';
}

function t(key) {
  var keys = key.split('.');
  var value = i18n[currentLocale] || i18n['zh-CN'];
  for (var i = 0; i < keys.length; i++) {
    value = value[keys[i]];
    if (!value) return key;
  }
  return value;
}

// 更新页面文本（i18n）
function updateTexts() {
  var el;
  
  // 标题区域
  el = document.getElementById('hw-title');
  if (el) Tapp.dom.setText(el, t('title'));
  
  el = document.getElementById('hw-subtitle');
  if (el) Tapp.dom.setText(el, t('subtitle'));
  
  // 功能卡片
  var features = ['lifecycle', 'storage', 'theme', 'page', 'security', 'responsive', 'i18n', 'background'];
  features.forEach(function(key) {
    el = document.getElementById('hw-feat-' + key + '-title');
    if (el) Tapp.dom.setText(el, t('features.' + key + '.title'));
    
    el = document.getElementById('hw-feat-' + key + '-desc');
    if (el) Tapp.dom.setText(el, t('features.' + key + '.desc'));
  });
  
  // 页脚
  el = document.getElementById('hw-footer');
  if (el) Tapp.dom.setText(el, t('footer'));
}
`

// ========== 页面代码 ==========
const PAGE_CODE = `// Hello World Tapp v1.0 - Page 生命周期
// 混合架构：HTML 已由框架注入，JS 仅处理初始化和事件

var isPaused = false;

Tapp.lifecycle.onReady(async function() {
  try {
    // 获取当前语言并更新文本
    var locale = await Tapp.ui.getLocale();
    currentLocale = normalizeLocale(locale);
    updateTexts();
    
    // 监听语言变化
    Tapp.ui.onLocaleChange(function(newLocale) {
      currentLocale = normalizeLocale(newLocale);
      updateTexts();
    });
    
    console.log('[Hello World] v1.0 混合架构初始化完成');
  } catch (error) {
    console.error('[Hello World] 初始化失败:', error);
  }
});

// 🎯 页面不可见时暂停（冻结）
Tapp.lifecycle.onPause(function() {
  isPaused = true;
  console.log('[Hello World] 页面已暂停');
});

// 🎯 页面恢复可见时恢复
Tapp.lifecycle.onResume(function() {
  isPaused = false;
  console.log('[Hello World] 页面已恢复');
});

Tapp.lifecycle.onDestroy(async function() {
  // 清理资源（如有需要）
});
`

// ========== 导出 Tapp 定义 ==========
const codeStructure: TappCodeStructure = {
  core: CORE_CODE,
  page: PAGE_CODE,
  styles: STYLES,
  pageHtml: PAGE_HTML,
}

export const helloWorldTapp: ExampleTapp = {
  manifest: {
    id: 'com.myriad.hello-world',
    name: 'Hello World',
    version: '1.0.0',
    description: '官方入门示例：展示 Tapp 核心功能（混合架构）。',
    main: 'index.js',
    author: { 
      name: 'Myriad Team',
      email: 'tapp@myriad.app',
      url: 'https://github.com/Myriad-You',
    },
    permissions: ['storage', 'ui:theme'],
    icon: '👋',
    themeColor: '#10B981',
    hasPage: true,
  },
  code: codeStructure,
  category: 'demo',
  tags: ['official', 'beginner', 'lifecycle', 'storage', 'page-component', 'responsive', 'i18n', 'glass-ui', 'hybrid-architecture'],
}
