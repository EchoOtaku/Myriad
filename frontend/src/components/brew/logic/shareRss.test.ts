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

const rustNotes = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../crates/myriad-brew-notes/src/lib.rs',
  ),
  'utf8',
)

describe('notesRssUrl', () => {
  it('拼公开手记 RSS，和后端同一条路径', () => {
    assert.equal(NOTES_RSS_PATH, '/brew/notes.xml')
    assert.match(rustNotes, /NOTES_RSS_PATH: &str = "\/brew\/notes.xml"/)
    assert.equal(notesRssUrl('https://ex.com/'), 'https://ex.com/brew/notes.xml')
    assert.equal(notesRssUrl('https://ex.com'), 'https://ex.com/brew/notes.xml')
    assert.equal(notesRssUrl(''), '/brew/notes.xml')
  })
})

describe('sourceRssShareUrl', () => {
  it('只给手记源公开 RSS', () => {
    assert.equal(
      sourceRssShareUrl(
        { source_type: 'note', feed_type: 'rss' },
        'https://ex.com',
      ),
      'https://ex.com/brew/notes.xml',
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
  it('编辑草稿只认手记', () => {
    assert.equal(
      draftRssShareUrl('note', 'https://ex.com'),
      'https://ex.com/brew/notes.xml',
    )
    assert.equal(draftRssShareUrl('rss', 'https://ex.com'), null)
    assert.equal(draftRssShareUrl('rsshub', 'https://ex.com'), null)
  })
})
