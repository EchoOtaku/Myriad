import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canAddCategory,
  canSubmitEdit,
  joinCategories,
  resolveEditSourcePayload,
  subscriptionModeOf,
} from './editSource.ts'

describe('subscriptionModeOf', () => {
  it('停用走 disabled，Phantasiai 走 phantasiai，其余走 normal', () => {
    assert.equal(
      subscriptionModeOf({ enabled: false, source_type: 'rss' }),
      'disabled',
    )
    assert.equal(
      subscriptionModeOf({ enabled: true, source_type: 'phantasiai' }),
      'phantasiai',
    )
    assert.equal(
      subscriptionModeOf({ enabled: true, source_type: 'rsshub' }),
      'normal',
    )
  })
})

describe('canAddCategory', () => {
  it('未满两项就能再加', () => {
    assert.equal(canAddCategory([]), true)
    assert.equal(canAddCategory(['友情链接']), true)
    assert.equal(canAddCategory(['工程']), true)
    assert.equal(canAddCategory(['友情链接', '工程']), false)
  })
})

describe('joinCategories', () => {
  it('空选不写字段，草稿在限额内并进去', () => {
    assert.equal(joinCategories([]), undefined)
    assert.equal(joinCategories(['友情链接'], '工程'), '友情链接, 工程')
    assert.equal(joinCategories(['工程'], '旅行'), '工程, 旅行')
    assert.equal(joinCategories(['友情链接', '工程'], '多余'), '友情链接, 工程')
  })
})

describe('canSubmitEdit', () => {
  it('换类型时按添加订阅同一套必填', () => {
    assert.equal(
      canSubmitEdit({
        fieldKind: 'rss',
        originalKind: 'link',
        url: '',
        name: '站',
        rsshubFullUrl: '',
        notionToken: '',
      }),
      false,
    )
    assert.equal(
      canSubmitEdit({
        fieldKind: 'link',
        originalKind: 'rss',
        url: 'https://a.test',
        name: '',
        rsshubFullUrl: '',
        notionToken: '',
      }),
      false,
    )
    assert.equal(
      canSubmitEdit({
        fieldKind: 'notion',
        originalKind: 'rss',
        url: 'notion://database/x',
        name: '',
        rsshubFullUrl: '',
        notionToken: '',
      }),
      false,
    )
    assert.equal(
      canSubmitEdit({
        fieldKind: 'notion',
        originalKind: 'rss',
        url: 'notion://database/x',
        name: '',
        rsshubFullUrl: '',
        notionToken: 'secret',
      }),
      true,
    )
  })
})

describe('resolveEditSourcePayload', () => {
  it('普通 RSS 切 Phantasiai 并带上间隔', () => {
    const payload = resolveEditSourcePayload({
      source: { source_type: 'rss', feed_type: 'rss' },
      fieldKind: 'rss',
      name: ' 示例 ',
      category: '工程',
      url: 'https://example.com/feed.xml',
      updateInterval: 120,
      subscriptionMode: 'phantasiai',
      customIcon: null,
      themeColor: '#f97316',
      styleTags: ['冷静'],
      adminOnly: false,
    })
    assert.equal(payload.name, '示例')
    assert.equal(payload.category, '工程')
    assert.equal(payload.update_interval, 120)
    assert.equal(payload.enabled, true)
    assert.equal(payload.source_type, 'phantasiai')
    assert.equal(payload.feed_type, 'rss')
    assert.equal(payload.url, 'https://example.com/feed.xml')
    assert.equal(payload.theme_color, '#f97316')
    assert.deepEqual(payload.ai_style_tags, ['冷静'])
    assert.equal(payload.icon, undefined)
  })

  it('RSSHub 回到普通模式时 source_type 仍是 rsshub', () => {
    const payload = resolveEditSourcePayload({
      source: { source_type: 'phantasiai', feed_type: 'rsshub' },
      fieldKind: 'rsshub',
      name: 'hub',
      category: '',
      url: 'https://rsshub.app/x',
      updateInterval: 60,
      subscriptionMode: 'normal',
      customIcon: null,
      themeColor: '',
      styleTags: [],
      adminOnly: true,
      rsshubRoute: '/x',
    })
    assert.equal(payload.source_type, 'rsshub')
    assert.equal(payload.feed_type, 'rsshub')
    assert.equal(payload.rsshub_route, '/x')
    assert.equal(payload.enabled, true)
    assert.equal(payload.theme_color, '')
    assert.equal(payload.admin_only, true)
  })

  it('停止抓取只关 enabled，纯链接不写间隔', () => {
    const paused = resolveEditSourcePayload({
      source: { source_type: 'rss', feed_type: 'atom' },
      fieldKind: 'rss',
      name: 'a',
      category: '',
      url: 'https://a.test/atom.xml',
      updateInterval: 30,
      subscriptionMode: 'disabled',
      customIcon: '',
      themeColor: '',
      styleTags: [],
      adminOnly: false,
    })
    assert.equal(paused.enabled, false)
    assert.equal(paused.update_interval, 30)
    assert.equal(paused.feed_type, 'atom')
    assert.equal(paused.icon, '')

    const link = resolveEditSourcePayload({
      source: { source_type: 'link', feed_type: 'rss' },
      fieldKind: 'link',
      name: '入口',
      category: '友情链接',
      url: 'https://friend.test',
      updateInterval: 60,
      subscriptionMode: 'normal',
      customIcon: null,
      themeColor: '#111111',
      styleTags: ['朋友'],
      adminOnly: false,
    })
    assert.equal(link.update_interval, undefined)
    assert.equal(link.enabled, undefined)
    assert.equal(link.source_type, 'link')
    assert.equal(link.category, '友情链接')
  })

  it('纯链接改成 RSS、RSS 改成 Notion 会写下类型和地址', () => {
    const rss = resolveEditSourcePayload({
      source: { source_type: 'link', feed_type: 'rss' },
      fieldKind: 'rss',
      name: '博客',
      category: '',
      url: 'https://blog.test/feed.xml',
      updateInterval: 60,
      subscriptionMode: 'normal',
      customIcon: null,
      themeColor: '',
      styleTags: [],
      adminOnly: false,
    })
    assert.equal(rss.source_type, 'rss')
    assert.equal(rss.feed_type, 'rss')
    assert.equal(rss.enabled, true)
    assert.equal(rss.update_interval, 60)
    assert.equal(rss.url, 'https://blog.test/feed.xml')

    const notion = resolveEditSourcePayload({
      source: { source_type: 'rss', feed_type: 'rss' },
      fieldKind: 'notion',
      name: '库',
      category: '',
      url: 'notion://database/x',
      updateInterval: 60,
      subscriptionMode: 'normal',
      customIcon: null,
      themeColor: '',
      styleTags: [],
      adminOnly: false,
      notionToken: 'secret_x',
    })
    assert.equal(notion.source_type, 'rss')
    assert.equal(notion.feed_type, 'notion')
    assert.deepEqual(notion.extra_config, { token: 'secret_x' })
  })
})
