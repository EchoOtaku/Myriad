// Service Worker for Myriad
// 提供离线支持和资源缓存

const CACHE_VERSION = 'myriad-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// 需要预缓存的静态资源
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/config',
  '/library',
  '/manifest.json',
];

// 最大缓存数量
const MAX_DYNAMIC_CACHE_SIZE = 50;
const MAX_IMAGE_CACHE_SIZE = 30;

// 安装 Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Precaching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((err) => {
        console.error('[SW] Precache failed:', err);
      })
  );

  // 强制激活新的 Service Worker
  self.skipWaiting();
});

// 激活 Service Worker 并清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');

  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('myriad-') && key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== IMAGE_CACHE)
          .map((key) => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    })
  );

  // 立即控制所有客户端
  return self.clients.claim();
});

// 限制缓存大小
async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length > maxSize) {
    const keysToDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(keysToDelete.map(key => cache.delete(key)));
  }
}

// 拦截请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳过非 HTTP(S) 请求
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // API 请求 - 网络优先策略
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 只缓存成功的 GET 请求
          if (request.method === 'GET' && response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
              limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_CACHE_SIZE);
            });
          }
          return response;
        })
        .catch(() => {
          // 网络失败时尝试从缓存获取
          return caches.match(request);
        })
    );
    return;
  }

  // 图片请求 - 缓存优先策略
  if (request.destination === 'image' || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request).then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(IMAGE_CACHE).then((cache) => {
                cache.put(request, responseClone);
                limitCacheSize(IMAGE_CACHE, MAX_IMAGE_CACHE_SIZE);
              });
            }
            return response;
          });
        })
    );
    return;
  }

  // 静态资源 - 缓存优先，网络回退
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((response) => {
          // 只缓存成功的 GET 请求
          if (request.method === 'GET' && response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
              limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_CACHE_SIZE);
            });
          }
          return response;
        });
      })
      .catch(() => {
        // 如果是导航请求且都失败了，返回离线页面
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});

// 消息处理
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(keys.map((key) => caches.delete(key)));
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});
