import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getNeteaseGeoPlaybackUrl,
  getQQGeoPlaybackUrl,
  songsFromPlayerPlaylist,
} from './musicPlayer.ts'

describe('songsFromPlayerPlaylist', () => {
  it('hydrates netease songs with cover proxy and geo playback url', () => {
    const songs = songsFromPlayerPlaylist(
      {
        code: 200,
        source: 'netease',
        playlistId: '42',
        songs: [
          {
            id: '111',
            name: 'Song',
            artist: 'A, B',
            album: 'Album',
            cover: 'https://p1.music.126.net/x.jpg',
            duration: 240,
            isVip: true,
          },
        ],
      },
      true,
    )
    assert.equal(songs.length, 1)
    assert.equal(songs[0].id, '111')
    assert.equal(songs[0].source, 'netease')
    assert.equal(songs[0].isVip, true)
    assert.equal(songs[0].duration, 240)
    assert.equal(songs[0].url, getNeteaseGeoPlaybackUrl('111', true))
    assert.match(songs[0].cover, /p1\.music\.126\.net/)
  })

  it('hydrates qq songs without vendor cdlist fields', () => {
    const songs = songsFromPlayerPlaylist(
      {
        code: 200,
        source: 'qq',
        playlistId: '99',
        songs: [
          {
            id: '001abcXY',
            name: 'Q',
            artist: 'S',
            album: 'Al',
            cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000MID.jpg',
            duration: 180,
            isVip: false,
          },
        ],
      },
      false,
    )
    assert.equal(songs[0].url, getQQGeoPlaybackUrl('001abcXY', false))
    assert.equal(songs[0].source, 'qq')
    assert.equal(songs[0].isVip, false)
  })
})
