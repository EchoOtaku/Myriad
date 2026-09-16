import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { pageIdFromPath } from '../../../hooks/animation/pageId.ts'
import { resolvePageRouteAnimation } from '../../../tapp/routing/tappRouteMeta.ts'

const dir = dirname(fileURLToPath(import.meta.url))
const skin = join(dir, '../skin')
const page = readFileSync(join(dir, '../../../views/Phantasi.tsx'), 'utf8')
const grid = readFileSync(join(dir, '../PhantasiSourceGrid.tsx'), 'utf8')
const feeds = readFileSync(join(skin, 'PhantasiFeedsStories.tsx'), 'utf8')
const notes = readFileSync(join(skin, 'PhantasiNotes.tsx'), 'utf8')
const friends = readFileSync(join(skin, 'PhantasiFriends.tsx'), 'utf8')
const list = readFileSync(join(skin, 'PhantasiList.tsx'), 'utf8')
const filter = readFileSync(join(dir, '../PhantasiFilterLane.tsx'), 'utf8')
const chip = readFileSync(join(dir, 'Chip.tsx'), 'utf8')
const lane = readFileSync(join(dir, 'peekLane.ts'), 'utf8')
const air = readFileSync(join(dir, 'PhantasiPeekAir.tsx'), 'utf8')

describe('期刊各子页 peek', () => {
  it('订阅、笔记、友链、收藏都走同一条委托轨，工作台不挂 peek', () => {
    assert.match(feeds, /usePhantasiPeekLane/)
    assert.match(feeds, /data-phantasi-rail-track="items"/)
    assert.match(notes, /usePhantasiPeekLane/)
    assert.match(notes, /data-phantasi-peek-lane/)
    assert.match(friends, /usePhantasiPeekLane/)
    assert.match(friends, /data-phantasi-peek-lane/)
    assert.match(list, /usePhantasiPeekLane/)
    assert.match(list, /data-phantasi-peek-lane/)
    assert.match(
      filter,
      /onPeekItem=\{starredMode\?\.isEditMode \? undefined : onPeekItem\}/,
    )
    const workbench = readFileSync(
      join(dir, '../PhantasiWorkbenchLane.tsx'),
      'utf8',
    )
    assert.doesNotMatch(workbench, /onPeekItem|onPeekEnd|usePhantasiPeekLane/)
  })

  it('壁纸在期刊根上，换板只换内层 wave，不按子路径清页', () => {
    assert.match(page, /export default function Phantasi\(\) \{[\s\S]*<PhantasiPeekAir face=\{peekFace\} \/>/)
    assert.match(page, /writePeekFace/)
    assert.match(grid, /wave=\{board\}/)
    assert.match(page, /wave=\{\n          route\.viewMode === 'topic-feed'/)
    assert.equal(pageIdFromPath('/journal/notes'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/starred'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/friends'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/workbench/feeds/add'), 'phantasi')
    assert.equal(resolvePageRouteAnimation('/journal/notes').key, '/journal')
  })

  it('换树看 inert / 忙槽，不另起按住时间戳', () => {
    assert.doesNotMatch(lane, /holdPhantasiPeekSwap/)
    assert.doesNotMatch(lane, /peekHoldUntil/)
    assert.doesNotMatch(chip, /holdPhantasiPeekSwap/)
    assert.doesNotMatch(page, /holdPhantasiPeekSwap/)
    assert.match(lane, /peekLaneIsSwapping/)
    assert.match(lane, /peekGoesToNav/)
    assert.match(page, /settlePeekSession/)
    assert.match(page, /decidePeekSettle/)
    assert.match(lane, /peekHitKeepsAir/)
    assert.match(air, /applyPeekFace/)
  })
})
