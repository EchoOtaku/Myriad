/** 复制或系统分享 RSS 地址。不进 skin。 */

import { showToast } from '../../../utils/toastManager'
import { showPhantasiError } from '../phantasiNotice'

export async function shareRssAddress(
  url: string,
  title: string,
  copied: string,
  failed: string,
): Promise<void> {
  try {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        return
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
      }
    }
    await navigator.clipboard.writeText(url)
    showToast({ message: copied, type: 'success' })
  } catch (err) {
    await showPhantasiError(err, failed)
  }
}
