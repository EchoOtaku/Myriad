/**
 * Widget-library preview fixtures for report cards (no network).
 * SVG data URIs keep previews offline-safe for avatar walls / posters.
 */
import type { useI18n } from '../../../contexts/I18nContext'

type I18nT = ReturnType<typeof useI18n>['t']

export function buildReportCardPreviewData(
  platformId: string,
  t: I18nT,
): Record<string, unknown> {
const previewAvatar = (letter: string, bg: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="${bg}"/><text x="48" y="58" text-anchor="middle" fill="#fff" font-size="36" font-family="system-ui,sans-serif" font-weight="700">${letter}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
const previewCover = (letter: string, bg: string, w = 160, h = 200) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="#111827"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="${w / 2}" y="${h / 2 + 12}" text-anchor="middle" fill="#fff" font-size="42" font-family="system-ui,sans-serif" font-weight="700" opacity="0.92">${letter}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// Discord 卡片字段结构与其他平台差异较大（profile/stats/library_items
// 形状不同），单独给一份预览数据，避免与通用预览字段互相污染。
if (platformId === 'discord') {
  const guildTile = (letter: string, bg: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="24" fill="${bg}"/><text x="48" y="62" text-anchor="middle" fill="#fff" font-size="44" font-family="system-ui,sans-serif" font-weight="700">${letter}</text></svg>`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }
  return {
    vibe: t.reportCardWidget.discordVibeDefault,
    role_profile: t.reportCardWidget.discordRoleDefault,
    community_tags: [
      t.reportCardWidget.discordTagOpenSource,
      t.reportCardWidget.discordTagIndieGame,
      t.reportCardWidget.discordTagAcg,
    ],
    profile: {
      display_name: 'PreviewUser',
      username: 'preview',
      avatar_url: previewAvatar('D', '#5865F2'),
      nitro: 'Nitro',
      account_age_years: 7,
      badges: [
        'Active Developer',
        'HypeSquad Balance',
        'Early Supporter',
      ],
      mfa_enabled: true,
    },
    stats: {
      guilds: 42,
      owned_guilds: 2,
      admin_guilds: 5,
      manage_guilds: 8,
      connections: 4,
      member_reach: 128000,
      online_reach: 21000,
    },
    linked_platforms: ['github', 'steam', 'spotify', 'youtube'],
    connections: [
      { type: 'github', name: 'octocat', verified: true },
      { type: 'steam', name: 'PreviewGamer', verified: true },
      { type: 'spotify', name: 'preview', verified: false },
    ],
    library_items: [
      {
        id: 'g1',
        name: 'Open Source Guild',
        title: 'Open Source Guild',
        icon: guildTile('O', '#5865F2'),
        owner: true,
        permissions: ['ADMINISTRATOR'],
        member_count: 8200,
        presence_count: 1400,
        features: ['COMMUNITY'],
      },
      {
        id: 'g2',
        name: 'Indie Devs',
        title: 'Indie Devs',
        icon: guildTile('I', '#4752C4'),
        owner: false,
        permissions: ['MANAGE_GUILD'],
        member_count: 25000,
        presence_count: 3800,
        features: ['PARTNERED'],
      },
      {
        id: 'g3',
        name: 'ACG Lounge',
        title: 'ACG Lounge',
        icon: guildTile('A', '#7289DA'),
        owner: false,
        permissions: [],
        member_count: 61000,
        presence_count: 9200,
        features: ['VERIFIED'],
      },
      {
        id: 'g4',
        name: 'Pixel Art',
        title: 'Pixel Art',
        icon: guildTile('P', '#949CF7'),
        owner: false,
        permissions: [],
        member_count: 4300,
        presence_count: 700,
        features: [],
      },
      {
        id: 'g5',
        name: 'Rust Nomads',
        title: 'Rust Nomads',
        icon: guildTile('R', '#3C45A5'),
        owner: false,
        permissions: [],
        member_count: 12000,
        presence_count: 1900,
        features: ['COMMUNITY'],
      },
    ],
  }
}

const sampleGame = t.reportCardWidget.sampleGame
const sampleAnime = t.reportCardWidget.sampleAnime
const samplePlaylist = t.reportCardWidget.samplePlaylist
const sampleProject = t.reportCardWidget.sampleProject
const sampleManga = t.reportCardWidget.sampleManga
const sampleGame2 = t.reportCardWidget.sampleGame2
const sampleAnime2 = t.reportCardWidget.sampleAnime2

return {
  // —— 通用评分 / 身份标签 ——
  hardcore_score: 85,
  player_type: t.reportCardWidget.hardcorePlayer,
  gamer_type: t.reportCardWidget.xboxGamerDefault,
  hunter_type: t.reportCardWidget.psnHunterDefault,
  contribution_level: t.reportCardWidget.seniorDev,
  taste_profile: t.reportCardWidget.bangumiTasteDefault,

  // —— Steam ——
  games_count: 120,
  total_playtime: 2500,
  personaname: 'PreviewGamer',
  personastate_label: 'online',
  is_online: true,
  is_in_game: false,
  avatar: previewAvatar('S', '#1b2838'),
  recent_2weeks_minutes: 840,

  // —— Xbox ——
  gamertag: 'PreviewGamer',
  gamerscore: 12500,
  total_achievements: 340,
  completion_rate: 42,
  completed_games: 8,

  // —— PSN ——
  online_id: 'PreviewPSN',
  trophy_level: 245,
  platinum_count: 18,
  total_trophies: 1260,

  // —— GitHub ——
  total_contributions: 1200,
  repos_count: 45,
  total_stars: 890,
  languages: [
    { name: 'TypeScript', percentage: 42 },
    { name: 'Rust', percentage: 28 },
    { name: 'Python', percentage: 18 },
    { name: 'Go', percentage: 12 },
  ],

  // —— 网易云 ——
  follower_count: 1200,
  playlist_count: 15,
  level: 8,
  mood_keywords: [
    t.reportCardWidget.happyMood,
    t.reportCardWidget.sadMood,
    t.reportCardWidget.passionateMood,
    t.reportCardWidget.calmMood,
    t.reportCardWidget.nightMood,
  ],

  // —— Bilibili 弹幕（无则组件有默认） ——
  danmaku: t.reportCard.danmakuDefault as unknown as string[],

  // —— Bangumi / MAL 收藏结构 ——
  status_counts: { done: 128, doing: 12, wish: 45 },
  subject_type_distribution: {
    anime: 80,
    book: 28,
    manga: 28,
    game: 22,
    music: 12,
    real: 8,
  },

  // —— 详情轮播 / 海报墙（多平台共用，字段取并集） ——
  library_items: [
    {
      title: sampleProject,
      type: 'repo',
      language: 'TypeScript',
      stars: 120,
      forks: 30,
      description: t.reportCardWidget.sampleProjectDesc,
    },
    {
      title: sampleGame,
      type: 'game',
      cover: previewCover('G', '#1b2838', 320, 150),
      progress: 100,
      achievements_earned: 48,
      achievements_total: 48,
      gamerscore: 1000,
      platinum: true,
    },
    {
      title: sampleGame2,
      type: 'game',
      cover: previewCover('H', '#107C10', 320, 150),
      progress: 72,
      achievements_earned: 36,
      achievements_total: 50,
      gamerscore: 640,
      platinum: false,
    },
    {
      title: sampleAnime,
      type: 'anime',
      cover: previewCover('A', '#f09199'),
      rate: 9,
    },
    {
      title: sampleAnime2,
      type: 'anime',
      cover: previewCover('B', '#2e51a2'),
      rate: 8,
    },
    {
      title: sampleManga,
      type: 'book',
      cover: previewCover('M', '#e11d48'),
      rate: 10,
    },
    {
      title: samplePlaylist,
      type: 'music',
      cover: previewCover('♪', '#e60026', 200, 200),
    },
    {
      title: t.reportCardWidget.samplePlaylist2,
      type: 'music',
      cover: previewCover('♫', '#7B68EE', 200, 200),
    },
  ],
  // Xbox / PSN 无 library 封面时的回退列表
  top_titles: [
    {
      name: sampleGame,
      title: sampleGame,
      progress: 100,
      platinum: true,
      cover: previewCover('G', '#1b2838', 320, 150),
      achievements_earned: 48,
      achievements_total: 48,
      gamerscore: 1000,
    },
    {
      name: sampleGame2,
      title: sampleGame2,
      progress: 72,
      platinum: false,
      cover: previewCover('H', '#107C10', 320, 150),
      achievements_earned: 36,
      achievements_total: 50,
      gamerscore: 640,
    },
    {
      name: t.reportCardWidget.sampleGame3,
      title: t.reportCardWidget.sampleGame3,
      progress: 45,
      platinum: false,
      cover: previewCover('J', '#0070D1', 320, 150),
      achievements_earned: 18,
      achievements_total: 40,
      gamerscore: 280,
    },
  ],

  // —— X 关注图谱 + 人设 ——
  vibe: t.reportCardWidget.xVibeDefault,
  engagement_level: t.reportCardWidget.xEngagementDefault,
  signature_topics: [
    t.reportCardWidget.xCircleIndie,
    t.reportCardWidget.xCircleOpenSource,
    t.reportCardWidget.xCircleArt,
  ],
  profile: {
    username: 'preview',
    name: 'Preview',
    avatar: previewAvatar('P', '#111827'),
  },
  stats: {
    followers: 1280,
    following: 420,
    posts: 86,
  },
  interest_circles: [
    {
      name: t.reportCardWidget.xCircleIndie,
      count: 22,
      accounts: ['pixelcraft', 'roguelike'],
    },
    {
      name: t.reportCardWidget.xCircleOpenSource,
      count: 15,
      accounts: ['octocat_lab'],
    },
    {
      name: t.reportCardWidget.xCircleArt,
      count: 9,
      accounts: ['inkwave'],
    },
  ],
  following_highlights: [
    {
      username: 'pixelcraft',
      name: 'PixelCraft',
      tag: t.reportCardWidget.xTagIndie,
    },
    {
      username: 'octocat_lab',
      name: 'Octocat Lab',
      tag: t.reportCardWidget.xTagTech,
    },
    {
      username: 'inkwave',
      name: 'Ink Wave',
      tag: t.reportCardWidget.xTagArt,
    },
  ],
  following_sample: [
    {
      username: 'pixelcraft',
      name: 'PixelCraft',
      description: t.reportCardWidget.xPreviewDescIndie,
      follower_count: 18200,
      avatar: previewAvatar('P', '#2563eb'),
    },
    {
      username: 'octocat_lab',
      name: 'Octocat Lab',
      description: t.reportCardWidget.xPreviewDescTech,
      follower_count: 9400,
      avatar: previewAvatar('O', '#7c3aed'),
    },
    {
      username: 'inkwave',
      name: 'Ink Wave',
      description: t.reportCardWidget.xPreviewDescArt,
      follower_count: 5600,
      avatar: previewAvatar('I', '#db2777'),
    },
    {
      username: 'roguelike',
      name: 'RogueLike',
      description: t.reportCardWidget.xPreviewDescIndie,
      follower_count: 3100,
      avatar: previewAvatar('R', '#d97706'),
    },
    {
      username: 'synthwave',
      name: 'SynthWave',
      description: t.reportCardWidget.xPreviewDescArt,
      follower_count: 2200,
      avatar: previewAvatar('S', '#0891b2'),
    },
    {
      username: 'typecraft',
      name: 'TypeCraft',
      description: t.reportCardWidget.xPreviewDescTech,
      follower_count: 4800,
      avatar: previewAvatar('T', '#059669'),
    },
    {
      username: 'loomstudio',
      name: 'Loom Studio',
      description: t.reportCardWidget.xPreviewDescArt,
      follower_count: 1700,
      avatar: previewAvatar('L', '#e11d48'),
    },
  ],
}
}
