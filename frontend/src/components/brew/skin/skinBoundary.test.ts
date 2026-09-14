import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function walk(root: string, suffix: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const next = join(root, entry.name)
    if (entry.isDirectory()) out.push(...walk(next, suffix))
    else if (suffix.test(entry.name)) out.push(next)
  }
  return out
}

describe('brew/skin 边界', () => {
  it('皮不进口 brewApi / pageData / manager', () => {
    const files = walk(dir, /\.(ts|tsx)$/).filter(
      (file) => !file.endsWith('.test.ts'),
    )
    assert.ok(files.length > 0)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, /from ['"].*brewApi['"]/)
      assert.doesNotMatch(src, /from ['"].*pageData['"]/)
      assert.doesNotMatch(src, /from ['"].*useBoardPage['"]/)
      assert.doesNotMatch(src, /from ['"].*useBrewSources['"]/)
      assert.doesNotMatch(src, /from ['"].*useBrewItems['"]/)
      assert.doesNotMatch(src, /from ['"].*useBrewStarred['"]/)
      assert.doesNotMatch(src, /from ['"].*useBrewNotes['"]/)
      assert.doesNotMatch(src, /from ['"].*useBrewSeo['"]/)
      assert.doesNotMatch(src, /from ['"]\.\.\/manager/)
    }
  })

  it('工作台是仪表盘壳：侧栏一页一项，分类标题用 SettingSection', () => {
    const src = readFileSync(join(dir, 'BrewWorkbench.tsx'), 'utf8')
    assert.match(src, /brew-workbench__rail/)
    assert.match(src, /config-sidebar/)
    assert.match(src, /config-nav-item/)
    assert.match(src, /onPane/)
    assert.match(src, /pane === 'notes'/)
    assert.match(src, /pane === 'media'/)
    assert.match(src, /brew-workbench__kpis/)
    assert.match(src, /SettingSection/)
    assert.match(src, /ManagedList/)
    assert.match(src, /SettingsButton/)
    assert.match(src, /workbenchNotes/)
    assert.match(src, /workbenchSearchNotes/)
    assert.match(src, /workbenchSearchMedia/)
    assert.match(src, /workbenchSearchSources/)
    assert.match(src, /workbenchDefaultSort/)
    assert.match(src, /layout="horizontal"/)
    assert.match(src, /refreshAllSources/)
    assert.doesNotMatch(src, /description=\{brew\.workbenchSourcesHint\}/)
    assert.match(src, /filterWorkbenchNotes/)
    assert.match(src, /filterWorkbenchMedia/)
    assert.match(src, /workbenchMedia/)
    assert.match(src, /workbenchSources/)
    assert.match(src, /workbenchNavTransfer/)
    assert.match(src, /workbenchNoteTransferHint/)
    assert.match(src, /workbenchFeedTransferHint/)
    assert.doesNotMatch(src, /pack: 'transfer'/)
    assert.match(src, /workbenchBrewpack/)
    assert.match(src, /workbenchOpml/)
    assert.match(src, /workbenchWordpress/)
    assert.match(src, /workbenchHalo/)
    assert.match(src, /workbenchTypecho/)
    assert.match(src, /workbenchMarkdown/)
    assert.match(src, /SiWordpress/)
    assert.match(src, /HaloIcon/)
    assert.match(src, /TypechoIcon/)
    assert.match(src, /SiMarkdown/)
    assert.match(src, /workbenchExportNotes/)
    assert.match(src, /TransferActions/)
    assert.match(src, /brew-workbench__drop/)
    assert.match(src, /startImport/)
    assert.match(src, /pane === 'notesIo'/)
    assert.match(src, /pane === 'feedsIo'/)
    assert.match(src, /pane === 'add'/)
    assert.match(src, /open\('add'\)/)
    assert.doesNotMatch(src, /sourceFormOpen/)
    assert.doesNotMatch(src, /pane === 'wordpress'/)
    assert.doesNotMatch(src, /pane === 'brewpack'/)
    assert.match(src, /admin/)
    assert.doesNotMatch(src, /SettingGroup/)
    assert.doesNotMatch(src, /from ['"]\.\.\/manager/)
  })
})
