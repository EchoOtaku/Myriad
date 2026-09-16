import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolvePageRouteAnimation } from '../../tapp/routing/tappRouteMeta.ts'
import { pageIdFromPath } from './pageId.ts'

const dir = dirname(fileURLToPath(import.meta.url))

describe('pageIdFromPath', () => {
  it('第一段之下整棵子路由都是同一页', () => {
    assert.equal(pageIdFromPath('/journal'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/notes'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/starred'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/friends'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/articles/12'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/topics/rust'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/feeds/3'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/workbench'), 'phantasi')
    assert.equal(pageIdFromPath('/journal/workbench/feeds/add'), 'phantasi')
    assert.equal(pageIdFromPath('/library'), 'library')
    assert.equal(pageIdFromPath('/library/anything'), 'library')
    assert.equal(pageIdFromPath('/tapp/run/1'), 'tapp')
    assert.equal(pageIdFromPath('/'), 'home')
    assert.equal(resolvePageRouteAnimation('/journal').key, '/journal')
    assert.equal(resolvePageRouteAnimation('/journal/notes').key, '/journal')
    assert.equal(
      resolvePageRouteAnimation('/journal/workbench/feeds/add').key,
      '/journal',
    )
  })

  it('同页换子路径不跑离页清理，进场也不按整段 pathname 重开', () => {
    const scheduler = readFileSync(join(dir, 'useRouteScheduler.ts'), 'utf8')
    const view = readFileSync(join(dir, '../../components/AnimatedView.tsx'), 'utf8')
    const page = readFileSync(join(dir, 'pages/phantasi.ts'), 'utf8')
    assert.match(scheduler, /pageId === lastPageIdRef.current/)
    assert.match(scheduler, /from ['"]\.\/pageId['"]/)
    assert.match(view, /pageIdFromPath\(location.pathname\)/)
    assert.doesNotMatch(view, /pathname.replaceAll/)
    assert.match(view, /\[pageId, onEnterComplete\]/)
    assert.match(page, /phantasiMotionReset/)
    assert.match(page, /playPhantasiVeilExit/)
  })
})
