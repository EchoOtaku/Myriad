import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../config';
import PlatformIcon from './PlatformIcon';
import Loader from './Loader';
import { Spinner } from './Spinner';
import TokenManager from '../utils/tokenManager';
import { getCSRFToken } from '../utils/csrf';
import './ReportCards.css';

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

interface VirtualPersona {
    slot: number; // 槽位号（0或1）
    name: string;
    personality: string;
    appearance: string;
    hobbies: string[];
    life_style: string;
    visual_style?: string;
    image_prompt: string;
    image_url?: string;
    generated_at: string;
    has_image: boolean;
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
    const [isCardTransitioning, setIsCardTransitioning] = useState(false); // 卡片切换动画状态
    const [isCardModalClosing, setIsCardModalClosing] = useState(false); // 卡片弹窗关闭动画状态
    const [isPersonaModalClosing, setIsPersonaModalClosing] = useState(false); // 虚拟人物弹窗关闭动画状态
    const [contentReady, setContentReady] = useState(false); // 内容是否准备好显示
    const [cardAnimationPhase, setCardAnimationPhase] = useState<'enter' | 'exit' | 'idle'>('idle'); // 卡片动画阶段
    const [pageExiting, setPageExiting] = useState(false); // 页面是否正在退出
    const [showPersonaModal, setShowPersonaModal] = useState(false); // 虚拟人物弹窗状态
    const [personaData, setPersonaData] = useState<VirtualPersona | null>(null); // 当前显示的虚拟人物数据
    const [personaList, setPersonaList] = useState<VirtualPersona[]>([]); // 虚拟人物列表（最多2个）
    const [currentPersonaIndex, setCurrentPersonaIndex] = useState(0); // 当前显示的人设索引
    const [personaLoading, setPersonaLoading] = useState(false); // 虚拟人物加载状态
    const [personaEnabled, setPersonaEnabled] = useState(true); // 虚拟人物功能是否启用
    const [editingImagePrompt, setEditingImagePrompt] = useState(false); // 是否在编辑图片prompt
    const [imagePrompt, setImagePrompt] = useState(''); // 图片prompt编辑内容
    const [generatingImage, setGeneratingImage] = useState(false); // 是否正在生成图片

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

    // 检测用户是否为管理员（静默处理，不主动请求）
    useEffect(() => {
        // 监听登录状态变化时更新管理员状态
        const handleAuthChange = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.isAuthenticated && customEvent.detail?.isAdmin !== undefined) {
                setIsAdmin(customEvent.detail.isAdmin === true);
            } else {
                setIsAdmin(false);
            }
        };

