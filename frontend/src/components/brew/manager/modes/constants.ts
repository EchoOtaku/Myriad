/**
 * ControlIsland 模式组件共享常量
 * 从共享 control-island 包重导出 + Brew 专属工具函数
 */

// 从共享包重导出 —— 动画、样式、图标处理
export {
  API_URL,
  getIconUrl,
  ISLAND_BADGE,
  ISLAND_BTN,
  ISLAND_BTN_DANGER,
  ISLAND_BTN_PRIMARY,
  ISLAND_DIVIDER,
  ISLAND_GLASS,
  ISLAND_GLASS_EDIT,
  ISLAND_INPUT,
  ISLAND_INPUT_STYLE,
  ISLAND_SELECT,
  SPRING_SMOOTH,
  SPRING_SNAPPY,
  TRANSITION_NORMAL,
  TRANSITION_QUICK,
  TRANSITION_SLOW,
} from '../../../shared/control-island'

// ==================== Brew 专属工具 ====================

/**
 * 判断是否为 base64 图片数据
 */
export function isBase64Image(str: string | null): boolean {
  if (!str) return false
  return str.startsWith('data:image/')
}

/**
 * 从 base64 提取 MIME 类型和扩展名
 */
export function getBase64Info(base64: string): { mime: string; ext: string } {
  const match = base64.match(/^data:(image\/\w+);base64,/)
  if (match) {
    const mime = match[1]
    const ext = mime.split('/')[1] || 'png'
    return { mime, ext }
  }
  return { mime: 'image/png', ext: 'png' }
}

// 排序选项定义
export const SORT_OPTIONS = [
  { value: 'update', labelKey: 'sortByUpdate' },
  { value: 'custom', labelKey: 'sortByCustom' },
  { value: 'category', labelKey: 'sortByCategory' },
  { value: 'random', labelKey: 'sortByRandom' },
  { value: 'pinyin', labelKey: 'sortByPinyin' },
] as const
