/**
 * Tapp SDK 代码生成器
 *
 * 生成注入到沙箱的 SDK 代码
 *
 * 安全特性：
 * - 所有 API 对象被冻结，防止篡改
 * - 使用 session token 验证消息来源
 * - 存储 key 验证防止路径遍历
 * - 完整的对象冻结包括 widgets/pages
 *
 * 🎯 性能优化：
 * - SDK 模板预生成（静态部分只计算一次）
 * - 使用占位符替换而非字符串拼接
 * - 存储 key 验证器代码缓存
 */

import type { TappInstance } from '../../types'

// ========================
// 🎯 预缓存的静态代码片段
// ========================

/**
 * 存储 key 验证器代码（预生成，避免重复计算）
 */
const STORAGE_KEY_VALIDATOR_CODE = `
  const validateStorageKey = (key) => {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string');
    }
    if (key.length > 256) {
      throw new Error('Storage key too long (max 256 chars)');
    }
    if (key.includes('..') || key.includes('/') || key.includes('\\\\')) {
      throw new Error('Storage key contains invalid path characters');
    }
    if (key.startsWith('.') || key.endsWith('.')) {
      throw new Error('Storage key cannot start or end with a dot');
    }
    if (!/^[\\w.\\-:]+$/.test(key)) {
      throw new Error('Storage key contains invalid characters');
    }
    return key;
  };
`

/**
 * 生成存储 key 验证代码（使用缓存）
 */
function generateStorageKeyValidator(): string {
  return STORAGE_KEY_VALIDATOR_CODE
}

/**
 * 生成完整版 SDK（用于 Page 模式）
 *
 * @param tappInstance - Tapp 实例
 * @param sessionToken - 会话 token（用于消息验证）
 */