        window.addEventListener('auth-state-changed', handleAuthChange as EventListener);
        return () => {
            window.removeEventListener('auth-state-changed', handleAuthChange as EventListener);
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

    // 获取用户信息 - 🚀 性能优化：使用批量API减少请求次数
    const fetchUserInfo = async () => {
        try {
            // 使用批量API一次性获取所有信息（user_info + config + cache_debug）
            const batchResponse = await fetch(`${API_URL}/api/profile/batch`);

            // 如果批量API失败（如后端未重启），回退到原来的方式
            if (!batchResponse.ok) {
                console.warn('Batch API failed, falling back to individual requests');
                return fetchUserInfoFallback();
            }

            const batchData = await batchResponse.json();

            // 1. 处理用户信息
            if (batchData.user_info?.success && batchData.user_info?.user_info) {
                const userInfoResult = batchData.user_info;
                setUserInfo({
                    name: userInfoResult.user_info.name,
                    avatar: userInfoResult.user_info.avatar,
                    platform: userInfoResult.user_info.platform,
                    bio: userInfoResult.user_info.bio
                });
            }

            // 2. 获取公开的平台配置（用于社交链接显示）
            const configResponse = await fetch(`${API_URL}/api/config/public`);
            const config = configResponse.ok ? await configResponse.json() : {};
            const links: PlatformLink[] = [];

            // 3. 获取缓存数据
            let cachedData: any = null;
            if (batchData.cache_debug?.success && batchData.cache_debug?.cache_entries) {
                const cacheEntries = batchData.cache_debug.cache_entries;
                if (cacheEntries.length > 0) {
                    // 找到最新的有效缓存（这里简化处理，实际需要根据 is_valid 判断）
                    const validCache = cacheEntries[0];
                    if (validCache?.raw_data) {
                        cachedData = validCache.raw_data;
                    }
                }
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
            // 如果批量API出错，使用回退方案
            console.error('Batch API error, using fallback:', err);
            return fetchUserInfoFallback();
        }
    };

    // 回退方案：使用原来的多个请求方式
    const fetchUserInfoFallback = async () => {
        try {
            // 优先从后端缓存获取用户信息
            const userInfoResponse = await fetch(`${API_URL}/api/profile/user-info`);
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

            // 获取公开的平台配置以构建平台链接
            const configResponse = await fetch(`${API_URL}/api/config/public`);
            const config = await configResponse.json();

            const links: PlatformLink[] = [];

            // 尝试获取缓存的平台数据（包含Steam用户名等）
            let cachedData: any = null;
            try {
                const cacheResponse = await fetch(`${API_URL}/api/profile/cache-debug`);
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

                // Netease Music
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
            console.error('Fallback fetch failed:', err);
        }
    };

    // 获取所有平台数据
    const fetchAllData = async () => {
        try {
            setProgress('步骤 1/3: 正在连接平台获取数据...');
            setProgressPercent(10);

            // 获取 CSRF Token
            const csrfToken = await getCSRFToken(true);
            if (!csrfToken) {
                throw new Error('无法获取 CSRF Token');
            }

            const response = await fetch(`${API_URL}/api/profile/fetch-all`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'include',
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

    // 获取虚拟人物数据列表
    const fetchPersonaData = async () => {
        try {
            setPersonaLoading(true);

            // 获取 CSRF Token
            const csrfToken = await getCSRFToken(true);
            if (!csrfToken) {
                throw new Error('无法获取 CSRF Token');
            }

            // 生成新人设
            const response = await fetch(`${API_URL}/api/persona/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'include', // ✅ 发送认证 Cookie
                body: JSON.stringify({}),
            });

            if (!response.ok) {
                throw new Error(`Failed to generate persona: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.persona) {
                // 获取最新的人设列表
                await fetchPersonaList();
                return result.persona;
            } else {
                throw new Error(result.message || 'Failed to generate persona');
            }
        } catch (err) {
            console.error('Failed to fetch persona:', err);
            throw err;
        } finally {
            setPersonaLoading(false);
        }
    };

    // 获取人设列表
    const fetchPersonaList = async () => {
        try {
            const response = await fetch(`${API_URL}/api/persona/list`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch persona list: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.personas) {
                setPersonaList(result.personas);
                if (result.personas.length > 0) {
                    // 设置当前显示的人设为第一个（或保持当前索引）
                    const index = currentPersonaIndex < result.personas.length ? currentPersonaIndex : 0;
                    setCurrentPersonaIndex(index);
                    setPersonaData(result.personas[index]);
                } else {
                    setPersonaData(null);
                }
            }
        } catch (err) {
            console.error('Failed to fetch persona list:', err);
        }
    };

    // 切换人设
    const switchPersona = (direction: 'prev' | 'next') => {
        if (personaList.length === 0) return;
        
        let newIndex;
        if (direction === 'next') {
            newIndex = (currentPersonaIndex + 1) % personaList.length;
        } else {
            newIndex = (currentPersonaIndex - 1 + personaList.length) % personaList.length;
        }
        
        setCurrentPersonaIndex(newIndex);
        setPersonaData(personaList[newIndex]);
    };

    // 打开虚拟人物弹窗
    const openPersonaModal = async () => {
        setShowPersonaModal(true);
        // 加载人设列表
        await fetchPersonaList();
    };

    // 生成人物图片
    const generatePersonaImage = async (prompt: string) => {
        try {
            setGeneratingImage(true);
            
            // 获取 CSRF Token
            const csrfToken = await getCSRFToken(true);
            if (!csrfToken) {
                throw new Error('无法获取 CSRF Token');
            }
            
            // 获取当前人设的slot
            const currentSlot = personaData?.slot || 0;
            
            const response = await fetch(`${API_URL}/api/persona/generate-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'include',
                body: JSON.stringify({ 
                    image_prompt: prompt,
                    slot: currentSlot 
                }),
            });

            if (!response.ok) {
                throw new Error(`Failed to generate image: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success && result.image_url && personaData) {
                // 更新本地personaData
                setPersonaData({
                    ...personaData,
                    image_url: result.image_url,
                    image_prompt: prompt,
                    has_image: true,
                });
                setEditingImagePrompt(false);
                return result.image_url;
            } else {
                throw new Error(result.message || 'Failed to generate image');
            }
        } catch (err) {
            console.error('Failed to generate image:', err);
            alert('生成图片失败: ' + (err instanceof Error ? err.message : 'Unknown error'));
            throw err;
        } finally {
            setGeneratingImage(false);
        }
    };

    // 删除人设
    const deletePersona = async (slot: number) => {
        if (!confirm(`确定要删除这个人设吗？此操作不可恢复。`)) {
            return;
        }

        try {
            setPersonaLoading(true);
            
            // 获取 CSRF Token
            const csrfToken = await getCSRFToken(true);
            if (!csrfToken) {
                throw new Error('无法获取 CSRF Token');
            }
            
            const response = await fetch(`${API_URL}/api/persona/delete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'include', // ✅ 发送认证 Cookie
                body: JSON.stringify({ slot }),
            });

            if (!response.ok) {
                throw new Error(`Failed to delete persona: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success) {
                // 刷新人设列表
                await fetchPersonaList();
                
                // 如果删除的是当前显示的人设，切换到第一个
                if (personaList.length > 0 && currentPersonaIndex >= personaList.length) {
                    setCurrentPersonaIndex(0);
                    setPersonaData(personaList[0]);
                } else if (personaList.length === 0) {
                    setPersonaData(null);
                }
                
                alert('人设已删除');
            } else {
                throw new Error(result.message || 'Failed to delete persona');
            }
        } catch (err) {
            console.error('Failed to delete persona:', err);
            alert('删除失败: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            setPersonaLoading(false);
        }
    };

    // 生成报告
    const generateReport = async (data: any, forceRefresh: boolean = false) => {
        try {
            setProgress('步骤 2/3: AI 正在分析数据...');
            setProgressPercent(55);
            
            // 获取 CSRF Token
            const csrfToken = await getCSRFToken(true);
            if (!csrfToken) {
                throw new Error('无法获取 CSRF Token');
            }
            
            const url = forceRefresh 
                ? `${API_URL}/api/profile/report?force=true`
                : `${API_URL}/api/profile/report`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'include', // ✅ 发送认证 Cookie
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

            // 移除loading类，恢复原状
            const generateBtn = document.getElementById('generate-report-btn');
            if (generateBtn) {
                generateBtn.classList.remove('loading');
            }
        }
    }, [loading, getRandomCards]); // 添加loading依赖

    // 监听页面卸载，触发退出动画
    useEffect(() => {
        return () => {
            // 组件即将卸载时，标记页面正在退出
            setPageExiting(true);
        };
    }, []);

    // 加载已有报告（优先从缓存读取，不自动生成）
    useEffect(() => {
        const loadExistingReport = async () => {
            // 获取用户信息
            fetchUserInfo();

            // 获取公开的 UI 配置（萌宠、虚拟人设等）
            try {
                const uiConfigResponse = await fetch(`${API_URL}/api/config/ui`);
                if (uiConfigResponse.ok) {
                    const uiConfig = await uiConfigResponse.json();
                    
                    if (uiConfig.pet_enabled !== undefined) {
                        setPetEnabled(uiConfig.pet_enabled);
                    }
                    if (uiConfig.pet_image_url) {
                        setPetImageUrl(uiConfig.pet_image_url);
                        // 设置 CSS 变量
                        if (typeof document !== 'undefined') {
                            document.documentElement.style.setProperty('--pet-image-url', `url('${uiConfig.pet_image_url}')`);
                        }
                    }
                    if (uiConfig.persona_image_enabled !== undefined) {
                        setPersonaEnabled(uiConfig.persona_image_enabled);
                    }
                }
            } catch (err) {
                // Failed to load UI config
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
                        // 短暂延迟后显示内容，确保淡入效果
                        setTimeout(() => setContentReady(true), 100);
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

    // 发送进度事件给AppLayout显示
    useEffect(() => {
        if (loading) {
            window.dispatchEvent(new CustomEvent('report-progress', {
                detail: { progress, progressPercent }
            }));
        } else {
            window.dispatchEvent(new CustomEvent('report-progress-end'));
        }
    }, [loading, progress, progressPercent]);

    // 统一的弹窗滚动锁定 - 支持多个弹窗
    useEffect(() => {
        const hasOpenModal = (selectedCard && !isCardModalClosing) || (showPersonaModal && !isPersonaModalClosing);

        if (hasOpenModal) {
            // 使用overflow:hidden锁定滚动，保持位置不变
            const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.overflow = 'hidden';
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        } else {
            // 所有弹窗关闭后恢复
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }
    }, [selectedCard, showPersonaModal, isCardModalClosing, isPersonaModalClosing]);

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

    // 品牌色通过内联样式直接设置，无需useEffect

    // 为每张卡片生成插画
    // 移除自动生成插图的 useEffect
    // 插图现在需要在配置页面手动生成

    // 初始加载状态 - 不显示加载动画
    if (loading && !report) {
        return null;
    }

    // 无报告且加载完成 - 显示提示
    if (!report) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[600px] gap-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-md">
                    {error || "点击导航岛的灯泡图标开始生成报告"}
                </p>
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
        <>
        <div className="max-w-6xl mx-auto px-4 py-8">

            {/* 报告信息条 - 移动端堆叠布局 */}
            <div className={`mb-6 glass rounded-3xl p-4 md:p-5 border shadow-lg report-info-card relative ${
                pageExiting
                    ? 'info-card-exit-animated'
                    : contentReady
                        ? 'info-card-animated'
                        : 'opacity-0'
            }`}>
                {/* 动态萌宠 - 使用精灵图动画 - 桌面端显示 */}
                {petEnabled && (
                    <div 
                        id="pet-walker"
                        className="pet-walker absolute left-0 cursor-pointer z-10 hidden md:block"
                        onClick={(e) => {
                            const pet = e.currentTarget;
                            pet.classList.add('pet-excited');
                            setTimeout(() => pet.classList.remove('pet-excited'), 600);
                        }}
                    >
                        <div className="pet-sprite"></div>
                    </div>
                )}

                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-6">
                    {/* 左侧区域1：用户信息 */}
                    <div className="flex items-center gap-4">
                        {userInfo ? (
                            <>
                                {/* 头像 */}
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
                                <div>
                                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{userInfo.name}</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
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
                    
                    {/* 中间区域2：社交网络胶囊 - 移动端全宽，桌面端居中 */}
                    {platformLinks.length > 0 && (
                        <div className="w-full md:flex-1 md:max-w-sm order-3 md:order-2">
                            <div 
                                className="flex flex-wrap gap-2"
                            >
                                {platformLinks.map((link) => {
                                    // 深色平台需要在深色模式下使用反色
                                    const isDarkPlatform = ['#181717', '#1b2838'].includes(link.brandColor);
                                    const lightModeColor = link.brandColor;
                                    // GitHub反色: #e6e6e6, Steam反色: #5a8fc7
                                    const darkModeColor = link.brandColor === '#181717' ? '#e6e6e6' : 
                                                         link.brandColor === '#1b2838' ? '#5a8fc7' : 
                                                         link.brandColor;
                                    
                                    return (
                                        <a
                                            key={link.platform}
                                            href={link.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="platform-link inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold no-underline transition-all duration-250 backdrop-blur-sm cursor-pointer whitespace-nowrap"
                                            // 必须使用内联样式来动态设置 CSS 变量
                                            style={{
                                                '--brand-color-light': lightModeColor,
                                                '--brand-color-dark': darkModeColor,
                                            } as React.CSSProperties}
                                            data-brand-color={link.brandColor}
                                            data-dark-platform={isDarkPlatform ? 'true' : 'false'}
                                            title={`访问 ${link.displayName}`}
                                        >
                                            <PlatformIcon 
                                                platform={link.platform} 
                                                className="w-4 h-4 transition-transform duration-250"
                                            />
                                            <span>{link.displayName}</span>
                                        </a>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 右侧区域3：报告信息 - 移动端简化显示 */}
                    <div className="flex items-center gap-3 md:gap-6 order-2 md:order-3 w-full md:w-auto justify-between md:justify-start">
                        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
                            <div className="text-xl md:text-2xl">
                                ✨
                            </div>
                            <div>
                                <p className="text-xs md:text-sm font-semibold text-gray-800 dark:text-gray-200">
                                    {fromCache ? '从缓存加载' : '新鲜生成'}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {getExpiryInfo()}天后更新 · 共{(report.all_cards && report.all_cards.length > 0) ? report.all_cards.length : report.cards.length}个话题
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 md:gap-3">
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
                                        setCardAnimationPhase('exit'); // 开始退出动画

                                        // 等待退出动画完成（6张卡片 × 32ms延迟 + 320ms动画时长 = 512ms）
                                        setTimeout(() => {
                                            const newCards = getRandomCards(report, 6);
                                            setDisplayCards(newCards);
                                            setCardAnimationPhase('enter'); // 切换到进入动画

                                            // 等待进入动画完成后重置状态（6张卡片 × 64ms + 160ms + 480ms = 800ms）
                                            setTimeout(() => {
                                                setIsCardTransitioning(false);
                                                setCardAnimationPhase('idle');
                                            }, 800);
                                        }, 512);
                                    }}
                                    className="shuffle-btn shuffle-btn-style group relative h-10 md:h-12 px-3 md:px-5 rounded-2xl text-xs md:text-sm font-medium transition-all duration-300 hover:scale-110 active:scale-95 shadow-md hover:shadow-xl flex items-center gap-1.5 md:gap-2"
                                    aria-label="换一批"
                                    disabled={isCardTransitioning}
                                >
                                    <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    <span className="hidden sm:inline">换一批</span>
                                </button>
                            ) : null;
                        })()}
                        
                        {/* 虚拟人物按钮 - 仅在启用时显示 */}
                        {personaEnabled && (
                            <button
                                onClick={openPersonaModal}
                                className="persona-avatar-btn persona-avatar-btn-style group relative flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full shadow-md hover:shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center"
                                aria-label="Virtual Persona"
                            >
                                {/* 移动端：简化图标 */}
                                <svg className="w-5 h-5 md:w-6 md:h-6 icon-primary-color md:hidden" fill="currentColor" viewBox="0 0 24 24">
                                    <circle cx="12" cy="8" r="4"/>
                                    <path d="M12 13c-4 0-7 2.5-7 5v3h14v-3c0-2.5-3-5-7-5z"/>
                                </svg>
                                
                                {/* 桌面端：完整图标 */}
                                <svg className="hidden md:block w-6 h-6 icon-primary-color" fill="currentColor" viewBox="0 0 24 24">
                                    <circle cx="12" cy="8" r="3.5" opacity="0.9"/>
                                    <path d="M12 12c-3.5 0-6 2-6 4.5V20h12v-3.5c0-2.5-2.5-4.5-6-4.5z" opacity="0.9"/>
                                    <path d="M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7 7.5 5.6z" opacity="0.7"/>
                                    <path d="M19.5 14.6L17 16l1.4-2.5L17 11l2.5 1.4L22 11l-1.4 2.5L22 16l-2.5-1.4z" opacity="0.7"/>
                                    <circle cx="12" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" strokeDasharray="2,2"/>
                                </svg>
                                
                                {/* Hover提示文字 - 仅桌面端 */}
                                <span className="hidden md:block absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 shadow-lg z-50">
                                    虚拟人设
                                </span>
                            </button>
                        )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 卡片网格 - 移动端优化 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {displayCards.slice(0, 6).map((card, index) => {
                    // 确定卡片动画类
                    let animationClass = 'opacity-0';
                    if (pageExiting) {
                        // 页面退出时的动画
                        animationClass = 'card-exit-animated';
                    } else if (cardAnimationPhase === 'exit') {
                        // 换一批时的退出动画
                        animationClass = 'card-exit-animated';
                    } else if (cardAnimationPhase === 'enter') {
                        // 换一批时的进入动画
                        animationClass = 'card-animated';
                    } else if (contentReady) {
                        // 首次加载的进入动画
                        animationClass = 'card-animated';
                    }

                    return (
                    <article
                        key={`card-${index}-${card.topic_id}`}
                        className={`glass rounded-3xl p-6 hover:shadow-2xl transition-all duration-300 border report-card cursor-pointer hover:scale-[1.02] active:scale-[0.98] group ${animationClass}`}
                        // 必须使用内联样式来动态设置错峰动画索引
                        style={{
                            '--card-index': index
                        } as React.CSSProperties}
                        onClick={() => setSelectedCard(card)}
                    >
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
                                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-all duration-200 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-90 opacity-0 group-hover:opacity-100"
                                    aria-label="查看详情"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </div>

                            {/* Card Title */}
                            <h2 className="text-sm text-gray-600 dark:text-gray-400 mb-2 transition-colors duration-200 group-hover:text-gray-800 dark:group-hover:text-gray-200">
                                {card.title}
                            </h2>

                            {/* Card Summary */}
                            <p className="text-xl font-bold text-gray-900 dark:text-gray-100 line-clamp-2 mb-3 transition-colors duration-200 group-hover:text-gray-950 dark:group-hover:text-white">
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
                    </article>
                    );
                })}
            </div>

            {/* 详情弹窗 - 使用Portal渲染到body */}
            {selectedCard && typeof document !== 'undefined' && createPortal(
                <div
                    className={`modal-backdrop fixed inset-0 bg-black/30 dark:bg-black/50 z-50 flex items-center justify-center p-6 ${isCardModalClosing ? 'closing' : ''}`}
                    onClick={() => {
                        setIsCardModalClosing(true);
                        setTimeout(() => {
                            setSelectedCard(null);
                            setIsCardModalClosing(false);
                        }, 300);
                    }}
                >
                    <div
                        className={`modal-content glass rounded-3xl max-w-4xl w-full max-h-[85vh] overflow-hidden shadow-2xl border ${isCardModalClosing ? 'closing' : ''}`}
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
                                            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                                                {selectedCard.title}
                                            </h2>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                                    {selectedCard.category}
                                                </span>
                                                {selectedCard.content.tags && selectedCard.content.tags.length > 0 && (
                                                    <>
                                                        <span className="text-gray-300 dark:text-gray-600">·</span>
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
                                            setIsCardModalClosing(true);
                                            setTimeout(() => {
                                                setSelectedCard(null);
                                                setIsCardModalClosing(false);
                                            }, 250);
                                        }}
                                        className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-90 hover:rotate-90"
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
                                    <p className="text-lg text-gray-800 dark:text-gray-200 leading-relaxed font-medium">
                                        {selectedCard.content.summary}
                                    </p>
                                </div>

                                {/* 详细内容 */}
                                {selectedCard.content.details && selectedCard.content.details.length > 0 && (
                                    <div className="mb-8">
                                        <div className="space-y-4">
                                            {selectedCard.content.details.map((detail, i) => (
                                                <div key={i} className="flex items-start gap-4 transition-all duration-200 hover:translate-x-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 p-3 rounded-xl -mx-3">
                                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 dark:bg-gray-600 text-white text-xs font-bold flex items-center justify-center mt-0.5 transition-transform duration-200 group-hover:scale-110">
                                                        {i + 1}
                                                    </span>
                                                    <p className="flex-1 text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                                                        {detail}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* AI 洞察 */}
                                {selectedCard.content.highlight && (
                                    <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-100 to-orange-100 dark:from-yellow-900/40 dark:to-orange-900/40 flex items-center justify-center">
                                                <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                                </svg>
                                            </div>
                                            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">AI 洞察</h3>
                                        </div>
                                        <div className="pl-4 border-l-4 transition-all hover:pl-5 ai-insight-border">
                                            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed italic">
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

            {/* 虚拟人物弹窗 */}
            {showPersonaModal && createPortal(
                <div
                    className={`modal-backdrop fixed inset-0 bg-black/30 dark:bg-black/50 z-50 flex items-center justify-center p-6 ${isPersonaModalClosing ? 'closing' : ''}`}
                    onClick={() => {
                        setIsPersonaModalClosing(true);
                        setTimeout(() => {
                            setShowPersonaModal(false);
                            setIsPersonaModalClosing(false);
                        }, 300);
                    }}
                >
                    <div
                        className={`modal-content glass rounded-3xl max-w-4xl w-full max-h-[85vh] overflow-hidden shadow-2xl border ${isPersonaModalClosing ? 'closing' : ''}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="overflow-y-auto max-h-[85vh] custom-scrollbar">
                            <div className="p-10 relative">
                                {personaData ? (
                                    <>
                                        {/* 头部 */}
                                        <div className="flex items-start justify-between mb-10">
                                            <div className="flex items-start gap-5 flex-1">
                                                {/* 左侧切换按钮 */}
                                                {personaList.length > 1 && (
                                                    <button
                                                        onClick={() => switchPersona('prev')}
                                                        className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 persona-nav-btn-bg"
                                                        title="上一个人设"
                                                    >
                                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                                                        </svg>
                                                    </button>
                                                )}
                                                
                                                <div 
                                                    className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg text-3xl flex-shrink-0 transition-transform hover:scale-110 persona-icon-gradient"
                                                >
                                                    <svg className="w-9 h-9 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7 7.5 5.6zm12 9.8L22 14l-1.4 2.5L22 19l-2.5-1.4L17 19l1.4-2.5L17 14l2.5 1.4zM22 2l-1.4 2.5L22 7l-2.5-1.4L17 7l1.4-2.5L17 2l2.5 1.4L22 2zm-8.66 10.78l2.12-2.12 2.83 2.83-2.12 2.12-2.83-2.83zm-1.41-1.42L1.39 21.9l2.83 2.83 10.54-10.54-2.83-2.83z"/>
                                                    </svg>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{personaData.name}</h2>
                                                            {personaList.length > 1 && (
                                                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                                                    人设 {currentPersonaIndex + 1} / {personaList.length}
                                                                </p>
                                                            )}
                                                        </div>
                                                        
                                                        {/* 新增人设按钮 - 仅管理员且未满时显示 */}
                                                        {isAdmin && personaList.length < 2 && (
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        await fetchPersonaData();
                                                                    } catch (err) {
                                                                        alert('生成失败: ' + (err instanceof Error ? err.message : 'Unknown error'));
                                                                    }
                                                                }}
                                                                disabled={personaLoading}
                                                                className="px-4 py-2 text-white font-semibold rounded-lg transition-all duration-300 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 btn-primary-bg"
                                                            >
                                                                <span>➕</span>
                                                                <span>新增人设</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                
                                                {/* 右侧切换按钮 */}
                                                {personaList.length > 1 && (
                                                    <button
                                                        onClick={() => switchPersona('next')}
                                                        className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 persona-nav-btn-bg"
                                                        title="下一个人设"
                                                    >
                                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setIsPersonaModalClosing(true);
                                                    setTimeout(() => {
                                                        setShowPersonaModal(false);
                                                        setIsPersonaModalClosing(false);
                                                    }, 200);
                                                }}
                                                className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-all p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 ml-4"
                                                aria-label="关闭"
                                            >
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>

                                {/* 人物图片 */}
                                {personaData.image_url && (
                                    <div className="mb-6 rounded-2xl overflow-hidden p-4 persona-image-container-bg">
                                        <img
                                            src={personaData.image_url}
                                            alt={personaData.name}
                                            className="w-full h-auto max-h-96 object-contain rounded-xl"
                                            onError={(e) => {
                                                e.currentTarget.parentElement!.style.display = 'none';
                                            }}
                                        />
                                    </div>
                                )}

                                {/* 图片生成提示词编辑（管理员专用） */}
                                {isAdmin && (
                                    <div className="mb-6 p-4 rounded-2xl persona-prompt-edit-bg">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                                                <span>🎨</span>
                                                图片生成提示词
                                            </h3>
                                            {!editingImagePrompt && (
                                                <button
                                                    onClick={() => {
                                                        setEditingImagePrompt(true);
                                                        setImagePrompt(personaData.image_prompt || '');
                                                    }}
                                                    className="text-sm px-3 py-1.5 rounded-lg transition-colors btn-primary-bg text-white"
                                                >
                                                    编辑
                                                </button>
                                            )}
                                        </div>
                                        
                                        {editingImagePrompt ? (
                                            <div>
                                                <textarea
                                                    value={imagePrompt}
                                                    onChange={(e) => setImagePrompt(e.target.value)}
                                                    className="w-full h-32 p-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                    placeholder="输入英文图片生成提示词..."
                                                />
                                                <div className="flex gap-2 mt-3">
                                                    <button
                                                        onClick={() => generatePersonaImage(imagePrompt)}
                                                        disabled={generatingImage || !imagePrompt.trim()}
                                                        className="flex-1 px-4 py-2 text-white font-semibold rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:shadow-lg btn-primary-bg"
                                                    >
                                                        {generatingImage ? (
                                                            <>
                                                                <Spinner size="sm" variant="white" />
                                                                <span>生成中...</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span>✨</span>
                                                                <span>生成图片</span>
                                                            </>
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setEditingImagePrompt(false);
                                                            setImagePrompt('');
                                                        }}
                                                        className="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-lg transition-all btn-secondary-bg"
                                                    >
                                                        取消
                                                    </button>
                                                </div>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                                    💡 提示：修改后点击"生成图片"按钮即可生成新的人物形象
                                                </p>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                                                    {personaData.image_prompt || '暂无提示词'}
                                                </p>
                                                {!personaData.has_image && (
                                                    <button
                                                        onClick={() => generatePersonaImage(personaData.image_prompt)}
                                                        disabled={generatingImage || !personaData.image_prompt}
                                                        className="mt-3 w-full px-4 py-2 text-white font-semibold rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:shadow-lg btn-primary-bg"
                                                    >
                                                        {generatingImage ? (
                                                            <>
                                                                <Spinner size="sm" variant="white" />
                                                                <span>生成中...</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span>🎨</span>
                                                                <span>生成人物形象</span>
                                                            </>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 性格特征 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
                                        <span>💫</span>
                                        性格特征
                                    </h3>
                                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{personaData.personality}</p>
                                </div>

                                {/* 外貌描述 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
                                        <span>👤</span>
                                        外貌描述
                                    </h3>
                                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{personaData.appearance}</p>
                                </div>

                                {/* 兴趣爱好 */}
                                {personaData.hobbies && personaData.hobbies.length > 0 && (
                                    <div className="mb-6">
                                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
                                            <span>🎮</span>
                                            兴趣爱好
                                        </h3>
                                        <div className="flex flex-wrap gap-2">
                                            {personaData.hobbies.map((hobby: string, i: number) => (
                                                <span
                                                    key={i}
                                                    className="px-3 py-1.5 rounded-full text-sm font-medium hobby-tag-style"
                                                >
                                                    {hobby}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 生活方式 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
                                        <span>🌟</span>
                                        生活方式
                                    </h3>
                                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{personaData.life_style}</p>
                                </div>

                                {/* 管理按钮区域 - 仅管理员可见 */}
                                {isAdmin && personaData && (
                                    <div className="pt-6 border-t border-gray-200 dark:border-gray-700 space-y-3">
                                        {/* 删除当前人设按钮 */}
                                        <button
                                            onClick={() => deletePersona(personaData.slot)}
                                            disabled={personaLoading}
                                            className="w-full px-6 py-3 bg-red-500 text-white font-semibold rounded-xl transition-all duration-300 hover:bg-red-600 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            <span>🗑️</span>
                                            <span>删除当前人设</span>
                                        </button>
                                        
                                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                                            {personaList.length === 1 
                                                ? '💡 删除后可以生成新的人设'
                                                : '💡 已有2个人设，删除后可生成新人设'
                                            }
                                        </p>
                                    </div>
                                )}
                                    </>
                                ) : (
                                    <div className="text-center py-20">
                                        <p className="text-gray-600 dark:text-gray-400 mb-4">暂无虚拟人物数据</p>
                                        {isAdmin && (
                                            <button
                                                onClick={() => fetchPersonaData()}
                                                className="px-6 py-3 text-white font-semibold rounded-xl transition-all duration-300 hover:shadow-lg btn-primary-bg"
                                            >
                                                生成虚拟人物
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* 提示信息 */}
            <div className="mt-6 md:mt-8 text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400 px-4">
                <p>报告每7天自动更新一次，每次随机选择6个话题进行分析</p>
                <p className="mt-1">点击导航岛的灯泡图标可立即重新生成</p>
            </div>
        </div>
        </>
    );
}
