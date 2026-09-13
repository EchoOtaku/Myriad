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
