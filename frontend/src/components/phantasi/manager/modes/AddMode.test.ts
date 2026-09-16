import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

describe('AddMode 主题聚合', () => {
  it('添加订阅不夹主题聚合；订阅页按钮进主题聚合', () => {
    const add = readFileSync(join(dir, 'AddMode.tsx'), 'utf8')
    const kinds = readFileSync(join(dir, 'SourceKindControl.tsx'), 'utf8')
    const board = readFileSync(join(dir, '../../logic/board.ts'), 'utf8')
    const routes = readFileSync(join(dir, '../../logic/journalRoutes.ts'), 'utf8')
    const rail = readFileSync(join(dir, '../../skin/PhantasiWorkbench.tsx'), 'utf8')
    const feeds = readFileSync(join(dir, '../../skin/PhantasiWorkbenchFeeds.tsx'), 'utf8')
    const field = readFileSync(join(dir, 'TopicAggregateField.tsx'), 'utf8')
    assert.doesNotMatch(add, /TopicAggregateField/)
    assert.doesNotMatch(add, /SettingGroupGrid/)
    assert.doesNotMatch(kinds, /topicAggregate/)
    assert.doesNotMatch(kinds, /value: 'topic'/)
    assert.match(board, /'topics'/)
    assert.match(routes, /topics: '\/journal\/workbench\/feeds\/topics'/)
    assert.doesNotMatch(rail, /pane: 'topics'/)
    assert.match(rail, /pane === 'topics' && item\.pane === 'sources'/)
    assert.match(feeds, /onPane\('add'\)/)
    assert.match(feeds, /onPane\('topics'\)/)
    assert.match(feeds, /topicAggregate/)
    assert.match(feeds, /setOpened/)
    assert.match(feeds, /backToList/)
    assert.match(field, /listSubscriptionTopicCatalog/)
    assert.match(field, /setFeedTopicCards/)
    assert.match(field, /SettingGroupGrid/)
    assert.match(field, /columns=\{3\}/)
    assert.match(field, /getItemPreviews/)
    assert.match(field, /pickTopicCardPreviews/)
    assert.match(field, /topic-preview/)
    assert.doesNotMatch(field, /descriptionVisible/)
    assert.doesNotMatch(field, /journalTopicPath/)
    assert.doesNotMatch(field, /useNavigate/)
  })
})
