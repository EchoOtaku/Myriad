import assert from 'node:assert/strict'
import test from 'node:test'
import { speakableText } from './speakableText'
import { SpeechSegmenter } from './speechSegmenter'

test('strips markdown, code, and URLs so TTS does not read markup', () => {
  assert.equal(speakableText('你好 **世界**'), '你好 世界')
  assert.equal(speakableText('见 https://example.com/a 吧'), '见 吧')
  assert.equal(
    speakableText('前文\n```js\nconsole.log(1)\n```\n后文'),
    '前文 后文',
  )
  assert.equal(speakableText('用 `code` 标记'), '用 标记')
  assert.equal(speakableText('[点这里](https://x.test) 继续'), '继续')
  assert.equal(speakableText('# 标题\n- 一项'), '标题 一项')
})

test('emits a segment at a stable sentence end, not on every token', () => {
  const splitter = new SpeechSegmenter('msg-1', 2)
  assert.deepEqual(splitter.push('你好'), [])
  assert.deepEqual(splitter.push('，今'), [])
  const ready = splitter.push('天好。下')
  assert.equal(ready.length, 1)
  assert.equal(ready[0]?.text, '你好，今天好。')
  assert.equal(ready[0]?.sequence, 1)
  assert.equal(ready[0]?.generation, 2)
  const rest = splitter.end()
  assert.equal(rest.length, 1)
  assert.equal(rest[0]?.text, '下')
})

test('empty speakable leftovers do not emit a segment', () => {
  const splitter = new SpeechSegmenter('msg-2')
  assert.deepEqual(splitter.push('```js\nfoo()\n```'), [])
  assert.deepEqual(splitter.end(), [])
})
