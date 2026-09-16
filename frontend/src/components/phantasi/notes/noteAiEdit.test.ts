import assert from 'node:assert/strict'
import { it } from 'node:test'
import { buildNoteAiRequest, mergeNoteAiResult, sameNoteAiDocument } from './noteAiEdit'

const document = { identity: '1:2', title: '标题', topic: '旅行', contentMd: '前😀\n重复\n重复\n后' }
it('sends the entire draft and exact UTF-8 selection, including repeated paragraphs', () => {
  const request = buildNoteAiRequest(document, { start: 7, end: 9 }, '整理', 'zh-CN')
  assert.equal(request.content_md, '前😀\n重复\n重复\n后')
  assert.deepEqual(request.selection, { start: 15, end: 21, text: '重复' })
  assert.equal(request.title, '标题')
  assert.equal(request.instruction, '整理')
})
it('replaces only the captured selection and preserves all surrounding source', () => {
  assert.equal(mergeNoteAiResult(document.contentMd, { start: 7, end: 9 }, '**重复**'), '前😀\n重复\n**重复**\n后')
})
it('rejects stale contexts after body, title, category, or identity changes', () => {
  for (const change of [{ contentMd: 'new' }, { title: 'new' }, { topic: null }, { identity: '2:2' }]) {
    assert.equal(sameNoteAiDocument(document, { ...document, ...change }), false)
  }
  assert.equal(sameNoteAiDocument(document, { ...document }), true)
})
it('rejects empty or invalid selections instead of silently formatting the whole document', () => {
  for (const range of [{ start: -1, end: 2 }, { start: 8, end: 80 }, { start: 1, end: 2 }, { start: 4, end: 4 }]) {
    assert.throws(() => buildNoteAiRequest(document, range, '', 'zh-CN'))
  }
})
