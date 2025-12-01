import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import path from 'path';
import { fileURLToPath } from 'url';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'static',
  server: {
    port: 4321,
    host: true
  },
  build: {
    inlineStylesheets: 'auto',
  },
  // SPA 模式：所有路由都重定向到 index.html
  trailingSlash: 'never',
  vite: {
    plugins: [
      visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
        '@layouts': path.resolve(__dirname, './src/layouts'),
        '@lib': path.resolve(__dirname, './src/lib'),
        '@config': path.resolve(__dirname, './src/config.ts'),
      },
    },
    build: {
      cssCodeSplit: true,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: import.meta.env.PROD,
          drop_debugger: true,
          passes: 2,
        },
        mangle: {
          safari10: true,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // React 核心
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'react-vendor';
            }
            // React Router
            if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')) {
              return 'react-router';
            }
            // Chart.js
            if (id.includes('node_modules/chart.js') || id.includes('node_modules/react-chartjs-2')) {
              return 'chart-vendor';
            }
            // Framer Motion
            if (id.includes('node_modules/framer-motion')) {
              return 'framer-motion';
            }
            // react-icons 各子包分开打包（仅动态导入时使用）
            if (id.includes('node_modules/react-icons/fa6/')) {
              return 'icons-fa6';
            }
            if (id.includes('node_modules/react-icons/fa/')) {
              return 'icons-fa';
            }
            if (id.includes('node_modules/react-icons/si/')) {
              return 'icons-si';
            }
            if (id.includes('node_modules/react-icons')) {
              return 'icons-base';
            }
            // Axios
            if (id.includes('node_modules/axios')) {
              return 'axios';
            }
          },
          // 优化文件名用于长期缓存
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      assetsInlineLimit: 4096,
      // 启用 gzip 和 brotli 压缩报告
      reportCompressedSize: true,
      chunkSizeWarningLimit: 1000,
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        }
      }
    }
  }
});
