import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ApplyFriendMode.tsx'),
  'utf8',
)

describe('ApplyFriendMode', () => {
  it('跟添加订阅同一套分组，必填成对，不重复面板标题', () => {
    assert.match(src, /phantasi-add-form__pair/)
    assert.match(src, /required/)
    assert.match(src, /multiline/)
    assert.match(src, /applyFriendAgain/)
    assert.doesNotMatch(src, /applyFriendContact/)
    assert.match(src, /phantasi-add-form__done-copy/)
    assert.doesNotMatch(src, /title=\{phantasi\.applyFriendLink\}/)
    assert.doesNotMatch(src, /placeholder=\{phantasi\.applyFriendSiteName\}/)
  })
})
