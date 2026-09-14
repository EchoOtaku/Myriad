import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isNoteGuid,
  isNoteStorySource,
  siteStoryAttribution,
  storySourceFace,
} from './noteSiteSource.ts'

const site = { name: 'Kiseki', icon: '/k.ico' }

describe('isNoteGuid', () => {
  it('只认 note: 前缀', () => {
    assert.equal(isNoteGuid('note:bdcc'), true)
    assert.equal(isNoteGuid('guid-1'), false)
    assert.equal(isNoteGuid(''), false)
    assert.equal(isNoteGuid(null), false)
  })
})

describe('storySourceFace', () => {
  it('手记用来站名站标，不用手记源名', () => {
    assert.deepEqual(
      storySourceFace(
        {
          source_type: 'note',
          source_name: '手记',
          source_icon: '/n.png',
        },
        site,
      ),
      site,
    )
    assert.deepEqual(
      storySourceFace(
        {
          guid: 'note:1',
          source_name: 'Notiz',
          source_icon: '/n.png',
        },
        site,
      ),
      site,
    )
  })

  it('订阅源仍用自己的名字', () => {
    assert.deepEqual(
      storySourceFace(
        {
          source_type: 'rss',
          guid: 'https://a.test/1',
          source_name: '示例源',
          source_icon: '/rss.png',
        },
        site,
      ),
      { name: '示例源', icon: '/rss.png' },
    )
  })

  it('自有分类源不是手记，不换成站点', () => {
    assert.equal(isNoteStorySource({ source_type: 'rss' }), false)
    assert.deepEqual(
      storySourceFace(
        { source_name: '我', source_icon: '/me.png' },
        site,
      ),
      { name: '我', icon: '/me.png' },
    )
  })
})

describe('siteStoryAttribution', () => {
  it('读站点标题和图标', () => {
    assert.deepEqual(
      siteStoryAttribution({
        site_title: '  Fuukei  ',
        site_favicon: '/siteicon.ico',
      }),
      { name: 'Fuukei', icon: '/siteicon.ico' },
    )
  })
})
