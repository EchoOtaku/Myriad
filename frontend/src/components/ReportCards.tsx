import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../config';
import PlatformIcon from './PlatformIcon';

interface UserInfo {
    name: string;
    avatar: string;
    platform: string;
    bio: string;
}

interface PlatformLink {
    platform: string;
    url: string;
    displayName: string;
    brandColor: string;
}

interface CardContent {
    summary: string;
    details: string[];
    highlight?: string;
    tags: string[];
}

interface ReportCard {
    topic_id: number;
    title: string;
    category: string;
    icon: string;
    color: string;
    content: CardContent;
    illustration?: string; // 插画 URL
    generated_at?: string; // 生成时间，用于唯一标识
}

interface PersonalReport {
    cards: ReportCard[]; // 当前显示的卡片
    all_cards?: ReportCard[]; // 所有可用的卡片（包含历史缓存）
    generated_at: string;
    expires_at: string;
    selected_topics: number[];
}

export default function ReportCards() {
    const [selectedCard, setSelectedCard] = useState<ReportCard | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<PersonalReport | null>(null);
    const [displayCards, setDisplayCards] = useState<ReportCard[]>([]); // 当前显示的卡片
    const [progress, setProgress] = useState<string>('');
    const [progressPercent, setProgressPercent] = useState<number>(0);
    const [fromCache, setFromCache] = useState(false);
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const [petEnabled, setPetEnabled] = useState(true);
    const [petImageUrl, setPetImageUrl] = useState('https://api.fuukei.org/myriad/frontend/public/furina.png');
    const [platformLinks, setPlatformLinks] = useState<PlatformLink[]>([]);
    const [isAdmin, setIsAdmin] = useState(false); // 是否为管理员
    const [isAuthenticated, setIsAuthenticated] = useState(false); // 是否已登录
    const [isCardTransitioning, setIsCardTransitioning] = useState(false); // 卡片切换动画状态
    const [isModalClosing, setIsModalClosing] = useState(false); // 弹窗关闭动画状态

    // 从所有卡片中随机抽取指定数量（优先使用all_cards）
    const getRandomCards = useCallback((currentReport: PersonalReport | null, count: number = 6): ReportCard[] => {
        if (!currentReport) {
            return [];
        }

        // 优先使用 all_cards，如果没有则使用 cards
        const allCards = currentReport.all_cards && currentReport.all_cards.length > 0 
            ? currentReport.all_cards 
            : currentReport.cards;
        
        if (!allCards || allCards.length === 0) {
            return [];
        }
        
        // 如果卡片数量小于等于需要的数量，返回所有卡片
        if (allCards.length <= count) {
            return [...allCards]; // 返回副本避免直接修改原数组
        }
        
        // Fisher-Yates 洗牌算法
        const shuffled = [...allCards];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        const result = shuffled.slice(0, count);
        
        return result;
    }, []); // 空依赖数组，函数不侚重新创建

    // 检测用户是否为管理员
    useEffect(() => {
        const checkAdminStatus = async () => {
            const token = localStorage.getItem('auth_token');
            if (!token) {
                setIsAuthenticated(false);
                setIsAdmin(false);
                return;
            }

            try {
                const response = await fetch(`${API_URL}/api/auth/me`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    const user = await response.json();
                    setIsAuthenticated(true);
                    setIsAdmin(user.is_admin === true);
                } else {
                    setIsAuthenticated(false);
                    setIsAdmin(false);
                }
            } catch (error) {
                setIsAuthenticated(false);
                setIsAdmin(false);
            }
        };

        checkAdminStatus();

        // 监听登录状态变化
        const handleAuthChange = () => {
            checkAdminStatus();
        };

        window.addEventListener('auth-state-changed', handleAuthChange);
        return () => {
            window.removeEventListener('auth-state-changed', handleAuthChange);
        };
    }, []);

    // 生成默认头像 (SVG Data URL)
    const getDefaultAvatar = (name: string) => {
        const initial = name.charAt(0).toUpperCase();
        const colors = [
            { bg: '#6366f1', text: '#ffffff' },
            { bg: '#8b5cf6', text: '#ffffff' },
            { bg: '#ec4899', text: '#ffffff' },
            { bg: '#f59e0b', text: '#ffffff' },
            { bg: '#10b981', text: '#ffffff' },
        ];
        const colorIndex = name.charCodeAt(0) % colors.length;
        const color = colors[colorIndex];

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color.bg}"/><text x="50" y="50" font-family="Arial, sans-serif" font-size="45" font-weight="bold" fill="${color.text}" text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
        return `data:image/svg+xml;base64,${btoa(svg)}`;
    };

    // 获取用户信息
    const fetchUserInfo = async () => {
        try {
            // 优先从后端缓存获取用户信息
            const userInfoResponse = await fetch('http://localhost:3000/api/profile/user-info');
            if (userInfoResponse.ok) {
                const userInfoResult = await userInfoResponse.json();
                if (userInfoResult.success && userInfoResult.user_info) {
                    setUserInfo({
                        name: userInfoResult.user_info.name,
                        avatar: userInfoResult.user_info.avatar,
                        platform: userInfoResult.user_info.platform,
                        bio: userInfoResult.user_info.bio
                    });
                }
            }

            // 获取配置以构建平台链接
            const configResponse = await fetch('http://localhost:3000/api/config');
            const config = await configResponse.json();
            
            const links: PlatformLink[] = [];
            
            // 尝试获取缓存的平台数据（包含Steam用户名等）
            let cachedData: any = null;
            try {
                const cacheResponse = await fetch('http://localhost:3000/api/profile/cache-debug');
                const cacheResult = await cacheResponse.json();
                if (cacheResult.success && cacheResult.cache_entries && cacheResult.cache_entries.length > 0) {
                    // 找到最新的有效缓存
                    const validCache = cacheResult.cache_entries.find((entry: any) => entry.is_valid);
                    if (validCache && validCache.raw_data) {
                        cachedData = validCache.raw_data;
                    }
                }
            } catch (e) {
                // Failed to fetch cached data, continue without it
            }
            
            // 处理各个平台的配置
            if (config.platforms) {
                // Bilibili
                const bilibili = config.platforms.find((p: any) => p.name === 'Bilibili' && p.enabled);
                if (bilibili) {
                    const uid = bilibili.config_fields?.find((f: any) => f.key === 'uid')?.value;
                    if (uid) {
                        links.push({
                            platform: 'Bilibili',
                            url: `https://space.bilibili.com/${uid}`,
                            displayName: 'BiliBili',
                            brandColor: '#00a1d6'
                        });
                    }
                }
                
                // GitHub
                const github = config.platforms.find((p: any) => p.name === 'GitHub' && p.enabled);
                if (github) {
                    const username = github.config_fields?.find((f: any) => f.key === 'username')?.value;
                    if (username) {
                        links.push({
                            platform: 'GitHub',
                            url: `https://github.com/${username}`,
                            displayName: 'GitHub',
                            brandColor: '#181717'
                        });
                    }
                }
                
                // Steam - 从缓存获取用户名
                const steam = config.platforms.find((p: any) => p.name === 'Steam' && p.enabled);
                if (steam) {
                    const steamId = steam.config_fields?.find((f: any) => f.key === 'steam_id')?.value;
                    if (steamId) {
                        let steamUrl = `https://steamcommunity.com/profiles/${steamId}`;
                        
                        // 尝试从缓存获取自定义URL
                        if (cachedData && cachedData.steam && cachedData.steam.user_info) {
                            const profileUrl = cachedData.steam.user_info.profileurl;
                            if (profileUrl) {
                                steamUrl = profileUrl;
                            }
                        }
                        
                        links.push({
                            platform: 'Steam',
                            url: steamUrl,
                            displayName: 'Steam',
                            brandColor: '#1b2838'
                        });
                    }
                }
                
                // Netease Music (注意：配置中是 "Netease Music")
                const netease = config.platforms.find((p: any) => p.name === 'Netease Music' && p.enabled);
                if (netease) {
                    const userId = netease.config_fields?.find((f: any) => f.key === 'user_id')?.value;
                    if (userId) {
                        links.push({
                            platform: 'Netease',
                            url: `https://music.163.com/user/home?id=${userId}`,
                            displayName: '网易云',
                            brandColor: '#c20c0c'
                        });
                    }
                }
                
                // Pixiv
                const pixiv = config.platforms.find((p: any) => p.name === 'Pixiv' && p.enabled);
                if (pixiv) {
                    const userId = pixiv.config_fields?.find((f: any) => f.key === 'user_id')?.value;
                    if (userId) {
                        links.push({
                            platform: 'Pixiv',
                            url: `https://www.pixiv.net/users/${userId}`,
                            displayName: 'Pixiv',
                            brandColor: '#0096fa'
                        });
                    }
                }
            }
            
            setPlatformLinks(links);
        } catch (err) {
            // Failed to fetch user info
        }
    };

    // 获取所有平台数据
    const fetchAllData = async () => {
        try {
            setProgress('步骤 1/3: 正在连接平台获取数据...');
            setProgressPercent(10);

            const response = await fetch('http://localhost:3000/api/profile/fetch-all', {
                method: 'POST',
            });

            setProgressPercent(40);

            if (!response.ok) {
                throw new Error(`Failed to fetch data: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.data) {
                setProgressPercent(50);
                return result.data;
            } else {
                throw new Error('No data returned');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            throw new Error(message);
        }
    };

    // 生成报告
    const generateReport = async (data: any, forceRefresh: boolean = false) => {
        try {
            setProgress('步骤 2/3: AI 正在分析数据...');
            setProgressPercent(55);
            
            const url = forceRefresh 
                ? 'http://localhost:3000/api/profile/report?force=true'
                : 'http://localhost:3000/api/profile/report';
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            setProgressPercent(80);

            if (!response.ok) {
                throw new Error(`Failed to generate report: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.report) {
                setProgress('步骤 3/3: 生成卡片报告...');
                setProgressPercent(90);
                
                setReport(result.report);
                // 从所有卡片中随机抽取6张显示
                const randomCards = getRandomCards(result.report, 6);
                setDisplayCards(randomCards);
                setFromCache(result.from_cache || false);
                setProgressPercent(100);
            } else {
                throw new Error('Failed to parse report');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            throw new Error(message);
        }
    };

    // 一键生成报告（添加防抖）
    const handleGenerateReport = useCallback(async (forceRefresh: boolean = false) => {
        // 防止重复调用
        if (loading) {
            return;
        }

        // 检查登录状态
        const token = localStorage.getItem('auth_token');
        if (!token) {
            setError('请先登录后再生成报告');
            // 可选：显示一个提示模态框或跳转到登录
            alert('请先登录后再生成报告');
            return;
        }

        try {
            setLoading(true);
            setError(null);
            setProgressPercent(0);

            // 1. 获取所有数据
            const data = await fetchAllData();

            // 2. 生成报告（强制刷新）
            await generateReport(data, forceRefresh);
            
            // 完成
            await new Promise(resolve => setTimeout(resolve, 300)); // 短暂延迟显示100%
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            setProgressPercent(0);
        } finally {
            setLoading(false);
            setProgress('');
        }
    }, [loading, getRandomCards]); // 添加loading依赖

    // 加载已有报告（优先从缓存读取，不自动生成）
    useEffect(() => {
        const loadExistingReport = async () => {
            // 获取用户信息
            fetchUserInfo();

            // 获取萌宠配置
            try {
                const configResponse = await fetch(`${API_URL}/api/config`);
                if (configResponse.ok) {
                    const configData = await configResponse.json();
                    const petEnabledValue = configData.ui_config?.config_fields?.find((f: any) => f.key === 'pet_enabled')?.value;
                    const petImageValue = configData.ui_config?.config_fields?.find((f: any) => f.key === 'pet_image_url')?.value;
                    
                    if (petEnabledValue !== undefined) {
                        const enabled = petEnabledValue === 'true' || petEnabledValue === true;
                        setPetEnabled(enabled);
                    }
                    if (petImageValue) {
                        setPetImageUrl(petImageValue);
                        // 设置 CSS 变量
                        if (typeof document !== 'undefined') {
                            document.documentElement.style.setProperty('--pet-image-url', `url('${petImageValue}')`);
                        }
                    }
                }
            } catch (err) {
                // Failed to load pet config
            }

            try {
                const response = await fetch(`${API_URL}/api/profile/report`);
                if (response.ok) {
                    const result = await response.json();
                    if (result.report && result.report.cards && result.report.cards.length > 0) {
                        setReport(result.report);
                        // 从所有卡片中随机抽取6张显示
                        const randomCards = getRandomCards(result.report, 6);
                        setDisplayCards(randomCards);
                        setFromCache(result.from_cache || false);
                        setLoading(false);
                        return;
                    }
                }
                // 没有报告时显示空状态，不自动生成
                setLoading(false);
            } catch (err) {
                setError('加载报告失败');
                setLoading(false);
            }
        };

        loadExistingReport();
    }, [getRandomCards]);

    // 暴露生成函数供外部调用
    useEffect(() => {
        (window as any).generateReport = () => handleGenerateReport(true); // 始终强制刷新
        
        // 清理函数
        return () => {
            delete (window as any).generateReport;
        };
    }, [handleGenerateReport]);

    // 更新进度条宽度
    useEffect(() => {
        const progressBar = document.querySelector('.progress-bar-fill') as HTMLElement;
        if (progressBar) {
            progressBar.style.setProperty('--progress', progressPercent.toString());
        }
    }, [progressPercent]);

    // 监控 displayCards 的变化，确保始终显示6张卡片
    useEffect(() => {
        if (displayCards.length > 0 && displayCards.length !== 6) {
            // Expected 6 cards but got different amount
        }
    }, [displayCards]);

    // 弹窗打开时锁定背景滚动
    useEffect(() => {
        if (selectedCard && !isModalClosing) {
            // 使用overflow:hidden锁定滚动，保持位置不变
            const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.overflow = 'hidden';
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        } else if (!selectedCard) {
            // 弹窗完全关闭后恢复
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }
    }, [selectedCard, isModalClosing]);

    // 萌宠走动动画 - 使用上传的像素画
    useEffect(() => {
        if (!report || !petEnabled) return;

        const pet = document.getElementById('pet-walker');
        const sprite = pet?.querySelector('.pet-sprite') as HTMLElement;
        const card = document.querySelector('.report-info-card');
        if (!pet || !sprite || !card) return;

        // 预加载图片以获取实际尺寸
        const img = new Image();
        img.src = petImageUrl;
        
        img.onload = () => {
            const naturalWidth = img.naturalWidth;
            const naturalHeight = img.naturalHeight;
            
            // 根据图片实际尺寸动态调整显示大小和位置
            const maxSize = 80; // 最大尺寸限制
            let displayWidth = naturalWidth;
            let displayHeight = naturalHeight;
            
            // 等比缩放到合适大小
            if (naturalWidth > maxSize || naturalHeight > maxSize) {
                const scale = Math.min(maxSize / naturalWidth, maxSize / naturalHeight);
                displayWidth = naturalWidth * scale;
                displayHeight = naturalHeight * scale;
            }
            
            // 设置精灵大小
            sprite.style.width = `${displayWidth}px`;
            sprite.style.height = `${displayHeight}px`;
            pet.style.width = `${displayWidth}px`;
            pet.style.height = `${displayHeight}px`;
            
            // 调整垂直位置，确保底部精准贴在卡片上边缘
            // 使用负的高度值让角色底部正好在卡片顶部
            pet.style.top = `-${displayHeight}px`;
            
            // 启动走路动画
            pet.classList.add('walking');
        };

        let animationId: number;
        let currentPosition = Math.random() * 200; // 随机起始位置 0-200px
        let direction = Math.random() < 0.5 ? 1 : -1; // 随机初始方向
        let isPaused = false;
        let currentSpeed = 0.1 + Math.random() * 0.1; // 减小速度范围 0.1-0.2
        
        const updateMaxPosition = () => {
            const cardWidth = card.getBoundingClientRect().width;
            const petWidth = parseFloat(pet.style.width) || 64;
            return cardWidth - petWidth;
        };
        
        let maxPosition = updateMaxPosition();
        
        // 确保初始位置在有效范围内
        if (currentPosition > maxPosition) {
            currentPosition = maxPosition;
        }
        
        // 设置初始方向的翻转效果
        pet.style.transform = direction === 1 ? 'scaleX(1)' : 'scaleX(-1)';

        const animate = () => {
            if (!isPaused) {
                currentPosition += direction * currentSpeed;
                maxPosition = updateMaxPosition(); // 动态更新最大位置
                
                // 边界检测和转向
                if (currentPosition >= maxPosition) {
                    currentPosition = maxPosition;
                    direction = -1;
                    pet.style.transform = 'scaleX(-1)';
                    // 转向时随机改变速度
                    currentSpeed = 0.1 + Math.random() * 0.1;
                } else if (currentPosition <= 0) {
                    currentPosition = 0;
                    direction = 1;
                    pet.style.transform = 'scaleX(1)';
                    // 转向时随机改变速度
                    currentSpeed = 0.1 + Math.random() * 0.1;
                }

                pet.style.left = `${currentPosition}px`;

                // 随机暂停（降低频率，增加停留时间）
                if (Math.random() < 0.001) {
                    isPaused = true;
                    pet.classList.remove('walking');
                    sprite.style.transform = 'translateY(0)';
                    const pauseDuration = 2000 + Math.random() * 4000; // 2-6秒随机暂停
                    setTimeout(() => {
                        isPaused = false;
                        pet.classList.add('walking');
                        // 恢复时随机改变速度和方向
                        currentSpeed = 0.1 + Math.random() * 0.1;
                        if (Math.random() < 0.3) {
                            direction *= -1;
                            pet.style.transform = direction === 1 ? 'scaleX(1)' : 'scaleX(-1)';
                        }
                    }, pauseDuration);
                }
            }

            animationId = requestAnimationFrame(animate);
        };

        // 点击暂停/继续
        const handleClick = () => {
            isPaused = !isPaused;
        };

        pet.addEventListener('click', handleClick);
        animationId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animationId);
            pet.removeEventListener('click', handleClick);
        };
    }, [report, petEnabled, petImageUrl]);

    // 设置平台链接的 CSS 变量
    useEffect(() => {
        if (!platformLinks.length) return;
        
        // 为每个平台链接元素设置 CSS 变量
        const links = document.querySelectorAll('.platform-link');
        links.forEach((link) => {
            const brandColor = link.getAttribute('data-brand-color');
            if (brandColor) {
                (link as HTMLElement).style.setProperty('--brand-color', brandColor);
            }
        });
    }, [platformLinks]);

    // 为每张卡片生成插画
    // 移除自动生成插图的 useEffect
    // 插图现在需要在配置页面手动生成

    if (!report) {
        return (
            <div className="max-w-7xl mx-auto px-4 py-16">
                <div className="text-center">
                    {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-xl mb-4 max-w-md mx-auto">
                            {error}
                        </div>
                    )}

                    {loading && (
                        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-t border-gray-200 shadow-lg z-50">
                            <div className="max-w-4xl mx-auto px-6 py-6">
                                <div className="mb-3 text-center">
                                    <p className="text-sm font-medium text-gray-700">{progress}</p>
                                </div>
                                
                                {/* 进度条 - 使用动态颜色 */}
                                <div className="relative w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div 
                                        className="absolute top-0 left-0 h-full transition-all duration-500 ease-out rounded-full progress-bar-fill"
                                        data-progress={progressPercent}
                                    ></div>
                                </div>
                                
                                <p className="text-xs text-gray-500 text-center mt-2">{progressPercent}% 完成</p>
                            </div>
                        </div>
                    )}

                    {/* 空状态：无报告时的提示 */}
                    {!loading && !error && (
                        <div className="max-w-md mx-auto">
                            <div className="mb-6 flex items-center justify-center">
                                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center">
                                    <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                </div>
                            </div>
                            <h2 className="text-2xl font-bold text-gray-800 mb-4">还没有生成报告</h2>
                            <p className="text-gray-600 mb-8">
                                点击导航岛的灯泡图标开始生成您的个性化数据报告
                            </p>
                            <div className="glass rounded-2xl p-6 text-left">
                                <h3 className="font-bold text-gray-800 mb-3">报告将包含：</h3>
                                <ul className="space-y-2 text-sm text-gray-600">
                                    <li className="flex items-start gap-2">
                                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>6个精选话题的深度分析</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>AI 驱动的个性化洞察</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>跨平台数据整合</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>报告7天有效，过期后自动刷新</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const getExpiryInfo = () => {
        const expiresAt = new Date(report.expires_at);
        const now = new Date();
        const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysLeft;
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            {/* 报告信息条 */}
            <div className="mb-6 glass rounded-3xl p-5 border shadow-lg report-info-card relative">
                {/* 动态萌宠 - 使用精灵图动画 */}
                {petEnabled && (
                    <div 
                        id="pet-walker"
                        className="pet-walker absolute left-0 cursor-pointer z-10"
                        onClick={(e) => {
                            const pet = e.currentTarget;
                            pet.classList.add('pet-excited');
                            setTimeout(() => pet.classList.remove('pet-excited'), 600);
                        }}
                    >
                        <div className="pet-sprite"></div>
                    </div>
                )}

                <div className="flex items-center justify-between gap-6">
                    {/* 左侧区域1：用户信息 */}
                    <div className="flex items-center gap-4">
                        {userInfo ? (
                            <>
                                {/* 头像 - 仅管理员可点击 */}
                                {isAdmin ? (
                                    <a
                                        href="/account"
                                        className="relative cursor-pointer group/avatar"
                                    >
                                        {!avatarError ? (
                                            <img
                                                src={userInfo.avatar}
                                                alt={userInfo.name}
                                                className="w-14 h-14 rounded-2xl object-cover shadow-md ring-2 ring-white/50 transition-all duration-300 group-hover/avatar:scale-105 group-hover/avatar:shadow-2xl"
                                                crossOrigin="anonymous"
                                                referrerPolicy="no-referrer"
                                                onError={() => setAvatarError(true)}
                                            />
                                        ) : (
                                            <img
                                                src={getDefaultAvatar(userInfo.name)}
                                                alt={userInfo.name}
                                                className="w-14 h-14 rounded-2xl object-cover shadow-md ring-2 ring-white/50 transition-all duration-300 group-hover/avatar:scale-105 group-hover/avatar:shadow-2xl"
                                            />
                                        )}
                                        {/* 简约提示角标 */}
                                        <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 group-hover/avatar:scale-110 group-hover/avatar:shadow-xl avatar-badge">
                                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </span>
                                    </a>
                                ) : (
                                    <div className="relative group/avatar">
                                        {!avatarError ? (
                                            <img
                                                src={userInfo.avatar}
                                                alt={userInfo.name}
                                                className="w-14 h-14 rounded-2xl object-cover shadow-md ring-2 ring-white/50 transition-all duration-300 group-hover/avatar:scale-105 group-hover/avatar:shadow-2xl cursor-default"
                                                crossOrigin="anonymous"
                                                referrerPolicy="no-referrer"
                                                onError={() => setAvatarError(true)}
                                            />
                                        ) : (
                                            <img
                                                src={getDefaultAvatar(userInfo.name)}
                                                alt={userInfo.name}
                                                className="w-14 h-14 rounded-2xl object-cover shadow-md ring-2 ring-white/50 transition-all duration-300 group-hover/avatar:scale-105 group-hover/avatar:shadow-2xl cursor-default"
                                            />
                                        )}
                                    </div>
                                )}
                                <div>
                                    <h3 className="text-lg font-bold text-gray-800">{userInfo.name}</h3>
                                    <p className="text-xs text-gray-500">
                                        {userInfo.bio}
                                    </p>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-200 to-gray-300 animate-pulse"></div>
                                <div>
                                    <div className="h-5 w-24 bg-gray-200 rounded animate-pulse mb-1"></div>
                                    <div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
                                </div>
                            </>
                        )}
                    </div>
                    
                    {/* 中间区域2：社交网络胶囊 - 智能2行布局 */}
                    {platformLinks.length > 0 && (
                        <div className="flex-1 max-w-sm">
                            <div 
                                className="flex flex-wrap gap-2"
                            >
                                {platformLinks.map((link) => (
                                    <a
                                        key={link.platform}
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="platform-link inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold no-underline transition-all duration-250 backdrop-blur-sm cursor-pointer whitespace-nowrap"
                                        data-brand-color={link.brandColor}
                                        title={`访问 ${link.displayName}`}
                                    >
                                        <PlatformIcon 
                                            platform={link.platform} 
                                            className="w-4 h-4 transition-transform duration-250 group-hover:scale-110"
                                        />
                                        <span>{link.displayName}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 右侧区域3：报告信息 */}
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3">
                            <div className="text-2xl">
                                ✨
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-gray-700">
                                    {fromCache ? '从缓存加载' : '新鲜生成'}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {getExpiryInfo()}天后更新 · 共{(report.all_cards && report.all_cards.length > 0) ? report.all_cards.length : report.cards.length}个话题
                                </p>
                            </div>
                        </div>
                        {(() => {
                            // 获取可用的总卡片数
                            const totalCards = (report.all_cards && report.all_cards.length > 0) 
                                ? report.all_cards.length 
                                : report.cards.length;
                            const shouldShowShuffle = totalCards > 6;
                            
                            
                            return shouldShowShuffle ? (
                                <button
                                    onClick={() => {
                                        if (isCardTransitioning) return; // 防止动画期间重复点击
                                        setIsCardTransitioning(true);
                                        // 延迟后切换卡片
                                        setTimeout(() => {
                                            const newCards = getRandomCards(report, 6);
                                            setDisplayCards(newCards);
                                            // 动画完成后重置状态
                                            setTimeout(() => {
                                                setIsCardTransitioning(false);
                                            }, 100);
                                        }, 400);
                                    }}
                                    className="shuffle-btn relative px-5 py-2.5 rounded-2xl text-sm font-medium transition-all duration-300 hover:scale-105 active:scale-95 hover:shadow-lg"
                                    aria-label="换一批"
                                    disabled={isCardTransitioning}
                                >
                                    <svg className="w-4 h-4 inline-block mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    换一批
                                </button>
                            ) : null;
                        })()}
                    </div>
                </div>
            </div>

            {/* 卡片网格 */}
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transition-all duration-500 ease-out ${isCardTransitioning ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'}`}>
                {displayCards.slice(0, 6).map((card, index) => (
                    <article
                        key={card.generated_at ? `${card.generated_at}-${card.topic_id}` : `card-${index}-${card.topic_id}`}
                        className="glass rounded-3xl p-6 hover:shadow-2xl transition-all duration-300 border report-card cursor-pointer hover:scale-[1.02] active:scale-[0.98] group"
                        onClick={() => setSelectedCard(card)}
                    >
                        {/* 插画背景 */}
                        {card.illustration && (
                            <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity duration-300 rounded-3xl overflow-hidden">
                                <img
                                    src={card.illustration}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                />
                            </div>
                        )}

                        <div className="relative z-10">
                            {/* Card Header */}
                            <div className="flex items-center justify-between mb-4">
                                <div
                                    className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-lg text-2xl`}
                                >
                                    {card.icon}
                                </div>
                                
                                {/* 更多按钮 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedCard(card);
                                    }}
                                    className="text-gray-400 hover:text-gray-600 transition-all duration-200 p-2 rounded-full hover:bg-gray-100 active:scale-90 opacity-0 group-hover:opacity-100"
                                    aria-label="查看详情"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </div>

                            {/* Card Title */}
                            <h2 className="text-sm text-gray-600 mb-2 transition-colors duration-200 group-hover:text-gray-800">
                                {card.title}
                            </h2>

                            {/* Card Summary */}
                            <p className="text-xl font-bold text-gray-900 line-clamp-2 mb-3 transition-colors duration-200 group-hover:text-gray-950">
                                {card.content.summary}
                            </p>

                            {/* Tags */}
                            {card.content.tags && card.content.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {card.content.tags.map((tag, i) => (
                                        <span
                                            key={i}
                                            className="px-3 py-1 rounded-full text-xs font-medium text-white tag-badge transition-all duration-200 hover:scale-105 cursor-default"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </article>
                ))}
            </div>

            {/* 详情弹窗 - 使用Portal渲染到body */}
            {selectedCard && typeof document !== 'undefined' && createPortal(
                <div 
                    className={`modal-overlay-portal ${isModalClosing ? 'modal-closing' : 'modal-opening'}`}
                    onClick={() => {
                        setIsModalClosing(true);
                        setTimeout(() => {
                            setSelectedCard(null);
                            setIsModalClosing(false);
                        }, 250);
                    }}
                >
                    <div 
                        className={`modal-content ${isModalClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 滚动内容区 */}
                        <div className="overflow-y-auto max-h-[85vh] custom-scrollbar">
                            <div className="p-10">
                                {/* 头部区域 */}
                                <div className="flex items-start justify-between mb-10">
                                    <div className="flex items-start gap-5">
                                        <div
                                            className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${selectedCard.color} flex items-center justify-center shadow-lg text-3xl flex-shrink-0 transition-transform hover:scale-110`}
                                        >
                                            {selectedCard.icon}
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-gray-900 mb-3">
                                                {selectedCard.title}
                                            </h2>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm text-gray-500">
                                                    {selectedCard.category}
                                                </span>
                                                {selectedCard.content.tags && selectedCard.content.tags.length > 0 && (
                                                    <>
                                                        <span className="text-gray-300">·</span>
                                                        {selectedCard.content.tags.map((tag, i) => (
                                                            <span key={i} className="tag-badge px-2.5 py-1 rounded-full text-xs font-medium text-white transition-all duration-200 hover:scale-110 hover:shadow-md cursor-default">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setIsModalClosing(true);
                                            setTimeout(() => {
                                                setSelectedCard(null);
                                                setIsModalClosing(false);
                                            }, 250);
                                        }}
                                        className="text-gray-400 hover:text-gray-700 transition-all duration-200 p-2.5 rounded-xl hover:bg-gray-100 active:scale-90 hover:rotate-90"
                                        aria-label="关闭"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>

                                {/* 插画展示 */}
                                {selectedCard.illustration && (
                                    <div className="mb-10 rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:scale-[1.01]">
                                        <img
                                            src={selectedCard.illustration}
                                            alt={selectedCard.title}
                                            className="w-full h-80 object-cover transition-transform duration-500 hover:scale-105"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                    </div>
                                )}

                                {/* 摘要 */}
                                <div className="mb-8">
                                    <p className="text-lg text-gray-800 leading-relaxed font-medium">
                                        {selectedCard.content.summary}
                                    </p>
                                </div>

                                {/* 详细内容 */}
                                {selectedCard.content.details && selectedCard.content.details.length > 0 && (
                                    <div className="mb-8">
                                        <div className="space-y-4">
                                            {selectedCard.content.details.map((detail, i) => (
                                                <div key={i} className="flex items-start gap-4 transition-all duration-200 hover:translate-x-2 hover:bg-gray-50 p-3 rounded-xl -mx-3">
                                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center mt-0.5 transition-transform duration-200 group-hover:scale-110">
                                                        {i + 1}
                                                    </span>
                                                    <p className="flex-1 text-base text-gray-700 leading-relaxed">
                                                        {detail}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* AI 洞察 */}
                                {selectedCard.content.highlight && (
                                    <div className="pt-6 border-t border-gray-200">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-100 to-orange-100 flex items-center justify-center">
                                                <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                                </svg>
                                            </div>
                                            <h3 className="text-base font-bold text-gray-900">AI 洞察</h3>
                                        </div>
                                        <div className="pl-4 border-l-4 transition-all hover:pl-5 ai-insight-border">
                                            <p className="text-base text-gray-700 leading-relaxed italic">
                                                {selectedCard.content.highlight}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* 提示信息 */}
            <div className="mt-8 text-center text-sm text-gray-500">
                <p>报告每7天自动更新一次，每次随机选择6个话题进行分析</p>
                <p className="mt-1">点击导航岛的灯泡图标可立即重新生成</p>
            </div>
        </div>
    );
}