export function generateFullSDK(
  tappInstance: TappInstance,
  sessionToken?: string,
): string {
  const { id, manifest, grantedPermissions } = tappInstance
  const token = sessionToken || ''

  return `
(() => {
  'use strict';

  // 会话 token（用于消息验证）
  const _SESSION_TOKEN = '${token}';

  let messageIdCounter = 0;
  const pendingRequests = new Map();
  const eventListeners = new Map();
  const lifecycleCallbacks = { ready: [], destroy: [], pause: [], resume: [] };

  // 🎯 事件缓冲区：缓存最新的有状态事件，新监听器注册时立即回放
  // 解决父窗口推送 mediaStateChange 早于 Tapp 代码注册 onStateChange 的竞态问题
  const _eventBuffer = new Map();
  const _BUFFERED_EVENTS = new Set(['mediaStateChange', 'mediaProgress', 'themeChange', 'primaryColorChange', 'localeChange']);
  const _ACTION_TO_EVENT = { 'theme:change': 'themeChange', 'locale:change': 'localeChange', 'primaryColor:change': 'primaryColorChange' };

  // WebKit 专用沙箱会在注入 HTML 时显式设置该标记，避免 UA 嗅探。
  // 在 WebKit iframe 上，频繁切换 transform 合成层可能触发“空白/不绘制”回归。
  const _forceRepaint = function () {
    void document.body.offsetHeight;
    if (window._TAPP_DISABLE_TRANSFORM_REPAINT) return;
    try {
      requestAnimationFrame(function () {
        document.body.style.transform = 'translateZ(0)';
        requestAnimationFrame(function () {
          document.body.style.transform = '';
        });
      });
    } catch (e) {
      // ignore
    }
  };

  const generateId = () => \`tapp-\${++messageIdCounter}-\${Date.now()}\`;

  ${generateStorageKeyValidator()}

  const sendRequest = (api, method, args = []) => {
    return new Promise((resolve, reject) => {
      const id = generateId();
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 30000);

      pendingRequests.set(id, { resolve, reject, timeout });

      // 消息中包含 session token 用于验证
      window.parent.postMessage({
        type: 'request',
        id,
        action: \`\${api}.\${method}\`,
        payload: { api, method, args },
        source: '${id}',
        timestamp: Date.now(),
        _sessionToken: _SESSION_TOKEN,
      }, '*');
    });
  };

  window.addEventListener('message', (event) => {
    const { data: message } = event;
    if (!message?.type) return;

    if (message.type === 'response') {
      const pending = pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(message.id);
        if (message.payload?.success) {
          pending.resolve(message.payload.data);
        } else {
          pending.reject(new Error(message.payload?.error || 'Unknown error'));
        }
      }
    } else if (message.type === 'AGENT_FILL_DATA') {
      // 🤖 Agent 数据填充请求
      const data = message.data;
      if (data && typeof data === 'object') {
        eventListeners.get('agentFill')?.forEach((cb) => { try { cb(data); } catch (e) {} });
        // 自动填充表单字段
        Object.entries(data).forEach(([key, value]) => {
          const el = document.querySelector(\`[name="\${key}"]\`) ||
                     document.querySelector(\`#\${key}\`) ||
                     document.querySelector(\`[data-field="\${key}"]\`);
          if (el) {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.value = String(value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el instanceof HTMLSelectElement) {
              el.value = String(value);
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              el.textContent = String(value);
            }
          }
        });
      }
    } else if (message.type === 'AGENT_READ_DATA') {
      // 🤖 Agent 数据读取请求
      const fields = message.fields;
      const result = {};

      // 收集表单数据
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        const formData = new FormData(form);
        formData.forEach((value, key) => {
          if (!fields || fields.includes(key)) {
            result[key] = value;
          }
        });
      });

      // 收集指定字段
      if (fields && Array.isArray(fields)) {
        fields.forEach(field => {
          if (result[field] === undefined) {
            const el = document.querySelector(\`[name="\${field}"]\`) ||
                       document.querySelector(\`#\${field}\`) ||
                       document.querySelector(\`[data-field="\${field}"]\`);
            if (el) {
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
                result[field] = el.value;
              } else {
                result[field] = el.textContent;
              }
            }
          }
        });
      }

      // 回复数据给父窗口
      window.parent.postMessage({
        type: 'AGENT_READ_DATA_RESPONSE',
        data: result,
        source: '${id}',
        _sessionToken: _SESSION_TOKEN,
      }, '*');
    } else if (message.type === 'event') {
      // 缓存有状态事件的最新值（统一映射为 camelCase key，与 addEventListener 回放一致）
      const _bufKey = _ACTION_TO_EVENT[message.action] || message.action;
      if (_BUFFERED_EVENTS.has(_bufKey)) {
        _eventBuffer.set(_bufKey, message.payload);
      }
      const listeners = eventListeners.get(message.action);
      listeners?.forEach((cb) => { try { cb(message.payload); } catch (e) {} });

      if (message.action === 'lifecycle:destroy') lifecycleCallbacks.destroy.forEach((cb) => cb());
      else if (message.action === 'lifecycle:pause') lifecycleCallbacks.pause.forEach((cb) => cb());
      else if (message.action === 'lifecycle:resume') lifecycleCallbacks.resume.forEach((cb) => cb());
      else if (message.action === 'theme:change') {
        const isDark = message.payload === 'dark';
        eventListeners.get('themeChange')?.forEach((cb) => cb(message.payload));
        // 更新 body class 和 CSS 变量
        document.body.classList.toggle('dark', isDark);
        document.body.classList.toggle('light', !isDark);
        const root = document.documentElement;
        root.style.setProperty('--tapp-text', isDark ? '#f3f4f6' : '#1f2937');
        root.style.setProperty('--tapp-subtext', isDark ? '#9ca3af' : '#6b7280');
        root.style.setProperty('--tapp-bg', isDark ? '#0a0a0a' : '#f8fafc');
        root.style.setProperty('--tapp-card-bg', isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)');
        root.style.setProperty('--tapp-border', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
        root.style.setProperty('--tapp-input-bg', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)');
        root.style.setProperty('--tapp-shadow', isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.08)');
        // 语义色彩变量（供 Tapp CSS 使用）
        root.style.setProperty('--text-primary', isDark ? 'rgba(255,255,255,.92)' : '#1a1a1a');
        root.style.setProperty('--text-secondary', isDark ? 'rgba(255,255,255,.5)' : '#999');
        root.style.setProperty('--bg-primary', isDark ? '#0a0a0a' : '#fff');
        document.body.style.background = isDark ? '#0a0a0a' : '#fff';
        document.body.style.color = isDark ? 'rgba(255,255,255,.92)' : '#1a1a1a';
        // 🎯 强制触发重绘（WebKit 走保守路径）
        _forceRepaint();
      }
      else if (message.action === 'locale:change') eventListeners.get('localeChange')?.forEach((cb) => cb(message.payload));
      else if (message.action === 'primaryColor:change') {
        eventListeners.get('primaryColorChange')?.forEach((cb) => cb(message.payload));
        // 更新 CSS 变量
        if (message.payload) {
          document.documentElement.style.setProperty('--tapp-primary', message.payload);
          // 🎯 强制触发重绘（WebKit 走保守路径）
          _forceRepaint();
        }
      }
    }
  });

  const addEventListener = (event, callback) => {
    let listeners = eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      eventListeners.set(event, listeners);
    }
    listeners.add(callback);
    // 🎯 回放缓冲区：如果已有该事件的最新值，立即调用回调
    const buffered = _eventBuffer.get(event);
    if (buffered !== undefined) {
      try { callback(buffered); } catch (e) {}
    }
    return () => listeners.delete(callback);
  };

  const Tapp = {
    id: '${id}',
    version: '${manifest.version}',
    name: '${manifest.name}',
    permissions: ${JSON.stringify(grantedPermissions)},

    lifecycle: {
      onReady: (cb) => lifecycleCallbacks.ready.push(cb),
      onDestroy: (cb) => lifecycleCallbacks.destroy.push(cb),
      onPause: (cb) => lifecycleCallbacks.pause.push(cb),
      onResume: (cb) => lifecycleCallbacks.resume.push(cb),
      getInfo: () => ({ id: '${id}', version: '${manifest.version}', name: '${manifest.name}', permissions: ${JSON.stringify(grantedPermissions)}, sandboxed: true }),
      _notifyError: (err) => sendRequest('lifecycle', 'error', [err.message || String(err)]),
      _notifyReady: () => {
        if (window._TAPP_SKIP_READY) { sendRequest('lifecycle', 'ready', []); return; }
        sendRequest('lifecycle', 'ready', []);
        lifecycleCallbacks.ready.forEach((cb) => cb());
      },
    },

    widget: {
      register: (cfg) => sendRequest('widget', 'register', [cfg]),
      unregister: (id) => sendRequest('widget', 'unregister', [id]),
      listRegistered: () => sendRequest('widget', 'listRegistered', []),
      updateConfig: (id, cfg) => sendRequest('widget', 'updateConfig', [id, cfg]),
    },

    tappList: {
      list: () => sendRequest('tappList', 'list', []),
      get: (id) => sendRequest('tappList', 'get', [id]),
      getRecent: (limit) => sendRequest('tappList', 'getRecent', [limit]),
      install: (req) => sendRequest('tappList', 'install', [req]),
      uninstall: (id) => sendRequest('tappList', 'uninstall', [id]),
      start: (id) => sendRequest('tappList', 'start', [id]),
      stop: (id) => sendRequest('tappList', 'stop', [id]),
      export: (id) => sendRequest('tappList', 'export', [id]),
    },

    brewList: {
      // 读取
      list: (o) => sendRequest('brewList', 'list', [o]),
      get: (id) => sendRequest('brewList', 'get', [id]),
      sources: () => sendRequest('brewList', 'sources', []),
      categories: () => sendRequest('brewList', 'categories', []),
      stats: () => sendRequest('brewList', 'stats', []),
      discover: (url) => sendRequest('brewList', 'discover', [url]),
      exportOpml: () => sendRequest('brewList', 'exportOpml', []),
      // 写入
      markRead: (id) => sendRequest('brewList', 'markRead', [id]),
      markUnread: (id) => sendRequest('brewList', 'markUnread', [id]),
      star: (id) => sendRequest('brewList', 'star', [id]),
      unstar: (id) => sendRequest('brewList', 'unstar', [id]),
      markAllRead: (o) => sendRequest('brewList', 'markAllRead', [o]),
      // 评论
      getComments: (itemId) => sendRequest('brewList', 'getComments', [itemId]),
      createComment: (itemId, req) => sendRequest('brewList', 'createComment', [itemId, req]),
      updateComment: (commentId, req) => sendRequest('brewList', 'updateComment', [commentId, req]),
      deleteComment: (commentId) => sendRequest('brewList', 'deleteComment', [commentId]),
      getReplies: (commentId) => sendRequest('brewList', 'getReplies', [commentId]),
      createReply: (itemId, parentId, content) => sendRequest('brewList', 'createReply', [itemId, parentId, content]),
      // 管理
      addSource: (req) => sendRequest('brewList', 'addSource', [req]),
      updateSource: (id, req) => sendRequest('brewList', 'updateSource', [id, req]),
      deleteSource: (id) => sendRequest('brewList', 'deleteSource', [id]),
      refreshSource: (id) => sendRequest('brewList', 'refreshSource', [id]),
      importOpml: (opml) => sendRequest('brewList', 'importOpml', [opml]),
      createCategory: (req) => sendRequest('brewList', 'createCategory', [req]),
      deleteCategory: (id) => sendRequest('brewList', 'deleteCategory', [id]),
    },

    platform: {
      listEnabled: () => sendRequest('platform', 'listEnabled', []),
      getData: (p, o) => sendRequest('platform', 'getData', [p, o]),
      getStats: (p) => sendRequest('platform', 'getStats', [p]),
      getDistribution: (p, d) => sendRequest('platform', 'getDistribution', [p, d]),
      addItem: (d) => sendRequest('platform', 'addItem', [d]),
      addItems: (i) => sendRequest('platform', 'addItems', [i]),
      registerPlatform: (c) => sendRequest('platform', 'registerPlatform', [c]),
    },

    ai: {
      generate: (r) => sendRequest('ai', 'generate', [r]),
      analyze: (r) => sendRequest('ai', 'analyze', [r]),
      getQuota: () => sendRequest('ai', 'getQuota', []),
      canGenerate: () => sendRequest('ai', 'canGenerate', []),
      chat: (m, c, o) => sendRequest('ai', 'chat', [{ messages: m, context: c, options: o }]),
      image: (r) => sendRequest('ai', 'image', [r]),
    },

    report: {
      listReports: () => sendRequest('report', 'listReports', []),
      getReport: (id) => sendRequest('report', 'getReport', [id]),
      getPlatformReport: (p) => sendRequest('report', 'getPlatformReport', [p]),
      create: (t, rt, c, m) => sendRequest('report', 'create', [{ title: t, reportType: rt, content: c, metadata: m }]),
      list: () => sendRequest('report', 'list', []),
      get: (id) => sendRequest('report', 'get', [{ reportId: id }]),
      update: (id, t, c, m) => sendRequest('report', 'update', [{ reportId: id, title: t, content: c, metadata: m }]),
      delete: (id) => sendRequest('report', 'delete', [{ reportId: id }]),
    },

    storage: {
      get: (k) => { validateStorageKey(k); return sendRequest('storage', 'get', [k]); },
      set: (k, v) => { validateStorageKey(k); return sendRequest('storage', 'set', [k, v]); },
      remove: (k) => { validateStorageKey(k); return sendRequest('storage', 'remove', [k]); },
      keys: () => sendRequest('storage', 'keys', []),
      clear: () => sendRequest('storage', 'clear', []),
      usage: () => sendRequest('storage', 'usage', []),
    },

    settings: {
      get: (k) => { validateStorageKey(k); return sendRequest('storage', 'get', [\`_settings.\${k}\`]); },
      set: (k, v) => { validateStorageKey(k); return sendRequest('storage', 'set', [\`_settings.\${k}\`, v]); },
      async getAll() {
        const keys = await sendRequest('storage', 'keys', []);
        const sKeys = (keys || []).filter((k) => k.startsWith('_settings.'));
        const result = {};
        for (const k of sKeys) {
          result[k.replace('_settings.', '')] = await sendRequest('storage', 'get', [k]);
        }
        return result;
      },
    },

    ui: {
      setTitle: (t) => sendRequest('ui', 'setTitle', [t]),
      getTheme: () => sendRequest('ui', 'getTheme', []),
      onThemeChange: (cb) => addEventListener('themeChange', cb),
      getPrimaryColor: () => sendRequest('ui', 'getPrimaryColor', []),
      onPrimaryColorChange: (cb) => addEventListener('primaryColorChange', cb),
      getLocale: () => sendRequest('ui', 'getLocale', []),
      onLocaleChange: (cb) => addEventListener('localeChange', cb),
      showNotification: (o) => sendRequest('ui', 'showNotification', [o]),
      confirm: (m) => sendRequest('ui', 'confirm', [m]),
      requestFullscreen: () => sendRequest('ui', 'requestFullscreen', []),
      exitFullscreen: () => sendRequest('ui', 'exitFullscreen', []),
      fullscreen: {
        request: () => sendRequest('ui', 'requestFullscreen', []),
        exit: () => sendRequest('ui', 'exitFullscreen', []),
        toggle: () => sendRequest('ui', 'toggleFullscreen', []),
        isFullscreen: () => sendRequest('ui', 'isFullscreen', []),
      },
    },

    data: { transform: (r) => sendRequest('data', 'transform', [r]) },

    // Tapp API 声明系统：调用 manifest 中声明的 API
    // 支持两种访问级别：
    // - public: 所有用户（包括游客）可调用
    // - protected: 需要 network:fetch 权限
    api: (name, params) => sendRequest('api', 'execute', [name, params]),

    context: {
      getApp: () => sendRequest('context', 'getApp', []),
      getUser: () => sendRequest('context', 'getUser', []),
      getPlayer: () => sendRequest('context', 'getPlayer', []),
      getNavigation: () => sendRequest('context', 'getNavigation', []),
      getSystem: () => sendRequest('context', 'getSystem', []),
      // 获取客户端地理位置信息（公开 API，所有用户可调用）
      getGeo: () => sendRequest('context', 'getGeo', []),
    },

    media: {
      play: () => sendRequest('media', 'control', [{ action: 'play' }]),
      pause: () => sendRequest('media', 'control', [{ action: 'pause' }]),
      next: () => sendRequest('media', 'control', [{ action: 'next' }]),
      prev: () => sendRequest('media', 'control', [{ action: 'prev' }]),
      seek: (p) => sendRequest('media', 'control', [{ action: 'seek', value: p }]),
      setVolume: (v) => sendRequest('media', 'control', [{ action: 'volume', value: v }]),
      setMode: (m) => sendRequest('media', 'control', [{ action: 'mode', value: m }]),
      mute: () => sendRequest('media', 'control', [{ action: 'mute' }]),
      unmute: () => sendRequest('media', 'control', [{ action: 'unmute' }]),
      getStatus: () => sendRequest('media', 'getStatus', []),
      getPlaylist: () => sendRequest('media', 'getPlaylist', []),
      getSpectrum: () => sendRequest('media', 'getSpectrum', []),
      playTrack: (id, idx) => sendRequest('media', 'playTrack', [{ trackId: id, trackIndex: idx }]),
      jumpToIndex: (idx) => sendRequest('media', 'jumpToIndex', [{ index: idx }]),
      loadNeteasePlaylist: (playlistId) => sendRequest('media', 'loadNeteasePlaylist', [{ playlistId }]),
      onStateChange: (cb) => addEventListener('mediaStateChange', cb),
      onProgress: (cb) => addEventListener('mediaProgress', cb),
    },

    component: {
      registerTheme: (c) => sendRequest('component', 'registerTheme', [c]),
      registerAgent: (c) => sendRequest('component', 'registerAgent', [c]),
      unregister: (t, id) => sendRequest('component', 'unregister', [t, id]),
      list: (t) => sendRequest('component', 'list', [t]),
    },

    shortcut: {
      register: (c) => sendRequest('shortcut', 'register', [c]),
      unregister: (id) => sendRequest('shortcut', 'unregister', [id]),
      list: () => sendRequest('shortcut', 'list', []),
    },

    // 🤖 Agent 交互 API - 允许 Tapp 与 Agent 进行数据交互
    agent: {
      // 监听 Agent 填充数据事件
      onFill: (cb) => addEventListener('agentFill', cb),
      // 向 Agent 报告表单数据
      reportData: (data) => {
        window.parent.postMessage({
          type: 'AGENT_TAPP_DATA',
          data: data,
          source: '${id}',
          _sessionToken: _SESSION_TOKEN,
        }, '*');
      },
      // 请求 Agent 执行操作
      requestAction: (action, params) => {
        return sendRequest('agent', 'action', [action, params]);
      },
    },

    event: {
      publish: (t, p, tgt) => sendRequest('event', 'publish', [t, p, tgt]),
      subscribe: (ts) => sendRequest('event', 'subscribe', [ts]),
      unsubscribe: (ts) => sendRequest('event', 'unsubscribe', [ts]),
      on: (t, cb) => addEventListener(\`tapp:\${t}\`, cb),
    },

    dom: {
      escapeHtml(text) {
        if (text == null) return '';
        const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '/': '&#x2F;', '\`': '&#x60;', '=': '&#x3D;' };
        return String(text).replace(/[&<>"'\`=\\/]/g, (c) => htmlEscapes[c]);
      },
      setText: (el, t) => { if (el?.textContent !== undefined) el.textContent = t; },
      setSafeHtml: (el, h) => { if (el?.innerHTML !== undefined) el.innerHTML = Tapp.dom.escapeHtml(h); },
      createTextNode: (t) => document.createTextNode(t),
      setAttribute(el, n, v) {
        if (!el?.setAttribute) return;
        const ln = n.toLowerCase();
        const danger = ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup'];
        if (danger.includes(ln)) return;
        const sv = String(v).toLowerCase().trim();
        if (['href', 'src', 'action'].includes(ln) && (sv.startsWith('javascript:') || sv.startsWith('data:text/html') || sv.startsWith('vbscript:'))) return;
        el.setAttribute(n, v);
      },
      createElement(tag, opts) {
        const el = document.createElement(tag);
        if (opts) {
          if (opts.text) el.textContent = opts.text;
          if (opts.className) el.className = opts.className;
          if (opts.attributes) Object.entries(opts.attributes).forEach(([k, v]) => Tapp.dom.setAttribute(el, k, v));
        }
        return el;
      },
      renderList(container, items, renderItem) {
        if (!container) return;
        container.innerHTML = '';
        items.forEach((item, i) => { const el = renderItem(item, i); if (el) container.appendChild(el); });
      },
    },

    file: {
      download: (content, filename, mimeType) => sendRequest('file', 'download', [{ content, filename, mimeType }]),
    },

    user: {
      getRole: () => sendRequest('user', 'getRole', []),
      isAdmin: () => sendRequest('user', 'isAdmin', []),
      isGuest: () => sendRequest('user', 'isGuest', []),
      isLoggedIn: () => sendRequest('user', 'isLoggedIn', []),
      getAllowedPermissionLevels: () => sendRequest('user', 'getAllowedPermissionLevels', []),
      canUsePermissionLevel: (l) => sendRequest('user', 'canUsePermissionLevel', [l]),
    },

    background: {
      require: (r, reason) => sendRequest('background', 'require', [r, reason]),
      release: (r) => sendRequest('background', 'release', [r]),
      list: () => sendRequest('background', 'list', []),
      has: (r) => sendRequest('background', 'has', [r]),
    },

    dynamicContent: {
      set: (c) => sendRequest('dynamicContent', 'set', [c]),
      update: (u) => sendRequest('dynamicContent', 'update', [u]),
      get: () => sendRequest('dynamicContent', 'get', []),
      remove: () => sendRequest('dynamicContent', 'remove', []),
    },

    animation: {
      getLevel: () => sendRequest('animation', 'getLevel', []),
      shouldAnimate: () => sendRequest('animation', 'shouldAnimate', []),
      getConfig: () => sendRequest('animation', 'getConfig', []),
      getStaggerDelay: (i, d) => sendRequest('animation', 'getStaggerDelay', [i, d]),
      onLevelChange: (cb) => addEventListener('animationLevelChange', cb),
    },

    speech: {
      tts: (r) => sendRequest('speech', 'tts', [r]),
      getVoices: () => sendRequest('speech', 'getVoices', []),
      getStatus: () => sendRequest('speech', 'getStatus', []),
      asr: (r) => sendRequest('speech', 'asr', [r]),
    },

    federation: {
      // 时间线
      getTimeline: () => sendRequest('federation', 'getTimeline', []),
      // 关注
      follow: (target) => sendRequest('federation', 'follow', [target]),
      unfollow: (target) => sendRequest('federation', 'unfollow', [target]),
      getFollowing: () => sendRequest('federation', 'getFollowing', []),
      getFollowers: () => sendRequest('federation', 'getFollowers', []),
      // 发布
      publish: (req) => sendRequest('federation', 'publish', [req]),
      unpublish: (req) => sendRequest('federation', 'unpublish', [req]),
      getPublished: () => sendRequest('federation', 'getPublished', []),
      // Channel
      getChannels: () => sendRequest('federation', 'getChannels', []),
      getChannel: (id) => sendRequest('federation', 'getChannel', [id]),
      createChannel: (req) => sendRequest('federation', 'createChannel', [req]),
      acceptChannel: (id) => sendRequest('federation', 'acceptChannel', [id]),
      closeChannel: (id) => sendRequest('federation', 'closeChannel', [id]),
      getMessages: (channelId, before, limit) => sendRequest('federation', 'getMessages', [channelId, before, limit]),
      sendMessage: (channelId, req) => sendRequest('federation', 'sendMessage', [channelId, req]),
      // Room
      getRooms: () => sendRequest('federation', 'getRooms', []),
      getRoom: (id) => sendRequest('federation', 'getRoom', [id]),
      createRoom: (req) => sendRequest('federation', 'createRoom', [req]),
      updateRoom: (id, req) => sendRequest('federation', 'updateRoom', [id, req]),
      getRoomMembers: (roomId) => sendRequest('federation', 'getRoomMembers', [roomId]),
      getRoomMessages: (roomId, before, limit) => sendRequest('federation', 'getRoomMessages', [roomId, before, limit]),
      sendRoomMessage: (roomId, req) => sendRequest('federation', 'sendRoomMessage', [roomId, req]),
      pinRoomMessage: (roomId, messageId, pinned) => sendRequest('federation', 'pinRoomMessage', [roomId, messageId, pinned]),
      inviteMember: (roomId, req) => sendRequest('federation', 'inviteMember', [roomId, req]),
      removeMember: (roomId, actorUrl) => sendRequest('federation', 'removeMember', [roomId, actorUrl]),
      leaveRoom: (roomId) => sendRequest('federation', 'leaveRoom', [roomId]),
      deleteRoom: (roomId) => sendRequest('federation', 'deleteRoom', [roomId]),
      // Ring
      getRings: () => sendRequest('federation', 'getRings', []),
      getRing: (id) => sendRequest('federation', 'getRing', [id]),
      getRingPeers: (id) => sendRequest('federation', 'getRingPeers', [id]),
      createRing: (req) => sendRequest('federation', 'createRing', [req]),
      leaveRing: (ringId) => sendRequest('federation', 'leaveRing', [ringId]),
      addPeer: (ringId, req) => sendRequest('federation', 'addPeer', [ringId, req]),
      removePeer: (ringId, peerUrl) => sendRequest('federation', 'removePeer', [ringId, peerUrl]),
      triggerSync: (ringId) => sendRequest('federation', 'triggerSync', [ringId]),
      // Trust 策略
      getTrustPolicy: () => sendRequest('federation', 'getTrustPolicy', []),
      getInstances: () => sendRequest('federation', 'getInstances', []),
      updateInstanceTrust: (req) => sendRequest('federation', 'updateInstanceTrust', [req]),
      toggleInstanceBlock: (req) => sendRequest('federation', 'toggleInstanceBlock', [req]),
      // 文件传输
      initiateTransfer: (channelId, req) => sendRequest('federation', 'initiateTransfer', [channelId, req]),
      listTransfers: (channelId) => sendRequest('federation', 'listTransfers', [channelId]),
      getTransfer: (transferId) => sendRequest('federation', 'getTransfer', [transferId]),
      uploadChunk: (transferId, req) => sendRequest('federation', 'uploadChunk', [transferId, req]),
      cancelTransfer: (transferId) => sendRequest('federation', 'cancelTransfer', [transferId]),
      // 实时订阅
      subscribeChannel: (channelId) => sendRequest('federation', 'subscribeChannel', [channelId]),
      unsubscribeChannel: (channelId) => sendRequest('federation', 'unsubscribeChannel', [channelId]),
      subscribeRoom: (roomId) => sendRequest('federation', 'subscribeRoom', [roomId]),
      unsubscribeRoom: (roomId) => sendRequest('federation', 'unsubscribeRoom', [roomId]),
      // 事件
      onMessage: (cb) => addEventListener('federation:message', cb),
      onChannelUpdate: (cb) => addEventListener('federation:channelUpdate', cb),
      onRoomUpdate: (cb) => addEventListener('federation:roomUpdate', cb),
    },

    on: addEventListener,
    widgets: {},
    pages: {},
  };

  // 冻结所有 API 对象（防止篡改）
  Object.freeze(Tapp);
  Object.freeze(Tapp.lifecycle);
  Object.freeze(Tapp.widget);
  Object.freeze(Tapp.tappList);
  Object.freeze(Tapp.brewList);
  Object.freeze(Tapp.platform);
  Object.freeze(Tapp.ai);
  Object.freeze(Tapp.report);
  Object.freeze(Tapp.storage);
  Object.freeze(Tapp.settings);
  Object.freeze(Tapp.ui);
  Object.freeze(Tapp.ui.fullscreen);
  Object.freeze(Tapp.fetch);
  Object.freeze(Tapp.data);
  Object.freeze(Tapp.context);
  Object.freeze(Tapp.media);
  Object.freeze(Tapp.component);
  Object.freeze(Tapp.shortcut);
  Object.freeze(Tapp.event);
  Object.freeze(Tapp.dom);
  Object.freeze(Tapp.file);
  Object.freeze(Tapp.user);
  Object.freeze(Tapp.background);
  Object.freeze(Tapp.dynamicContent);
  Object.freeze(Tapp.animation);
  Object.freeze(Tapp.speech);
  Object.freeze(Tapp.federation);

  // 🔒 冻结 widgets 和 pages 容器（Tapp 代码可以添加内容，但不能替换整个对象）
  // 使用 Object.seal 允许添加属性但禁止删除
  Object.seal(Tapp.widgets);
  Object.seal(Tapp.pages);

  // 防止通过原型链篡改
  Object.freeze(Object.getPrototypeOf(Tapp));

  window.Tapp = Tapp;

  // 防止重新定义 Tapp
  Object.defineProperty(window, 'Tapp', {
    value: Tapp,
    writable: false,
    configurable: false
  });

  setTimeout(() => Tapp.lifecycle._notifyReady(), 0);
})();
`
}

