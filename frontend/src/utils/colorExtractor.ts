// ColorExtractor v3.0
export interface ColorPalette {
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
    version: number;
}

const CACHE_VERSION = 4; // 更新版本号，强制刷新缓存
const CACHE_EXPIRY_DAYS = 30;
const MAX_CANVAS_SIZE = 150;
const SAMPLE_STEP = 4;

// 严格的彩色检测阈值
const MIN_SATURATION = 0.35; // 饱和度必须 > 35% (严格)
const MIN_COLOR_DISTANCE = 40; // 与灰色的最小距离
const MIN_CHROMA = 50; // 最小色度值

const memoryCache = new Map<string, ColorPalette>();
let currentExtractionController: AbortController | null = null;
let currentExtractionUrl: string | null = null;

export async function extractColorsFromImage(
    imageUrl: string,
    options: { forceRefresh?: boolean; context?: string } = {}
): Promise<ColorPalette> {
    // 如果是音乐封面提取，不取消其他正在进行的提取（如壁纸）
    const isMusic = options.context === 'music';
    
    if (!isMusic && currentExtractionController) {
        currentExtractionController.abort();
    }

    // 音乐封面提取使用独立的 controller，不影响全局状态
    const myController = isMusic ? new AbortController() : (currentExtractionController = new AbortController());
    if (!isMusic) {
        currentExtractionUrl = imageUrl;
    }

    try {
        if (!options.forceRefresh && memoryCache.has(imageUrl)) {
            return memoryCache.get(imageUrl)!;
        }

        if (!options.forceRefresh) {
            const cached = getLocalStorageCache(imageUrl);
            if (cached) {
                memoryCache.set(imageUrl, cached);
                return cached;
            }
        }

        const palette = await extractFromImage(imageUrl, myController.signal);

        if (myController.signal.aborted) {
            throw new Error('Extraction cancelled');
        }

        // 音乐封面提取不检查 URL 变化
        if (!isMusic && currentExtractionUrl !== imageUrl) {
            throw new Error('URL changed during extraction');
        }

        memoryCache.set(imageUrl, palette);
        saveToLocalStorage(imageUrl, palette);

        return palette;

    } catch (error) {
        if (error instanceof Error && error.message.includes('cancel')) {
            throw error;
        }
        return getDefaultPalette();
    } finally {
        // 只有非音乐提取才清理全局状态
        if (!isMusic && currentExtractionController === myController) {
            currentExtractionController = null;
            currentExtractionUrl = null;
        }
    }
}

async function extractFromImage(imageUrl: string, signal: AbortSignal): Promise<ColorPalette> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const cacheBuster = imageUrl.includes('?') ? `&_t=${Date.now()}` : `?_t=${Date.now()}`;
    const imageUrlWithCache = imageUrl + cacheBuster;

    await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('Aborted before image load'));
            return;
        }
        const abortHandler = () => reject(new Error('Aborted during image load'));
        signal.addEventListener('abort', abortHandler);
        img.onload = () => {
            signal.removeEventListener('abort', abortHandler);
            resolve();
        };
        img.onerror = () => {
            signal.removeEventListener('abort', abortHandler);
            reject(new Error('Failed to load image'));
        };
        img.src = imageUrlWithCache;
    });

    if (signal.aborted) {
        throw new Error('Extraction cancelled after image load');
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        throw new Error('Canvas context not available');
    }

    const scale = Math.min(MAX_CANVAS_SIZE / img.width, MAX_CANVAS_SIZE / img.height, 1);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (signal.aborted) {
        throw new Error('Extraction cancelled after processing');
    }

    return analyzeImageColors(imageData);
}

function analyzeImageColors(imageData: ImageData): ColorPalette {
    const pixels = imageData.data;
    const colorMap = new Map<string, number>();
    let totalSamples = 0;

    for (let i = 0; i < pixels.length; i += SAMPLE_STEP * 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        
        // 跳过透明像素
        if (a < 128) continue;
        
        // 严格过滤：必须是明确的彩色
        if (!isVividColor(r, g, b)) continue;
        
        // 量化颜色（减少相似颜色）
        const qR = Math.round(r / 16) * 16;
        const qG = Math.round(g / 16) * 16;
        const qB = Math.round(b / 16) * 16;
        const key = `${qR},${qG},${qB}`;
        colorMap.set(key, (colorMap.get(key) || 0) + 1);
        totalSamples++;
    }

    if (colorMap.size === 0) {
        return getDefaultPalette();
    }

    const sortedColors = Array.from(colorMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([color, count]) => {
            const [r, g, b] = color.split(',').map(Number);
            const percentage = (count / totalSamples) * 100;
            const saturation = getSaturation(r, g, b);
            const brightness = getPerceptualBrightness(r, g, b);
            const chroma = getChroma(r, g, b);
            return { r, g, b, percentage, saturation, brightness, chroma };
        });

    // 严格筛选：只要鲜艳的彩色
    const vividColors = sortedColors.filter(c =>
        c.percentage > 2 && 
        c.saturation > MIN_SATURATION && 
        c.chroma > MIN_CHROMA &&
        c.brightness > 40 && 
        c.brightness < 220
    );

    const selectedColors = vividColors.length > 0
        ? vividColors
        : sortedColors.filter(c => 
            c.percentage > 1 && 
            c.saturation > MIN_SATURATION * 0.8 && 
            c.chroma > MIN_CHROMA * 0.7
        );

    if (selectedColors.length === 0) {
        return getDefaultPalette();
    }

    const primary = selectedColors[0];
    const secondary = selectedColors.length > 1 ? selectedColors[1] : primary;
    const accent = selectedColors.length > 2 ? selectedColors[2] : secondary;

    return {
        primary: rgbToHex(primary.r, primary.g, primary.b),
        secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
        accent: rgbToHex(accent.r, accent.g, accent.b),
        light: lightenColor(primary.r, primary.g, primary.b),
        dark: darkenColor(primary.r, primary.g, primary.b),
    };
}

