/**
 * 壁纸颜色提取调试工具
 * 
 * 在浏览器控制台中使用：
 * 1. 查看当前应用的颜色：window.__debugColors.current()
 * 2. 查看缓存信息：window.__debugColors.cache()
 * 3. 手动测试提取：window.__debugColors.test('图片URL')
 * 4. 清除缓存：window.__debugColors.clear()
 */

import { applyColorPalette, extractColorsFromImage, clearColorCache } from './colorExtractor';
import { getCacheInfo, clearColorCache as clearWallpaperCache } from './wallpaperColorCache';

// 调试工具
export const debugColorTools = {
  /**
   * 获取当前应用的颜色
   */
  current() {
    const root = document.documentElement;
    const colors = {
      primary: getComputedStyle(root).getPropertyValue('--color-primary').trim(),
      secondary: getComputedStyle(root).getPropertyValue('--color-secondary').trim(),
      accent: getComputedStyle(root).getPropertyValue('--color-accent').trim(),
      light: getComputedStyle(root).getPropertyValue('--color-light').trim(),
      dark: getComputedStyle(root).getPropertyValue('--color-dark').trim(),
    };
    
    console.log('🎨 当前应用的颜色:', colors);
    return colors;
  },

  /**
   * 获取缓存信息
   */
  cache() {
    const info = getCacheInfo();
    console.log('💾 缓存信息:', info);
    return info;
  },

  /**
   * 测试颜色提取
   */
  async test(imageUrl: string) {
    console.log('🧪 测试颜色提取:', imageUrl);
    try {
      const colors = await extractColorsFromImage(imageUrl, { 
        forceRefresh: true,
        context: 'wallpaper' 
      });
      console.log('✅ 提取成功:', colors);
      
      // 询问是否应用
      if (confirm('是否应用这些颜色？')) {
        applyColorPalette(colors);
        console.log('✅ 颜色已应用');
      }
      
      return colors;
    } catch (error) {
      console.error('❌ 提取失败:', error);
      throw error;
    }
  },

  /**
   * 清除所有缓存
   */
  clear() {
    clearColorCache();
    clearWallpaperCache();
    console.log('🗑️  所有缓存已清除');
  },

  /**
   * 显示帮助信息
   */
  help() {
    console.log(`
🎨 壁纸颜色提取调试工具

可用命令：
- window.__debugColors.current()     查看当前应用的颜色
- window.__debugColors.cache()       查看缓存信息
- window.__debugColors.test(url)     测试提取指定图片的颜色
- window.__debugColors.clear()       清除所有缓存
- window.__debugColors.help()        显示此帮助信息

示例：
  window.__debugColors.test('https://example.com/image.jpg')
    `);
  }
};

// 挂载到 window 对象（仅在开发环境）
if (import.meta.env.DEV) {
  (window as any).__debugColors = debugColorTools;
  console.log('🛠️  颜色调试工具已加载，输入 window.__debugColors.help() 查看帮助');
}