/**
 * 生成精简版 SDK（用于 Widget 模式）
 *
 * @param tappInstance - Tapp 实例
 * @param sessionToken - 会话 token（用于消息验证）
 */
export function generateWidgetSDK(
  tappInstance: TappInstance,
  sessionToken?: string,
): string {
  const { id, manifest, grantedPermissions } = tappInstance
  const token = sessionToken || ''

  return `
(function() {
  'use strict';

  // 会话 token（用于消息验证）
  var _SESSION_TOKEN = '${token}';

  var messageIdCounter = 0;
  var pendingRequests = new Map();
  var eventListeners = new Map();
  // 🎯 添加生命周期回调支持
  var lifecycleCallbacks = { pause: [], resume: [] };

  // 🎯 事件缓冲区：缓存最新的有状态事件，新监听器注册时立即回放
  var _eventBuffer = new Map();
  var _BUFFERED_EVENTS = { mediaStateChange: 1, mediaProgress: 1, themeChange: 1, primaryColorChange: 1, localeChange: 1 };
  var _ACTION_TO_EVENT = { 'theme:change': 'themeChange', 'locale:change': 'localeChange', 'primaryColor:change': 'primaryColorChange' };

  var generateId = function() { return 'widget-' + (++messageIdCounter) + '-' + Date.now(); };

  // 存储 key 验证
  var validateStorageKey = function(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string');
    }
    if (key.length > 256) {
      throw new Error('Storage key too long (max 256 chars)');
    }
    if (key.indexOf('..') >= 0 || key.indexOf('/') >= 0 || key.indexOf('\\\\') >= 0) {
      throw new Error('Storage key contains invalid path characters');
    }
    if (key.charAt(0) === '.' || key.charAt(key.length - 1) === '.') {
      throw new Error('Storage key cannot start or end with a dot');
    }
    if (!/^[\\w.\\-:]+$/.test(key)) {
      throw new Error('Storage key contains invalid characters');
    }
    return key;
  };

  var sendRequest = function(api, method, args) {
    args = args || [];
    return new Promise(function(resolve, reject) {
      var id = generateId();
      var timeout = setTimeout(function() { pendingRequests.delete(id); reject(new Error('Request timeout')); }, 30000);
      pendingRequests.set(id, { resolve: resolve, reject: reject, timeout: timeout });
      try {
        window.parent.postMessage({
          type: 'request',
          id: id,
          action: api + '.' + method,
          payload: { api: api, method: method, args: args },
          timestamp: Date.now(),
          _sessionToken: _SESSION_TOKEN
        }, '*');
      } catch (e) { clearTimeout(timeout); pendingRequests.delete(id); reject(e); }
    });
  };

  var addEventListener = function(event, callback) {
    var listeners = eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      eventListeners.set(event, listeners);
    }
    listeners.add(callback);
    // 🎯 回放缓冲区：如果已有该事件的最新值，立即调用回调
    var buffered = _eventBuffer.get(event);
    if (buffered !== undefined) {
      try { callback(buffered); } catch(e) {}
    }
    return function() { listeners.delete(callback); };
  };

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg) return;

    // 处理响应
    if (msg.type === 'response') {
      var pending = pendingRequests.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingRequests.delete(msg.id);
      var payload = msg.payload || {};
      if (payload.success) { pending.resolve(payload.data); } else { pending.reject(new Error(payload.error || 'Request failed')); }
    }

    // 处理事件
    if (msg.type === 'event') {
      // 🎯 缓存有状态事件的最新值（供 addEventListener 回放，统一 camelCase key）
      var _bufKey = _ACTION_TO_EVENT[msg.action] || msg.action;
      if (_BUFFERED_EVENTS[_bufKey]) {
        _eventBuffer.set(_bufKey, msg.payload);
      }
      // 🎯 强制重绘辅助函数：WebKit 专用沙箱会设置 window._TAPP_DISABLE_TRANSFORM_REPAINT
      var forceRepaint = function () {
        void document.body.offsetHeight;
        if (window._TAPP_DISABLE_TRANSFORM_REPAINT) return;
        try {
          requestAnimationFrame(function () {
            document.body.style.transform = 'translateZ(0)';
            requestAnimationFrame(function () {
              document.body.style.transform = '';
            });
          });
        } catch (e) {
          // ignore
        }
      };

      // 主题变化事件
      if (msg.action === 'theme:change') {
        var isDark = msg.payload === 'dark';
        eventListeners.get('themeChange')?.forEach(function(cb) { try { cb(msg.payload); } catch(e) {} });
        // 更新 body 的 class
        document.body.classList.toggle('dark', isDark);
        document.body.classList.toggle('light', !isDark);
        // 更新主题相关的 CSS 变量
        var root = document.documentElement;
        root.style.setProperty('--tapp-text', isDark ? '#f3f4f6' : '#1f2937');
        root.style.setProperty('--tapp-subtext', isDark ? '#9ca3af' : '#6b7280');
        root.style.setProperty('--tapp-bg', isDark ? '#0a0a0a' : '#f8fafc');
        root.style.setProperty('--tapp-card-bg', isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)');
        root.style.setProperty('--tapp-border', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
        root.style.setProperty('--tapp-input-bg', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)');
        root.style.setProperty('--tapp-shadow', isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.08)');
        // 语义色彩变量（供 Tapp CSS 使用）
        root.style.setProperty('--text-primary', isDark ? 'rgba(255,255,255,.92)' : '#1a1a1a');
        root.style.setProperty('--text-secondary', isDark ? 'rgba(255,255,255,.5)' : '#999');
        root.style.setProperty('--bg-primary', isDark ? '#0a0a0a' : '#fff');
        document.body.style.background = isDark ? '#0a0a0a' : '#fff';
        document.body.style.color = isDark ? 'rgba(255,255,255,.92)' : '#1a1a1a';
        // 🎯 强制触发重绘
        forceRepaint();
      }
      // 主色调变化事件
      else if (msg.action === 'primaryColor:change') {
        eventListeners.get('primaryColorChange')?.forEach(function(cb) { try { cb(msg.payload); } catch(e) {} });
        // 更新 CSS 变量
        if (msg.payload) {
          document.documentElement.style.setProperty('--tapp-primary', msg.payload);
          // 🎯 强制触发重绘
          forceRepaint();
        }
      }
      // 语言变化事件
      else if (msg.action === 'locale:change') {
        eventListeners.get('localeChange')?.forEach(function(cb) { try { cb(msg.payload); } catch(e) {} });
      }
      // 容器尺寸变化事件（已在 HTML 中处理，这里作为备份）
      else if (msg.action === 'container:resize') {
        window._TAPP_DIMENSIONS = msg.payload;
        var root = document.documentElement;
        root.style.setProperty('--tapp-scale', msg.payload.scale || 1);
        root.style.setProperty('--tapp-font-scale', msg.payload.fontScale || 1);
        window.dispatchEvent(new CustomEvent('tapp:resize', { detail: msg.payload }));
      }
      // 🎯 生命周期暂停事件（页面不可见时触发）
      else if (msg.action === 'lifecycle:pause') {
        lifecycleCallbacks.pause.forEach(function(cb) { try { cb(); } catch(e) {} });
        eventListeners.get('pause')?.forEach(function(cb) { try { cb(); } catch(e) {} });
      }
      // 🎯 生命周期恢复事件（页面重新可见时触发）
      else if (msg.action === 'lifecycle:resume') {
        lifecycleCallbacks.resume.forEach(function(cb) { try { cb(); } catch(e) {} });
        eventListeners.get('resume')?.forEach(function(cb) { try { cb(); } catch(e) {} });
      }
      // 🎵 媒体状态变化事件
      else if (msg.action === 'mediaStateChange') {
        eventListeners.get('mediaStateChange')?.forEach(function(cb) { try { cb(msg.payload); } catch(e) {} });
      }
      // 🎵 媒体进度实时推送
      else if (msg.action === 'mediaProgress') {
        eventListeners.get('mediaProgress')?.forEach(function(cb) { try { cb(msg.payload); } catch(e) {} });
      }
    }
  });

  window.Tapp = {
    id: '${id}',
    name: '${manifest.name}',
    version: '${manifest.version}',
    permissions: ${JSON.stringify(grantedPermissions || [])},
    widgets: {},
    pages: {},

    // 🎯 生命周期 API（用于响应冻结/恢复）
    lifecycle: {
      onPause: function(cb) { lifecycleCallbacks.pause.push(cb); },
      onResume: function(cb) { lifecycleCallbacks.resume.push(cb); }
    },

    storage: {
      get: function(k) { validateStorageKey(k); return sendRequest('storage', 'get', [k]); },
      set: function(k, v) { validateStorageKey(k); return sendRequest('storage', 'set', [k, v]); },
      remove: function(k) { validateStorageKey(k); return sendRequest('storage', 'remove', [k]); },
      keys: function() { return sendRequest('storage', 'keys', []); },
      clear: function() { return sendRequest('storage', 'clear', []); }
    },

    settings: {
      get: function(k) { validateStorageKey(k); return sendRequest('storage', 'get', ['_settings.' + k]); },
      set: function(k, v) { validateStorageKey(k); return sendRequest('storage', 'set', ['_settings.' + k, v]); },
      getAll: function() {
        return sendRequest('storage', 'keys', []).then(function(keys) {
          var sKeys = (keys || []).filter(function(k) { return k.startsWith('_settings.'); });
          var result = {};
          var promises = sKeys.map(function(k) {
            return sendRequest('storage', 'get', [k]).then(function(v) {
              result[k.replace('_settings.', '')] = v;
            });
          });
          return Promise.all(promises).then(function() { return result; });
        });
      }
    },

    ai: { chat: function(m, c, o) { return sendRequest('ai', 'chat', [{ messages: m, context: c, options: o }]); } },

    media: {
      play: function() { return sendRequest('media', 'control', [{ action: 'play' }]); },
      pause: function() { return sendRequest('media', 'control', [{ action: 'pause' }]); },
      next: function() { return sendRequest('media', 'control', [{ action: 'next' }]); },
      prev: function() { return sendRequest('media', 'control', [{ action: 'prev' }]); },
      seek: function(p) { return sendRequest('media', 'control', [{ action: 'seek', value: p }]); },
      setVolume: function(v) { return sendRequest('media', 'control', [{ action: 'volume', value: v }]); },
      setMode: function(m) { return sendRequest('media', 'control', [{ action: 'mode', value: m }]); },
      mute: function() { return sendRequest('media', 'control', [{ action: 'mute' }]); },
      unmute: function() { return sendRequest('media', 'control', [{ action: 'unmute' }]); },
      getStatus: function() { return sendRequest('media', 'getStatus', []); },
      getPlaylist: function() { return sendRequest('media', 'getPlaylist', []); },
      getSpectrum: function() { return sendRequest('media', 'getSpectrum', []); },
      playTrack: function(id, idx) { return sendRequest('media', 'playTrack', [{ trackId: id, trackIndex: idx }]); },
      jumpToIndex: function(idx) { return sendRequest('media', 'jumpToIndex', [{ index: idx }]); },
      loadNeteasePlaylist: function(playlistId) { return sendRequest('media', 'loadNeteasePlaylist', [{ playlistId: playlistId }]); },
      onStateChange: function(cb) { return addEventListener('mediaStateChange', cb); },
      onProgress: function(cb) { return addEventListener('mediaProgress', cb); }
    },

    platform: {
      listEnabled: function() { return sendRequest('platform', 'listEnabled', []); },
      getData: function(p, o) { return sendRequest('platform', 'getData', [p, o]); },
      getStats: function(p) { return sendRequest('platform', 'getStats', [p]); },
      getDistribution: function(p, d) { return sendRequest('platform', 'getDistribution', [p, d]); }
    },

    report: {
      listReports: function() { return sendRequest('report', 'listReports', []); },
      getReport: function(id) { return sendRequest('report', 'getReport', [id]); },
      getPlatformReport: function(p) { return sendRequest('report', 'getPlatformReport', [p]); },
      list: function() { return sendRequest('report', 'list', []); },
      get: function(id) { return sendRequest('report', 'get', [{ reportId: id }]); }
    },

    background: {
      require: function(r, reason) { return sendRequest('background', 'require', [r, reason]); },
      release: function(r) { return sendRequest('background', 'release', [r]); },
      list: function() { return sendRequest('background', 'list', []); },
      has: function(r) { return sendRequest('background', 'has', [r]); }
    },

    animation: {
      getLevel: function() { return sendRequest('animation', 'getLevel', []); },
      shouldAnimate: function() { return sendRequest('animation', 'shouldAnimate', []); },
      getConfig: function() { return sendRequest('animation', 'getConfig', []); },
      getStaggerDelay: function(i, d) { return sendRequest('animation', 'getStaggerDelay', [i, d]); },
      onLevelChange: function(cb) { return addEventListener('animationLevelChange', cb); }
    },

    speech: {
      tts: function(r) { return sendRequest('speech', 'tts', [r]); },
      getVoices: function() { return sendRequest('speech', 'getVoices', []); },
      getStatus: function() { return sendRequest('speech', 'getStatus', []); },
      asr: function(r) { return sendRequest('speech', 'asr', [r]); }
    },

    ui: {
      getTheme: function() { return sendRequest('ui', 'getTheme', []); },
      getPrimaryColor: function() { return sendRequest('ui', 'getPrimaryColor', []); },
      getLocale: function() { return sendRequest('ui', 'getLocale', []); },
      showNotification: function(o) { return sendRequest('ui', 'showNotification', [o]); },
      onThemeChange: function(cb) { return addEventListener('themeChange', cb); },
      onPrimaryColorChange: function(cb) { return addEventListener('primaryColorChange', cb); },
      onLocaleChange: function(cb) { return addEventListener('localeChange', cb); }
    },

    // Tapp API 声明系统：调用 manifest 中声明的 API
    // 支持两种访问级别：
    // - public: 所有用户（包括游客）可调用
    // - protected: 需要 network:fetch 权限
    api: function(name, params) { return sendRequest('api', 'execute', [name, params]); },

    // 获取上下文信息
    context: {
      getApp: function() { return sendRequest('context', 'getApp', []); },
      getUser: function() { return sendRequest('context', 'getUser', []); },
      getPlayer: function() { return sendRequest('context', 'getPlayer', []); },
      getNavigation: function() { return sendRequest('context', 'getNavigation', []); },
      getSystem: function() { return sendRequest('context', 'getSystem', []); },
      getGeo: function() { return sendRequest('context', 'getGeo', []); }
    },

    dom: {
      setText: function(el, text) { if (el) el.textContent = text; },
      setHtml: function(el, html) { if (el) el.innerHTML = html; },
      addClass: function(el, cls) { if (el) el.classList.add(cls); },
      removeClass: function(el, cls) { if (el) el.classList.remove(cls); },
      toggleClass: function(el, cls) { if (el) el.classList.toggle(cls); }
    },

    file: {
      download: function(content, filename, mimeType) { return sendRequest('file', 'download', [{ content: content, filename: filename, mimeType: mimeType }]); }
    },

    lifecycle: {
      onReady: function(cb) { if (document.readyState === 'complete') setTimeout(cb, 0); else window.addEventListener('load', cb); },
      onDestroy: function(cb) { window.addEventListener('beforeunload', cb); }
    }
  };

  // 冻结所有 API 对象（防止篡改）
  Object.freeze(Tapp);
  Object.freeze(Tapp.lifecycle);
  Object.freeze(Tapp.storage);
  Object.freeze(Tapp.settings);
  Object.freeze(Tapp.ai);
  Object.freeze(Tapp.platform);
  Object.freeze(Tapp.report);
  Object.freeze(Tapp.background);
  Object.freeze(Tapp.animation);
  Object.freeze(Tapp.speech);
  Object.freeze(Tapp.ui);
  Object.freeze(Tapp.media);
  Object.freeze(Tapp.context);
  Object.freeze(Tapp.dom);
  Object.freeze(Tapp.file);

  // 使用 seal 允许添加 widget/page 定义但禁止替换整个对象
  Object.seal(Tapp.widgets);
  Object.seal(Tapp.pages);

  // 防止重新定义 Tapp
  Object.defineProperty(window, 'Tapp', {
    value: Tapp,
    writable: false,
    configurable: false
  });

  console.log('[TappWidgetSDK] Initialized:', '${id}');
})();
`
}
