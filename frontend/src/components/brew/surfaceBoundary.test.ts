import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function read(rel: string) {
  return readFileSync(join(dir, rel), 'utf8')
}

describe('brew 舞台契约', () => {
  it('非订阅页共用 BrewPageStage + BrewRailTitle + BrewVacant', () => {
    const grid = read('BrewSourceGrid.tsx')
    const filter = read('BrewFilterLane.tsx')
    const board = read('skin/BrewBoard.tsx')
    const list = read('skin/BrewList.tsx')
    assert.match(grid, /board === 'feeds'/)
    assert.match(grid, /<BrewPageStage/)
    assert.match(grid, /<BrewRailTitle/)
    assert.match(filter, /<BrewPageStage/)
    assert.match(filter, /<BrewRailTitle/)
    assert.match(board, /<BrewVacant/)
    assert.match(list, /<BrewVacant/)
    assert.doesNotMatch(grid, /onBoardSurface/)
    assert.doesNotMatch(grid, /stage=\{/)
    assert.doesNotMatch(filter, /BrewControls/)
    assert.doesNotMatch(filter, /BrewManagement/)
  })

  it('手记文章卡走 StoryCard，不再用 salon 大方卡', () => {
    const board = read('skin/BrewBoard.tsx')
    const notes = read('skin/BrewNotes.tsx')
    const css = read('ui/css/cards.css')
    assert.match(board, /<BrewNotes/)
    assert.doesNotMatch(board, /SalonNote/)
    assert.doesNotMatch(board, /SalonGrid/)
    assert.match(notes, /<BrewStory/)
    assert.match(notes, /<StoryCard/)
    assert.match(notes, /brew-notes/)
    assert.match(css, /\.brew-notes/)
    assert.match(css, /\.brew-notes \{[\s\S]*grid-auto-flow: row;/)
    assert.doesNotMatch(css, /brew-salon/)
  })

  it('朋友们换页不另开舞台高度，点网站卡不去阅读器', () => {
    const stage = read('ui/BrewPageStage.tsx')
    const grid = read('BrewSourceGrid.tsx')
    const friends = read('skin/BrewFriends.tsx')
    const css = read('ui/css/cards.css')
    assert.doesNotMatch(stage, /data-stage/)
    assert.doesNotMatch(grid, /stage='friends'/)
    assert.doesNotMatch(css, /brew-friends-span/)
    assert.match(friends, /visitFriendHref/)
    assert.doesNotMatch(friends, /onSourceClick/)
  })

  it('文章区不走网站卡的卡槽轨', () => {
    const feeds = read('skin/BrewFeeds.tsx')
    const css = read('ui/css/cards.css')
    assert.match(feeds, /useBrewRailPan\(/)
    assert.match(feeds, /data-brew-rail-track="items"/)
    assert.match(css, /\.brew-feeds__items-track \{[\s\S]*?grid-auto-flow: row;/)
    assert.match(css, /\.brew-feeds__items-track \{[\s\S]*?width: max-content;/)
    assert.doesNotMatch(
      css.match(/\.brew-feeds__items-track \{[^}]*\}/)?.[0] ?? '',
      /overflow/,
    )
    assert.match(css, /\.brew-friends__items-track \{[\s\S]*?grid-auto-flow: row;/)
    assert.match(css, /\.brew-friends__sites \{[\s\S]*?grid-auto-flow: column;/)
    assert.match(css, /--brew-story-h: 4\.35rem/)
    assert.match(css, /\.brew-friends \.brew-story__title \{[\s\S]*?-webkit-line-clamp: 1;/)
    assert.match(css, /\.brew-friends \.brew-story__summary/)
    assert.match(css, /\.brew-friends \.brew-story__peek/)
    const vacant = read('ui/Empty.tsx')
    assert.match(vacant, /<StoryGhost key=\{i\} i=\{i\} compact \/>/)
  })

  it('朋友们网站轨和文章轨用订阅页同一套间距', () => {
    const css = read('ui/css/cards.css')
    const feeds = read('ui/css/feeds.css')
    const empty = read('ui/css/empty.css')
    assert.match(feeds, /gap: 0\.75rem/)
    assert.match(
      feeds,
      /padding: 0\.28rem var\(--brew-rail-pad-x\) 0\.35rem/,
    )
    assert.match(css, /\.brew-friends__sites \{[\s\S]*?padding: 0\.28rem 0 0\.35rem/)
    assert.match(css, /\.brew-friends__items-track \{[\s\S]*?padding: 0\.35rem 0/)
    assert.match(css, /\.brew-friends > \.brew-rail-title \{[\s\S]*?margin-top: 0\.75rem/)
    assert.match(
      empty,
      /\.brew-vacant__sites \{[\s\S]*?padding: 0\.28rem 0 0\.35rem/,
    )
    assert.match(
      empty,
      /\.brew-vacant\.is-friends > \.brew-rail-title \{[\s\S]*?margin-top: 0\.75rem/,
    )
  })

  it('标题、网站卡、文章卡、空占位挂同一套 surface', () => {
    const title = read('ui/BrewRailTitle.tsx')
    const site = read('ui/SiteCard.tsx')
    const story = read('ui/StoryCard.tsx')
    const vacant = read('ui/Empty.tsx')
    const friends = read('skin/BrewFriends.tsx')
    assert.match(title, /data-brew-surface=\{entering \? 'title'/)
    assert.match(title, /is-arrive/)
    assert.match(site, /data-brew-surface="site"/)
    assert.match(site, /arrive != null && 'is-arrive'/)
    assert.match(story, /data-brew-surface="story"/)
    assert.match(vacant, /data-brew-surface="vacant"/)
    assert.match(friends, /arrive=\{index < 8 \? index : undefined\}/)
  })

  it('换页播 surface 退场，CSS 进出含标题和网站卡', () => {
    const lane = read('skin/BrewChip.tsx')
    const motion = read('ui/css/motion.css')
    assert.match(lane, /playBrewSurfaceExit/)
    assert.match(lane, /revealFeedsTree/)
    assert.match(motion, /\.brew-rail-title\.is-arrive/)
    assert.match(motion, /\.brew-site\.is-arrive/)
    assert.match(motion, /\.brew-vacant\.is-arrive/)
    assert.match(
      motion,
      /\[data-chip-exit='css'\] \.brew-rail-title/,
    )
    assert.doesNotMatch(motion, /brew-empty/)
  })

  it('控制栏不再挂管理岛', () => {
    const controls = read('manager/BrewControls.tsx')
    const search = read('ui/BrewSearch.tsx')
    assert.match(controls, /<BrewSearch/)
    assert.doesNotMatch(controls, /BrewManagement/)
    assert.doesNotMatch(controls, /useBarWave/)
    assert.doesNotMatch(controls, /BrewBarTags/)
    assert.doesNotMatch(search, /useManagementAccessory/)
    assert.doesNotMatch(search, /createPortal/)
  })
})
