// 颜色提取和缓存工具
interface ColorPalette {
    primary: string;
    secondary: string;
    accent: string;
    light: string;
    dark: string;
}

interface CachedColorData {
    url: string;
    palette: ColorPalette;
    timestamp: number;
    version: number; // 缓存版本号
}

// 缓存版本（更新算法时递增此值）
const CACHE_VERSION = 2;

// 内存缓存
const colorCache = new Map<string, ColorPalette>();

// 从图片URL提取主色调
export async function extractColorsFromImage(imageUrl: string): Promise<ColorPalette> {
    console.log('🎨 Starting color extraction from:', imageUrl); try {
        // 创建canvas提取颜色
        const img = new Image();
        img.crossOrigin = 'anonymous';

        // 添加时间戳参数强制绕过浏览器图片缓存
        // 这样可以确保每次都获取带 CORS 头的图片
        const cacheBuster = imageUrl.includes('?')
            ? `&t=${Date.now()}`
            : `?t=${Date.now()}`;

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imageUrl + cacheBuster;
        });

        console.log('✓ Image loaded successfully');

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('Canvas context not available');
        }

        // 缩小尺寸以提高性能
        const scaleFactor = 0.1;
        canvas.width = img.width * scaleFactor;
        canvas.height = img.height * scaleFactor;

        console.log(`📐 Canvas size: ${canvas.width}x${canvas.height}`);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        console.log(`🔍 Analyzing ${imageData.data.length / 4} pixels...`);

        // 提取颜色
        const palette = analyzeImageColors(imageData);

        console.log('✅ Color extraction complete:', palette);
        return palette;
    } catch (error) {
        console.error('❌ Failed to extract colors:', error);
        // 返回默认配色
        return getDefaultPalette();
    }
}

// 分析图片颜色
function analyzeImageColors(imageData: ImageData): ColorPalette {
    const pixels = imageData.data;
    const colorMap = new Map<string, number>();

    // 🔧 增加采样密度：每个像素都采样（去掉 i += 8）
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];

        // 跳过透明像素
        if (a < 128) {
            continue;
        }

        // 使用感知亮度公式 (更接近人眼感知)
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

        // 跳过过暗和过亮的像素
        if (brightness < 20 || brightness > 235) {
            continue;
        }

        // 计算饱和度
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;

        // 🔧 降低饱和度阈值：0.08（更宽松，包含更多颜色）
        if (saturation < 0.08) {
            continue;
        }

        // 🔧 更精细的量化：12 而不是 16，保留更多颜色细节
        const qR = Math.round(r / 12) * 12;
        const qG = Math.round(g / 12) * 12;
        const qB = Math.round(b / 12) * 12;

        const key = `${qR},${qG},${qB}`;
        colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }

    console.log(`Found ${colorMap.size} unique colors`);

    // 计算总像素数
    const totalPixels = Array.from(colorMap.values()).reduce((sum, count) => sum + count, 0);
    console.log(`Total sampled pixels: ${totalPixels}`);

    // 按频率排序，并计算占比
    const sortedColors = Array.from(colorMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([color, count]) => {
            const [r, g, b] = color.split(',').map(Number);
            const percentage = (count / totalPixels) * 100;
            return { r, g, b, count, percentage };
        });

    if (sortedColors.length === 0) {
        console.warn('No colors found, using default palette');
        return getDefaultPalette();
    }

    console.log('Top 5 colors:', sortedColors.slice(0, 5).map(c =>
        `rgb(${c.r},${c.g},${c.b}) ${c.percentage.toFixed(1)}% sat:${getSaturation(c.r, c.g, c.b).toFixed(2)}`
    ));

    // 🔧 降低阈值：只考虑占比超过 1% 的颜色（更宽松）
    const significantColors = sortedColors.filter(c => c.percentage > 1);
    console.log(`Found ${significantColors.length} significant colors (>1% each)`);

    // 从显著颜色中筛选有活力的颜色
    const vibrantColors = significantColors.filter(c => {
        const saturation = getSaturation(c.r, c.g, c.b);
        const brightness = getPerceptualBrightness(c.r, c.g, c.b);
        // 🔧 降低饱和度要求：0.15（之前是 0.2）
        return saturation > 0.15 && brightness > 50 && brightness < 200;
    });

    console.log(`Found ${vibrantColors.length} vibrant colors with significant presence`);

    // 🔧 如果没有找到显著的鲜艳颜色，降低阈值到 0.5%
    const fallbackColors = vibrantColors.length === 0
        ? sortedColors.filter(c => {
            const saturation = getSaturation(c.r, c.g, c.b);
            const brightness = getPerceptualBrightness(c.r, c.g, c.b);
            // 🔧 进一步降低要求：0.5% 占比，0.12 饱和度
            return c.percentage > 0.5 && saturation > 0.12 && brightness > 50 && brightness < 200;
        })
        : vibrantColors;

    console.log(`Using ${fallbackColors.length} colors for palette generation`);

    // 选择主色：优先选择占比最大的鲜艳颜色
    const primaryColor = fallbackColors.length > 0 ? fallbackColors[0] : sortedColors[0];

    // 选择次要色和强调色（尽量选择不同色相的颜色）
    const secondaryColor = fallbackColors.length > 1 ? fallbackColors[1] :
        sortedColors.length > 1 ? sortedColors[1] :
            primaryColor;

    const accentColor = fallbackColors.length > 2 ? fallbackColors[2] :
        sortedColors.length > 2 ? sortedColors[2] :
            secondaryColor;

    const result = {
        primary: rgbToHex(primaryColor.r, primaryColor.g, primaryColor.b),
        secondary: rgbToHex(secondaryColor.r, secondaryColor.g, secondaryColor.b),
        accent: rgbToHex(accentColor.r, accentColor.g, accentColor.b),
        light: lightenColor(primaryColor.r, primaryColor.g, primaryColor.b),
        dark: darkenColor(primaryColor.r, primaryColor.g, primaryColor.b),
    };

    console.log('Generated palette:', result);
    return result;
}

