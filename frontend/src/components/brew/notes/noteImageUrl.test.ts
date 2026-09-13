import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  displayImageUrl,
  prepareNoteReaderHtml,
  withDisplayImages,
} from './noteImageUrl'

const api = 'http://localhost:3000'

describe('displayImageUrl', () => {
  it('本站媒体：不管存的是哪个域名，都改成当前 API origin', () => {
    assert.equal(
      displayImageUrl('https://my.site/media/federation/1/a.jpg', api),
      'http://localhost:3000/media/federation/1/a.jpg',
    )
    assert.equal(displayImageUrl('/media/federation/1/a.jpg', api), 'http://localhost:3000/media/federation/1/a.jpg')
    assert.equal(displayImageUrl('/api/x.png?v=2', api), 'http://localhost:3000/api/x.png?v=2')
  })

  it('外站图原样（或按热链名单代理），data/blob 不动', () => {
    assert.equal(displayImageUrl('https://x.y/p.png', api), 'https://x.y/p.png')
    assert.equal(displayImageUrl('data:image/png;base64,AAA', api), 'data:image/png;base64,AAA')
    assert.equal(displayImageUrl('not a url', api), 'not a url')
  })
})

describe('withDisplayImages', () => {
  it('只改 src，alt 和别的属性不动，& 转义来回一致', () => {
    const html = '<p><img alt="封面" src="https://my.site/media/federation/1/a.jpg?x=1&amp;y=2"></p>'
    assert.equal(
      withDisplayImages(html, api),
      '<p><img alt="封面" src="http://localhost:3000/media/federation/1/a.jpg?x=1&amp;y=2"></p>',
    )
  })
})

describe('prepareNoteReaderHtml', () => {
  it('空正文用占位；小组件属性和配置原样留下', () => {
    assert.equal(prepareNoteReaderHtml('', '<p>EMPTY</p>', api), '<p>EMPTY</p>')
    const widget =
      '<div class="note-widget" data-widget="weather" data-size="2x2" data-config="%7B%22city%22%3A%22Tokyo%22%7D">weather</div>'
    assert.equal(
      prepareNoteReaderHtml(widget, '<p>EMPTY</p>', api),
      '<div class="note-widget not-prose" data-widget="weather" data-size="2x2" data-config="%7B%22city%22%3A%22Tokyo%22%7D">weather</div>',
    )
    assert.equal(
      prepareNoteReaderHtml(
        '<div class="note-widget not-prose" data-widget="quote" data-size="2x2">quote</div>',
        '<p>EMPTY</p>',
        api,
      ),
      '<div class="note-widget not-prose" data-widget="quote" data-size="2x2">quote</div>',
    )
  })
})
