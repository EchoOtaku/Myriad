import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countNoteChars,
  firstMarkdownImage,
  fromDatetimeLocal,
  MAX_NOTE_BODY_CHARS,
  MAX_NOTE_TITLE_CHARS,
  normalizeNoteCover,
  normalizeNoteTopic,
  noteFieldError,
  noteScheduleError,
  sameNoteMinute,
  toDatetimeLocal,
  toNoteWritePayload,
} from './noteFields.ts'

describe('noteFieldError', () => {
  it('空标题先拦', () => {
    assert.equal(noteFieldError('   ', '正文'), 'empty-title')
  })

  it('标题超 200 字', () => {
    assert.equal(MAX_NOTE_TITLE_CHARS, 200)
    assert.equal(noteFieldError('标'.repeat(201), '正文'), 'title-too-long')
    assert.equal(noteFieldError('标'.repeat(200), '正文'), null)
  })

  it('正文超 20 万字', () => {
    assert.equal(MAX_NOTE_BODY_CHARS, 200_000)
    assert.equal(noteFieldError('标题', '正'.repeat(200_001)), 'body-too-long')
  })

  it('按字计，不按 UTF-16 码元', () => {
    assert.equal(countNoteChars('👍'), 1)
  })
})

describe('firstMarkdownImage', () => {
  it('取正文第一张图', () => {
    assert.equal(
      firstMarkdownImage('前文\n![封面](https://img.example/a.jpg "alt")\n![](https://img.example/b.jpg)'),
      'https://img.example/a.jpg',
    )
  })

  it('没有图就是空', () => {
    assert.equal(firstMarkdownImage('没有图'), null)
  })

  it('参考式图片也能取到定义里的地址', () => {
    assert.equal(
      firstMarkdownImage(
        '![一小杯咖啡][cup]\n\n[cup]: https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG "Wikimedia Commons：A small cup of coffee"',
      ),
      'https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG',
    )
  })
})

describe('noteScheduleError', () => {
  it('没给时间或已经过了都不行', () => {
    assert.equal(noteScheduleError(null, 100), 'missing-time')
    assert.equal(noteScheduleError(100, 100), 'already-due')
    assert.equal(noteScheduleError(99, 100), 'already-due')
    assert.equal(noteScheduleError(101, 100), null)
  })
})

describe('datetime-local', () => {
  it('来回一分钟内对得上', () => {
    const ms = Date.UTC(2025, 5, 15, 8, 30)
    const local = toDatetimeLocal(ms)
    const back = fromDatetimeLocal(local)
    assert.ok(back != null)
    assert.equal(sameNoteMinute(ms, back), true)
  })

  it('空值和坏值不去', () => {
    assert.equal(fromDatetimeLocal(''), null)
    assert.equal(fromDatetimeLocal('不是时间'), null)
    assert.equal(toDatetimeLocal(0), '')
  })
})

describe('normalize', () => {
  it('空白主题和封面当没有', () => {
    assert.equal(normalizeNoteTopic('  '), null)
    assert.equal(normalizeNoteCover(''), null)
    assert.equal(normalizeNoteTopic('ai'), 'ai')
  })
})

describe('toNoteWritePayload', () => {
  it('空封面不带 image，让后端用正文第一张图', () => {
    assert.deepEqual(toNoteWritePayload('标题', '正文', '  ', '', null), {
      title: '标题',
      content_md: '正文',
      topic: null,
    })
  })

  it('指定了就带上主题、封面和时间', () => {
    assert.deepEqual(
      toNoteWritePayload(
        ' 标题 ',
        '正文',
        'ai',
        'https://img.example/a.jpg',
        1_700_000_000_000,
      ),
      {
        title: '标题',
        content_md: '正文',
        topic: 'ai',
        image: 'https://img.example/a.jpg',
        published_at: 1_700_000_000_000,
      },
    )
  })
})
