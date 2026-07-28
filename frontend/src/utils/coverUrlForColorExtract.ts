/**
 * 网易/QQ 封面改小尺寸 URL，加速取色解码（显示仍用原 cover）。
 * 纯函数，可在 Node 单测中直接验证。
 */
export function coverUrlForColorExtract(url: string): string {
  if (!url) return url
  try {
    // 网易云：支持 ?param=WxH（CDN .net / 主站 .com 均可能出现）
    if (
      /music\.(126|163)\.(net|com)/i.test(url) ||
      /p\d+\.music\.126\.net/i.test(url)
    ) {
      if (/[?&]param=\d+y\d+/i.test(url)) {
        return url.replace(/([?&]param=)\d+y\d+/i, '$1150y150')
      }
      return url.includes('?') ? `${url}&param=150y150` : `${url}?param=150y150`
    }
    // QQ 音乐相册图：T002R300x300 → 更小
    if (/y\.gtimg\.cn\/music\/photo_new\/T002R\d+x\d+M000/i.test(url)) {
      return url.replace(/T002R\d+x\d+M000/i, 'T002R150x150M000')
    }
  } catch {
    /* keep original */
  }
  return url
}
