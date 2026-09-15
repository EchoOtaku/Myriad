import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  draftRssShareUrl,
  NOTES_RSS_PATH,
  notesRssUrl,
  sourceRssShareUrl,
} from './shareRss.ts'

const rustPaths = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../crates/myriad-phantasi/src/lib.rs',
  ),
  'utf8',
)
const rustNotes = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../crates/myriad-phantasi-notes/src/lib.rs',
  ),
  'utf8',
)

describe('notesRssUrl', () => {
  it('拼公开笔记 RSS，和后端同一条路径', () => {
    assert.equal(NOTES_RSS_PATH, '/journal/notes.xml')
    assert.match(rustPaths, /NOTES_RSS_PATH: &str = "\/journal\/notes.xml"/)
    assert.match(rustPaths, /NOTES_RSS_PREFERENCES_KEY: &str = "phantasi_notes_rss"/)
    assert.match(rustNotes, /pub const NOTES_RSS_PATH: &str = myriad_phantasi::NOTES_RSS_PATH/)
    assert.match(
      rustNotes,
      /pub const NOTES_RSS_PREFERENCES_KEY: &str = myriad_phantasi::NOTES_RSS_PREFERENCES_KEY/,
    )
    assert.equal(notesRssUrl('https://ex.com/'), 'https://ex.com/journal/notes.xml')
    assert.equal(notesRssUrl('https://ex.com'), 'https://ex.com/journal/notes.xml')
    assert.equal(notesRssUrl(''), '/journal/notes.xml')
  })
})

describe('sourceRssShareUrl', () => {
  it('只给笔记源公开 RSS', () => {
    assert.equal(
      sourceRssShareUrl(
        { source_type: 'note', feed_type: 'rss' },
        'https://ex.com',
      ),
      'https://ex.com/journal/notes.xml',
    )
    assert.equal(
      sourceRssShareUrl(
        { source_type: 'rss', feed_type: 'rss' },
        'https://ex.com',
      ),
      null,
    )
    assert.equal(
      sourceRssShareUrl(
        { source_type: 'rsshub', feed_type: 'rsshub' },
        'https://ex.com',
      ),
      null,
    )
    assert.equal(
      sourceRssShareUrl(
        { source_type: 'link', feed_type: 'rss' },
        'https://ex.com',
      ),
      null,
    )
  })
})

describe('draftRssShareUrl', () => {
  it('编辑草稿只认笔记', () => {
    assert.equal(
      draftRssShareUrl('note', 'https://ex.com'),
      'https://ex.com/journal/notes.xml',
    )
    assert.equal(draftRssShareUrl('rss', 'https://ex.com'), null)
    assert.equal(draftRssShareUrl('rsshub', 'https://ex.com'), null)
  })
})
