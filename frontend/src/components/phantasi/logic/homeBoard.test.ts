import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeItem } from './fixtures.ts'
import {
  noteSourceKey,
  noteSourceStamp,
  toHomeBoardNote,
  toNoteStory,
} from './homeBoard.ts'

describe('toHomeBoardNote', () => {
  it('只收笔记墙要的字段', () => {
    const note = toHomeBoardNote(
      makeItem({
        id: 7,
        title: 'n7',
        summary: 's',
        image: '/c.jpg',
        source_id: 10,
      }),
    )
    assert.deepEqual(note, {
      id: 7,
      title: 'n7',
      summary: 's',
      image: '/c.jpg',
      published_at: note.published_at,
      source_id: 10,
      is_starred: false,
      topic: null,
      author: null,
      source_name: '示例源',
      source_icon: null,
      guid: note.guid,
    })
  })
})

describe('toNoteStory', () => {
  it('缺源名字时用源卡补上，并标成笔记好换站点来源', () => {
    const note = toHomeBoardNote(makeItem({
      id: 9,
      title: 'n9',
      source_id: 10,
      source_name: '',
      guid: 'note:n9',
    }))
    const story = toNoteStory(note, { name: '笔记', icon: '/n.png' })
    assert.equal(story.source_name, '笔记')
    assert.equal(story.source_icon, '/n.png')
    assert.equal(story.source_type, 'note')
    assert.equal(story.guid, 'note:n9')
    assert.equal(story.is_read, true)
  })
})

describe('noteSourceKey', () => {
  it('只签名笔记源，没有则空串', () => {
    assert.equal(
      noteSourceKey([
        { id: 10, source_type: 'note' },
        { id: 11, source_type: 'rss' },
        { id: 12, source_type: 'note' },
      ]),
      '10,12',
    )
    assert.equal(noteSourceKey([{ id: 11, source_type: 'rss' }]), '')
    assert.equal(
      noteSourceKey([
        { id: 12, source_type: 'note' },
        { id: 10, source_type: 'note' },
      ]),
      '10,12',
    )
  })
})

describe('noteSourceStamp', () => {
  it('只签名笔记源的条数和抓取戳，顺序无关，收藏位不算', () => {
    assert.equal(
      noteSourceStamp([
        { id: 12, source_type: 'note', item_count: 1, last_success_at: null },
        { id: 11, source_type: 'rss', item_count: 80, last_success_at: 9 },
        { id: 10, source_type: 'note', item_count: 3, last_success_at: 9 },
      ]),
      '10:3:9,12:1:0',
    )
    assert.equal(
      noteSourceStamp([
        { id: 10, source_type: 'note', item_count: 3, last_success_at: 9 },
      ]),
      noteSourceStamp([
        { id: 10, source_type: 'note', item_count: 3, last_success_at: 9 },
      ]),
    )
  })
})