// 计算颜色亮度（简单平均）
function getBrightness(r: number, g: number, b: number): number {
    return (r + g + b) / 3;
}

// 计算感知亮度（更接近人眼）
function getPerceptualBrightness(r: number, g: number, b: number): number {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

// 计算颜色饱和度
function getSaturation(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    if (max === 0) return 0;
    return delta / max;
}

// RGB转十六进制
function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
}

// RGB 转 HSL
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (delta !== 0) {
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

        if (max === r) {
            h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        } else if (max === g) {
            h = ((b - r) / delta + 2) / 6;
        } else {
            h = ((r - g) / delta + 4) / 6;
        }
    }

    return { h, s, l };
}

// HSL 转 RGB
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;

        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

// 变亮颜色（使用 HSL，保持色相和饱和度）
function lightenColor(r: number, g: number, b: number): string {
    const hsl = rgbToHsl(r, g, b);

    // 增加亮度，但不超过 85%
    hsl.l = Math.min(0.85, hsl.l + 0.2);

    // 稍微增加饱和度，让颜色更鲜艳
    hsl.s = Math.min(1, hsl.s * 1.1);

    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// 变暗颜色（使用 HSL，保持色相和饱和度）
function darkenColor(r: number, g: number, b: number): string {
    const hsl = rgbToHsl(r, g, b);

    // 降低亮度，但不低于 15%
    hsl.l = Math.max(0.15, hsl.l - 0.25);

    // 稍微增加饱和度
    hsl.s = Math.min(1, hsl.s * 1.15);

    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// 默认配色（绿色系）
function getDefaultPalette(): ColorPalette {
    return {
        primary: '#22c55e',
        secondary: '#ec4899',
        accent: '#fbbf24',
        light: '#4ade80',
        dark: '#16a34a',
    };
}

// 应用配色到CSS变量
export function applyColorPalette(palette: ColorPalette): void {
    const root = document.documentElement;
    root.style.setProperty('--color-primary', palette.primary);
    root.style.setProperty('--color-secondary', palette.secondary);
    root.style.setProperty('--color-accent', palette.accent);
    root.style.setProperty('--color-light', palette.light);
    root.style.setProperty('--color-dark', palette.dark);

    console.log('Applied color palette:', palette);
}

// 清除颜色（应用中性色，避免显示上一张图片的颜色）
export function clearColors(): void {
    const neutralPalette: ColorPalette = {
        primary: '#94a3b8',    // 中性灰蓝
        secondary: '#94a3b8',
        accent: '#94a3b8',
        light: '#cbd5e1',      // 浅灰
        dark: '#475569',       // 深灰
    };
    applyColorPalette(neutralPalette);
    console.log('🔄 Colors cleared, neutral palette applied');
}

// 保存到 localStorage（与 URL 绑定）
function saveToLocalStorage(url: string, palette: ColorPalette): void {
    try {
        const data: CachedColorData = {
            url,
            palette,
            timestamp: Date.now(),
            version: CACHE_VERSION
        };
        localStorage.setItem('wallpaperColorCache', JSON.stringify(data));
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
    }
}

// 验证颜色是否合理（不能过度黑或过度白）
function isValidColor(hex: string): boolean {
    const rgb = parseInt(hex.slice(1), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;

    const brightness = (r + g + b) / 3;

    // 亮度应该在 30-225 之间
    return brightness >= 30 && brightness <= 225;
}

// 验证配色方案是否合理
function isValidPalette(palette: ColorPalette): boolean {
    // 检查所有颜色是否合理
    return isValidColor(palette.primary) &&
        isValidColor(palette.secondary) &&
        isValidColor(palette.accent) &&
        palette.light !== '#ffffff' && // light 不应该是纯白
        palette.dark !== '#000000';    // dark 不应该是纯黑
}

// 从 localStorage 获取缓存（检查 URL 是否匹配）
function getLocalStorageCache(url: string): ColorPalette | null {
    try {
        const cached = localStorage.getItem('wallpaperColorCache');
        if (!cached) return null;

        const data: CachedColorData = JSON.parse(cached);

        // 检查版本号
        if (!data.version || data.version !== CACHE_VERSION) {
            console.log('Cache version mismatch, clearing old cache');
            localStorage.removeItem('wallpaperColorCache');
            return null;
        }

        // 检查 URL 是否匹配
        if (data.url === url) {
            // 验证配色是否合理
            if (!isValidPalette(data.palette)) {
                console.log('Invalid cached palette, will regenerate');
                return null;
            }

            // 检查缓存是否过期（7天）
            const age = Date.now() - data.timestamp;
            if (age < 7 * 24 * 60 * 60 * 1000) {
                return data.palette;
            }
        }
        return null;
    } catch {
        return null;
    }
}

// 从localStorage加载配色（用于快速初始化）
export function loadCachedPalette(): ColorPalette | null {
    try {
        const cached = localStorage.getItem('wallpaperColorCache');
        if (!cached) return null;

        const data: CachedColorData = JSON.parse(cached);
        return data.palette;
    } catch {
        return null;
    }
}

// 获取缓存的 URL
export function getCachedUrl(): string | null {
    try {
        const cached = localStorage.getItem('wallpaperColorCache');
        if (!cached) return null;

        const data: CachedColorData = JSON.parse(cached);
        return data.url;
    } catch {
        return null;
    }
}

// 清除特定URL的缓存（用于强制重新提取）
export function clearColorCache(url?: string): void {
    if (url) {
        colorCache.delete(url);
        console.log('Cleared color cache for:', url);
    } else {
        colorCache.clear();
        localStorage.removeItem('wallpaperColorCache');
        console.log('Cleared all color cache');
    }
}
