import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function read(rel: string) {
  return readFileSync(join(dir, rel), 'utf8')
}

describe('phantasi 舞台契约', () => {
  it('非订阅页共用 PhantasiPageStage + PhantasiRailTitle + PhantasiVacant', () => {
    const grid = read('PhantasiSourceGrid.tsx')
    const filter = read('PhantasiFilterLane.tsx')
    const board = read('skin/PhantasiBoard.tsx')
    const list = read('skin/PhantasiList.tsx')
    assert.match(grid, /board === 'feeds'/)
    assert.match(grid, /<PhantasiPageStage/)
    assert.match(grid, /<PhantasiRailTitle/)
    assert.match(filter, /<PhantasiPageStage/)
    assert.match(filter, /<PhantasiRailTitle/)
    assert.match(board, /<PhantasiVacant/)
    assert.match(list, /<PhantasiVacant/)
    const feeds = read('skin/PhantasiFeeds.tsx')
    assert.match(feeds, /layout="friends"/)
    assert.match(feeds, /emptyNoSources/)
    assert.match(grid, /layout=\{board === 'notes' \? 'articles' : 'friends'\}/)
    assert.doesNotMatch(grid, /onBoardSurface/)
    assert.doesNotMatch(grid, /stage=\{/)
    assert.doesNotMatch(filter, /PhantasiControls/)
    assert.doesNotMatch(filter, /PhantasiManagement/)
    assert.doesNotMatch(grid, /PhantasiControls/)
    const page = read('../../views/Phantasi.tsx')
    assert.match(page, /phantasi-search-bar/)
    assert.match(page, /route\.viewMode !== 'workbench'/)
    assert.match(page, /<PhantasiSearch/)
    const top = read('ui/css/top-options.css')
    assert.match(top, /\.phantasi-search-bar,/)
    assert.match(top, /position: fixed/)
    assert.match(top, /top: 1rem/)
  })

  it('笔记文章卡走 StoryCard，不再用 salon 大方卡', () => {
    const board = read('skin/PhantasiBoard.tsx')
    const notes = read('skin/PhantasiNotes.tsx')
    const grid = read('PhantasiSourceGrid.tsx')
    const css = read('ui/css/cards.css')
    assert.match(board, /<PhantasiNotes/)
    assert.doesNotMatch(board, /SalonNote/)
    assert.doesNotMatch(board, /SalonGrid/)
    assert.match(notes, /<PhantasiStory/)
    assert.match(notes, /<StoryCard/)
    assert.match(notes, /phantasi-notes/)
    assert.doesNotMatch(notes, /phantasi-notes__cat/)
    assert.match(grid, /PhantasiNoteCategoryTitleTags/)
    assert.match(css, /\.phantasi-notes/)
    assert.match(css, /\.phantasi-notes-track[\s\S]*?grid-auto-flow: row;/)
    assert.match(
      css,
      /\.phantasi-notes-track \.phantasi-story,[\s\S]*?height: var\(--phantasi-story-h\)/,
    )
    assert.doesNotMatch(
      css,
      /\.phantasi-notes-track \.phantasi-story,[\s\S]*?height: 100%;/,
    )
    assert.doesNotMatch(css, /phantasi-salon/)
    assert.doesNotMatch(css, /phantasi-notes__cat/)
  })

  it('朋友们换页不另开舞台高度，点网站卡不去阅读器', () => {
    const stage = read('ui/PhantasiPageStage.tsx')
    const grid = read('PhantasiSourceGrid.tsx')
    const friends = read('skin/PhantasiFriends.tsx')
    const css = read('ui/css/cards.css')
    assert.doesNotMatch(stage, /data-stage/)
    assert.doesNotMatch(grid, /stage='friends'/)
    assert.doesNotMatch(css, /phantasi-friends-span/)
    assert.match(grid, /showApply=\{board === 'sites'\}/)
    assert.match(friends, /visitFriendHref/)
    assert.doesNotMatch(friends, /onSourceClick/)
    assert.doesNotMatch(friends, /onOpenLatest/)
    assert.doesNotMatch(grid, /onOpenLatest/)
    assert.doesNotMatch(read('skin/PhantasiFeeds.tsx'), /onOpenLatest/)
    assert.doesNotMatch(read('skin/PhantasiFeedsSites.tsx'), /onOpenLatest/)
    assert.doesNotMatch(read('ui/SiteCard.tsx'), /onOpenLatest/)
    assert.match(read('ui/SiteCard.tsx'), /className="phantasi-site__article"/)
    assert.doesNotMatch(read('ui/SiteCard.tsx'), /<button[^>]*phantasi-site__article/)
    assert.match(read('ui/SiteCard.tsx'), /listedStyleTags\(styleTags\)/)
    assert.match(read('ui/SiteCard.tsx'), /tags\.length > 0/)
    assert.match(read('skin/PhantasiFeedsSites.tsx'), /styleTags=\{source\.ai_style_tags\}/)
    assert.match(read('skin/PhantasiFriends.tsx'), /styleTags=\{source\.ai_style_tags\}/)
    assert.match(
      read('skin/PhantasiFriends.tsx'),
      /emptyLabel=\{isSiteSource\(source\) \? undefined : t\.phantasi\.noArticles\}/,
    )
    assert.match(
      read('skin/PhantasiFeedsSites.tsx'),
      /emptyLabel=\{isSiteSource\(source\) \? undefined : emptyLabel\}/,
    )
    assert.match(read('ui/SiteCard.tsx'), /emptyLabel \? \(/)
    assert.match(grid, /shuffleBySeed\(sourcesForBoard\(sources, 'sites'\), friendSeed/)
    assert.match(grid, /board === 'sites' \? friendSources : board === 'notes' \? notesSources : sorted/)
    assert.match(friends, /usePhantasiRailCruise/)
    assert.match(friends, /friendsSiteAutoOn\(sources.length\)/)
    assert.match(friends, /friendsStoryAutoOn\(stories.length\)/)
    assert.match(friends, /siteCruise\.onGrab/)
    assert.match(friends, /storyCruise\.onGrab/)
    const cruise = read('skin/usePhantasiRailCruise.ts')
    assert.match(cruise, /alignColumn\(next\.align, false, true\)/)
    assert.doesNotMatch(cruise, /api\.seek/)
    assert.match(cruise, /railCruiseNextCol/)
    assert.match(friends, /loopOn \? loopCols \* 2 : loopCols/)
    assert.match(friends, /storyLoopOn \? storyLoopCols \* 2/)
    assert.match(friends, /copy: 1/)
    assert.match(friends, /loopOn \? loopCols : 0/)
    assert.match(friends, /storyLoopOn \? storyLoopCols : 0/)
  })

  it('文章区不走网站卡的卡槽轨', () => {
    const feeds = read('skin/PhantasiFeeds.tsx') + read('skin/PhantasiFeedsStories.tsx')
    const css = read('ui/css/cards.css')
    assert.match(feeds, /usePhantasiRailPan\(/)
    assert.match(feeds, /data-phantasi-rail-track="items"/)
    assert.match(css, /\.phantasi-feeds__items-track \{[\s\S]*?grid-auto-flow: row;/)
    assert.match(css, /\.phantasi-feeds__items-track \{[\s\S]*?width: max-content;/)
    assert.doesNotMatch(
      css.match(/\.phantasi-feeds__items-track \{[^}]*\}/)?.[0] ?? '',
      /overflow/,
    )
    assert.match(css, /\.phantasi-friends__items-track \{[\s\S]*?grid-auto-flow: row;/)
    assert.match(
      css,
      /\.phantasi-friends__items-track \{[\s\S]*?grid-template-rows: var\(--phantasi-story-h/,
    )
    assert.match(
      css,
      /\.phantasi-friends__sites-track \{[\s\S]*?grid-auto-flow: column;/,
    )
    assert.doesNotMatch(
      css.match(/\.phantasi-friends__sites \{[^}]*\}/)?.[0] ?? '',
      /overflow:\s*(auto|hidden)/,
    )
    assert.doesNotMatch(
      css.match(/\.phantasi-friends__items \{[^}]*\}/)?.[0] ?? '',
      /overflow:\s*(auto|hidden)/,
    )
    assert.doesNotMatch(
      css.match(/\.phantasi-page__body \{[^}]*\}/)?.[0] ?? '',
      /overflow:\s*(auto|hidden)/,
    )
    assert.doesNotMatch(css, /--phantasi-story-h: 4\.35rem/)
    assert.doesNotMatch(css, /\.phantasi-friends \.phantasi-story__title/)
    assert.doesNotMatch(css, /\.phantasi-friends \.phantasi-story__summary/)
    const vacant = read('ui/Empty.tsx')
    assert.doesNotMatch(vacant, /compact/)
    const friends = read('skin/PhantasiFriends.tsx')
    assert.match(friends, /usePhantasiRailPan\(/)
    assert.match(friends, /storyCruise\.onIdle/)
    assert.match(friends, /data-phantasi-rail-track="sites"/)
    assert.match(friends, /stories\.length/)
    assert.doesNotMatch(friends, /stories\.length \/ 2/)
    const list = read('skin/PhantasiList.tsx')
    assert.match(list, /phantasi-stories-track/)
  })

  it('朋友们网站轨和文章轨用订阅页同一套间距', () => {
    const css = read('ui/css/cards.css')
    const feeds = read('ui/css/feeds.css')
    const empty = read('ui/css/empty.css')
    assert.match(feeds, /gap: 0\.75rem/)
    assert.match(
      feeds,
      /padding: 0\.28rem var\(--phantasi-rail-pad-x\) 0\.35rem/,
    )
    assert.match(css, /\.phantasi-friends__sites-track \{[\s\S]*?padding: 0\.28rem 0 0\.35rem/)
    assert.match(css, /\.phantasi-friends__items-track \{[\s\S]*?padding: 0\.35rem 0/)
    assert.match(css, /\.phantasi-friends > \.phantasi-rail-title \{[\s\S]*?margin-top: 0\.75rem/)
    assert.match(
      css,
      /\.phantasi-friends \.phantasi-site,\n\.phantasi-friends \.phantasi-site:hover \{\n {2}opacity: 1;/,
    )
    assert.match(
      empty,
      /\.phantasi-vacant__sites \{[\s\S]*?padding: 0\.28rem 0 0\.35rem/,
    )
    assert.doesNotMatch(
      empty.match(/\.phantasi-vacant__sites \{[^}]*\}/)?.[0] ?? '',
      /overflow:\s*(auto|hidden)/,
    )
    assert.match(
      empty,
      /\.phantasi-vacant\.is-friends > \.phantasi-rail-title \{[\s\S]*?margin-top: 0\.75rem/,
    )
  })

  it('标题、网站卡、文章卡、空占位挂同一套 surface', () => {
    const title = read('ui/PhantasiRailTitle.tsx')
    const site = read('ui/SiteCard.tsx')
    const story = read('ui/StoryCard.tsx')
    const vacant = read('ui/Empty.tsx')
    const friends = read('skin/PhantasiFriends.tsx')
    const feedsSites = read('skin/PhantasiFeedsSites.tsx')
    const feedsStory = read('skin/PhantasiStory.tsx')
    const feeds = read('skin/PhantasiFeeds.tsx')
    assert.match(title, /data-phantasi-surface=\{entering \? 'title'/)
    assert.match(title, /is-arrive/)
    assert.match(title, /phantasi-rail-title__actions/)
    assert.match(title, /tags/)
    assert.match(title, /pinned && 'is-actions-on'/)
    assert.match(site, /data-phantasi-surface="site"/)
    assert.match(site, /arrive != null && 'is-arrive'/)
    assert.match(story, /data-phantasi-surface="story"/)
    assert.match(vacant, /data-phantasi-surface="vacant"/)
    assert.match(friends, /arrive=\{copy === 0 && index < 8 \? index : undefined\}/)
    assert.match(feedsSites, /arrive=\{arrive < 8 \? arrive : undefined\}/)
    assert.match(feedsStory, /arrive=\{arrive < 8 \? arrive : undefined\}/)
    assert.doesNotMatch(feeds, /arrive=\{false\}/)
  })

  it('换页播 surface 退场，CSS 进出含标题和网站卡', () => {
    const lane = read('skin/PhantasiChip.tsx')
    const motion = read('ui/css/motion.css')
    assert.match(lane, /playPhantasiSurfaceExit/)
    assert.match(lane, /revealFeedsTree/)
    assert.match(motion, /\.phantasi-rail-title\.is-arrive/)
    const feedsCss = read('ui/css/feeds.css')
    assert.match(feedsCss, /@media \(hover: hover\) and \(pointer: fine\)/)
    assert.match(feedsCss, /\.phantasi-rail-title:hover \.phantasi-rail-title__actions/)
    assert.match(feedsCss, /\.phantasi-rail-title\.is-actions-on \.phantasi-rail-title__actions/)
    assert.match(motion, /\.phantasi-site\.is-arrive/)
    assert.match(motion, /\.phantasi-vacant\.is-arrive/)
    assert.match(
      motion,
      /\[data-chip-exit='css'\] \.phantasi-rail-title/,
    )
    assert.doesNotMatch(motion, /phantasi-empty/)
  })

  it('控制栏不再挂管理岛', () => {
    const page = read('../../views/Phantasi.tsx')
    const search = read('ui/PhantasiSearch.tsx')
    assert.match(page, /<PhantasiSearch/)
    assert.doesNotMatch(page, /PhantasiControls/)
    assert.doesNotMatch(page, /PhantasiManagement/)
    assert.doesNotMatch(page, /useBarWave/)
    assert.doesNotMatch(page, /PhantasiBarTags/)
    assert.doesNotMatch(search, /useManagementAccessory/)
    assert.doesNotMatch(search, /createPortal/)
  })
})
