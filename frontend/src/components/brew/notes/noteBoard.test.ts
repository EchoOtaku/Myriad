import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  noteDocKicker,
  noteEditorStatus,
  notesBoardIsEmpty,
  noteScheduleLabel,
  visibleCloudNoteDocs,
} from './noteBoard.ts'

describe('visibleCloudNoteDocs', () => {
  it('已发布和空草稿都不上板', () => {
    const shown = visibleCloudNoteDocs([
      { status: 'draft', title: '', content_md: '' },
      { status: 'draft', title: '还没发', content_md: '' },
      { status: 'scheduled', title: '', content_md: '夜里发' },
      { status: 'published', title: '已见', content_md: '公开了' },
    ])
    assert.deepEqual(
      shown.map((doc) => doc.title || doc.content_md),
      ['还没发', '夜里发'],
    )
  })

  it('定时时间写成看得见的钟点', () => {
    const label = noteScheduleLabel(Date.UTC(2026, 2, 3, 8, 30), 'en-US')
    assert.match(label, /Mar/)
    assert.match(label, /3/)
  })
})

describe('notesBoardIsEmpty', () => {
  it('只有云端稿也不算空', () => {
    assert.equal(
      notesBoardIsEmpty(0, 0, [
        { status: 'draft', title: '还没发', content_md: '' },
      ]),
      false,
    )
    assert.equal(notesBoardIsEmpty(0, 0, []), true)
  })
})

describe('noteDocKicker', () => {
  it('失败先说失败，再带上本来要发的钟点', () => {
    const kicker = noteDocKicker(
      {
        last_error: 'A title is required',
        status: 'draft',
        scheduled_at: Date.UTC(2026, 2, 3, 8, 30),
      },
      { failed: '失败', scheduled: '定时', draft: '草稿' },
      'en-US',
    )
    assert.match(kicker, /失败/)
    assert.match(kicker, /Mar/)
  })
})

describe('noteEditorStatus', () => {
  it('草稿保存后把状态和时间说清楚', () => {
    assert.equal(
      noteEditorStatus(
        { status: 'draft', savedHint: true },
        {
          failed: '失败',
          scheduled: '定时',
          published: '已发布',
          draft: '草稿',
          saved: '已保存',
        },
        'en-US',
      ),
      '草稿 · 已保存',
    )
  })
})
