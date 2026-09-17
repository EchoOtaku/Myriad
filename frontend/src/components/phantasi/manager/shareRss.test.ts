import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shareRssAddress } from './shareRss.ts'

describe('shareRssAddress', () => {
  it('系统分享载荷只放一份 RSS 地址', async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      'navigator',
    )
    let shared: ShareData | undefined

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        share: async (data: ShareData) => {
          shared = data
        },
        clipboard: {
          writeText: async () => {
            throw new Error('系统分享成功时不应回退到剪贴板')
          },
        },
      } satisfies Pick<Navigator, 'share' | 'clipboard'>,
    })

    try {
      await shareRssAddress(
        'https://example.com/journal/notes.xml',
        '笔记 RSS',
        '已复制',
        '复制失败',
      )

      assert.deepEqual(shared, {
        title: '笔记 RSS',
        url: 'https://example.com/journal/notes.xml',
      })
    } finally {
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator)
      } else {
        Reflect.deleteProperty(globalThis, 'navigator')
      }
    }
  })
})
