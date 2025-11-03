// AI Image Generation with Pollinations.ai
// API Docs: https://github.com/pollinations/pollinations/blob/master/APIDOCS.md

interface ImageGenOptions {
    model?: 'flux' | 'flux-realism' | 'flux-anime' | 'flux-3d' | 'turbo';
    width?: number;
    height?: number;
    seed?: number;
    nologo?: boolean;
    private?: boolean;
    enhance?: boolean;
}

interface CardIllustration {
    url: string;
    prompt: string;
    timestamp: number;
    cardId: number;
}

const IMAGE_CACHE_KEY = 'myriad_card_illustrations';
const CACHE_EXPIRY_DAYS = 30;

// 调用后端 AI 生成提示词
async function generatePromptFromAPI(title: string, summary: string, category: string): Promise<string> {
    try {
        console.log(`🤖 [AI] Requesting prompt generation for: "${title}"`);
        
        const response = await fetch('http://localhost:3000/api/prompt/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                summary,
                category,
            }),
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`✅ [AI] Generated prompt: "${data.prompt.substring(0, 100)}..."`);
        
        return data.prompt;
    } catch (error) {
        console.error('❌ [AI] Failed to generate prompt, using fallback:', error);
        
        // 降级方案：使用简单的默认提示词
        return `A cute chibi character, ${title}, in Studio Ghibli art style, transparent background, PNG format, no background, isolated subject, masterpiece, highest quality, detailed character design, soft lighting, hand-drawn animation style, Hayao Miyazaki inspired, watercolor texture, gentle colors, whimsical atmosphere, professional illustration, 8K resolution, ultra detailed, cute kawaii style`;
    }
}

// 根据卡片内容生成吉卜力风格插画提示词
export async function generateGhibliPrompt(title: string, summary: string, category: string): Promise<string> {
    // 直接调用后端 AI 生成提示词
    const prompt = await generatePromptFromAPI(title, summary, category);
    return prompt;
}

// 生成插画 URL（Pollinations API）
export function generateImageUrl(prompt: string, options: ImageGenOptions = {}): string {
    const {
        model = 'flux',
        width = 512,
        height = 512,
        seed,
        nologo = true,
        private: isPrivate = false,
        enhance = true
    } = options;
    
    // URL encode the prompt
    const encodedPrompt = encodeURIComponent(prompt);
    
    // Build query parameters
    const params = new URLSearchParams();
    params.set('width', width.toString());
    params.set('height', height.toString());
    params.set('model', model);
    params.set('nologo', nologo.toString());
    params.set('private', isPrivate.toString());
    params.set('enhance', enhance.toString());
    if (seed !== undefined) {
        params.set('seed', seed.toString());
    }
    
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?${params.toString()}`;
}

// 从 localStorage 获取缓存的插画
export function getCachedIllustrations(): Map<number, CardIllustration> {
    try {
        const cached = localStorage.getItem(IMAGE_CACHE_KEY);
        if (!cached) return new Map();
        
        const data = JSON.parse(cached);
        const illustrations = new Map<number, CardIllustration>();
        
        // 检查过期
        const now = Date.now();
        const expiryTime = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        
        for (const [cardId, illustration] of Object.entries(data)) {
            const ill = illustration as CardIllustration;
            if (now - ill.timestamp < expiryTime) {
                illustrations.set(Number(cardId), ill);
            }
        }
        
        return illustrations;
    } catch (e) {
        console.error('Failed to load cached illustrations:', e);
        return new Map();
    }
}

// 保存插画到 localStorage
export function saveIllustration(cardId: number, illustration: CardIllustration): void {
    try {
        const cached = getCachedIllustrations();
        cached.set(cardId, illustration);
        
        const data: Record<number, CardIllustration> = {};
        cached.forEach((value, key) => {
            data[key] = value;
        });
        
        localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(data));
        console.log(`✅ [ImageGen] Saved illustration for card ${cardId}`);
    } catch (e) {
        console.error('Failed to save illustration:', e);
    }
}

// 为卡片生成插画
export async function generateCardIllustration(
    cardId: number,
    title: string,
    summary: string,
    category: string
): Promise<string> {
    // 检查缓存
    const cached = getCachedIllustrations();
    const cachedIll = cached.get(cardId);
    
    if (cachedIll) {
        console.log(`⚡ [ImageGen] Using cached illustration for card ${cardId}`);
        return cachedIll.url;
    }
    
    // 从配置读取参数
    let config: any = {};
    try {
        const response = await fetch('http://localhost:3000/api/config');
        const data = await response.json();
        config = data.ui_config || {};
    } catch (e) {
        console.warn('Failed to load config, using defaults');
    }
    
    // 检查是否启用
    const enabled = config.config_fields?.find((f: any) => f.key === 'image_gen_enabled')?.value !== 'false';
    if (!enabled) {
        console.log(`⚠️ [ImageGen] AI illustrations disabled in config`);
        return ''; // 返回空字符串表示不生成
    }
    
    // 读取配置参数
    const model = config.config_fields?.find((f: any) => f.key === 'image_gen_model')?.value || 'flux';
    const width = parseInt(config.config_fields?.find((f: any) => f.key === 'image_gen_width')?.value || '512');
    const height = parseInt(config.config_fields?.find((f: any) => f.key === 'image_gen_height')?.value || '512');
    
    // 生成提示词（调用后端 AI）
    console.log(`🎨 [ImageGen] Card ${cardId} - Generating illustration`);
    console.log(`   Title: "${title}"`);
    console.log(`   Summary: "${summary.substring(0, 50)}..."`);
    
    const prompt = await generateGhibliPrompt(title, summary, category);
    console.log(`   Generated Prompt: "${prompt.substring(0, 100)}..."`);
    
    // 使用 cardId 作为 seed 确保每张卡片生成不同的图片
    const seed = cardId * 1000 + Date.now() % 1000;
    console.log(`   Seed: ${seed} (based on cardId ${cardId})`);
    
    // 生成图片 URL
    const imageUrl = generateImageUrl(prompt, {
        model: model as any,
        width,
        height,
        seed,
        nologo: true,
        enhance: true
    });
    
    console.log(`   URL: ${imageUrl.substring(0, 120)}...`);
    
    // 保存到缓存
    const illustration: CardIllustration = {
        url: imageUrl,
        prompt,
        timestamp: Date.now(),
        cardId
    };
    saveIllustration(cardId, illustration);
    
    return imageUrl;
}

// 清除过期缓存
export function clearExpiredIllustrations(): void {
    const cached = getCachedIllustrations();
    if (cached.size > 0) {
        const data: Record<number, CardIllustration> = {};
        cached.forEach((value, key) => {
            data[key] = value;
        });
        localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(data));
    }
}
