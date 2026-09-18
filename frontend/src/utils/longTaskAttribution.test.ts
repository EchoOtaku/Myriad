import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loafSourceOf, longTaskSourceOf } from './longTaskAttribution'

function entry(extra: object): PerformanceEntry {
  return extra as PerformanceEntry
}

describe('longTaskSourceOf', () => {
  it('prefers containerSrc without the origin', () => {
    assert.equal(
      longTaskSourceOf(
        entry({
          attribution: [
            {
              containerSrc: 'https://example.test/assets/Home-abc.js',
              containerName: 'home',
            },
          ],
        }),
      ),
      '/assets/Home-abc.js',
    )
  })

  it('falls back to container type when src is empty', () => {
    assert.equal(
      longTaskSourceOf(entry({ attribution: [{ containerType: 'iframe' }] })),
      'iframe',
    )
  })
})

describe('loafSourceOf', () => {
  it('picks the longest script and keeps the file name', () => {
    assert.equal(
      loafSourceOf(
        entry({
          scripts: [
            { sourceURL: 'https://x.test/a.js', duration: 12 },
            { sourceURL: 'https://x.test/assets/NoteEditor-1.js', duration: 80 },
          ],
        }),
      ),
      'NoteEditor-1.js',
    )
  })
})
