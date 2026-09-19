import assert from 'node:assert/strict'
import { test } from 'node:test'
import { islandMusicContent } from './islandMusicContent.ts'

const input = { currentSong: { id: 'one', name: 'First', artist: 'Artist A' }, isPlaying: true, lyrics: [{ time: 0, text: 'Same line' }, { time: 3, text: 'Same line' }, { time: 10, text: 'End' }], currentLyricIndex: 0 }

test('identical lyrics in different songs retain current song metadata', () => {
  const first = islandMusicContent(input)!
  const second = islandMusicContent({ ...input, currentSong: { id: 'two', name: 'Second', artist: 'Artist B' } })!
  assert.equal(first.text, second.text)
  assert.equal(second.subtext, 'Second - Artist B')
})

test('identical consecutive lines still receive their own timing', () => {
  assert.equal(islandMusicContent(input)!.lyricDuration, 3)
  assert.equal(islandMusicContent({ ...input, currentLyricIndex: 1 })!.lyricDuration, 7)
  assert.equal(islandMusicContent({ ...input, currentLyricIndex: 2 })!.lyricDuration, 8)
})

test('missing lyric indices, pause and cleared songs have safe presentations', () => {
  assert.equal(islandMusicContent({ ...input, currentLyricIndex: 99 })!.text, 'First')
  assert.equal(islandMusicContent({ ...input, isPlaying: false })!.playing, false)
  assert.equal(islandMusicContent({ ...input, currentSong: null }), null)
})

test('metadata corrections and replaced lyric arrays are reflected without changing song id', () => {
  assert.equal(islandMusicContent({ ...input, currentSong: { ...input.currentSong, artist: 'Corrected' } })!.subtext, 'First - Corrected')
  assert.equal(islandMusicContent({ ...input, lyrics: [{ time: 0, text: 'Corrected lyric' }] })!.text, 'Corrected lyric')
})