function getPerceptualBrightness(r: number, g: number, b: number): number {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function getSaturation(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0) return 0;
    return (max - min) / max;
}

// 计算色度（Chroma）：衡量颜色的纯度
function getChroma(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min;
}

// 计算颜色与灰色的距离
function getDistanceFromGray(r: number, g: number, b: number): number {
    const avg = (r + g + b) / 3;
    const dr = r - avg;
    const dg = g - avg;
    const db = b - avg;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

// 严格检测是否为鲜艳的彩色（非灰/白/黑）
function isVividColor(r: number, g: number, b: number): boolean {
    // 1. 亮度检查：避免纯黑和纯白
    const brightness = getPerceptualBrightness(r, g, b);
    if (brightness < 30 || brightness > 225) return false;
    
    // 2. 饱和度检查：必须有足够的彩度
    const saturation = getSaturation(r, g, b);
    if (saturation < MIN_SATURATION) return false;
    
    // 3. 色度检查：RGB 通道必须有明显差异
    const chroma = getChroma(r, g, b);
    if (chroma < MIN_CHROMA) return false;
    
    // 4. 灰色距离检查：与灰色必须有明显区别
    const grayDistance = getDistanceFromGray(r, g, b);
    if (grayDistance < MIN_COLOR_DISTANCE) return false;
    
    // 5. 额外检查：避免几乎相等的 RGB 值（灰色特征）
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const mid = r + g + b - max - min;
    
    // 如果三个值都很接近，说明是灰色
    if (max - mid < 20 && mid - min < 20) return false;
    
    return true;
}

function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (delta !== 0) {
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / delta + 2) / 6;
        else h = ((r - g) / delta + 4) / 6;
    }
    return { h, s, l };
}

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
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function lightenColor(r: number, g: number, b: number): string {
    const hsl = rgbToHsl(r, g, b);
    hsl.l = Math.min(0.85, hsl.l + 0.2);
    hsl.s = Math.min(1, hsl.s * 1.1);
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function darkenColor(r: number, g: number, b: number): string {
    const hsl = rgbToHsl(r, g, b);
    hsl.l = Math.max(0.15, hsl.l - 0.25);
    hsl.s = Math.min(1, hsl.s * 1.15);
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function getDefaultPalette(): ColorPalette {
    return {
        primary: '#22c55e',
        secondary: '#ec4899',
        accent: '#fbbf24',
        light: '#4ade80',
        dark: '#16a34a',
    };
}

function getLocalStorageCache(url: string): ColorPalette | null {
    try {
        const cached = localStorage.getItem('wallpaperColorCache');
        if (!cached) return null;
        const data: CachedColorData = JSON.parse(cached);
        if (data.version !== CACHE_VERSION) {
            localStorage.removeItem('wallpaperColorCache');
            return null;
        }
        if (data.url !== url) return null;
        const age = Date.now() - data.timestamp;
        if (age > CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000) return null;
        return data.palette;
    } catch {
        return null;
    }
}

function saveToLocalStorage(url: string, palette: ColorPalette): void {
    try {
        const data: CachedColorData = { url, palette, timestamp: Date.now(), version: CACHE_VERSION };
        localStorage.setItem('wallpaperColorCache', JSON.stringify(data));
    } catch (e) {
        // 静默失败,缓存不可用不影响功能
    }
}

export function applyColorPalette(palette: ColorPalette): void {
    const root = document.documentElement;
    root.style.setProperty('--color-primary', palette.primary);
    root.style.setProperty('--color-secondary', palette.secondary);
    root.style.setProperty('--color-accent', palette.accent);
    root.style.setProperty('--color-light', palette.light);
    root.style.setProperty('--color-dark', palette.dark);
}

export function clearColors(): void {
    const neutralPalette: ColorPalette = {
        primary: '#94a3b8',
        secondary: '#94a3b8',
        accent: '#94a3b8',
        light: '#cbd5e1',
        dark: '#475569',
    };
    applyColorPalette(neutralPalette);
}

export function clearColorCache(url?: string): void {
    if (url) {
        memoryCache.delete(url);
    } else {
        memoryCache.clear();
        localStorage.removeItem('wallpaperColorCache');
    }
}

export function getCurrentExtractionUrl(): string | null {
    return currentExtractionUrl;
}
