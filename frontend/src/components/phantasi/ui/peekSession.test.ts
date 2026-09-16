import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, it } from 'node:test'
import { notePeekPointer, peekNodeFromPoint, resetPeekPointer } from './peekLane'
import { applyPeekFace, readPeekFace, writePeekFace } from './PhantasiPeekAir'
import { releasePhantasiStoryPeek, resumePhantasiStoryPeek } from './StoryCard'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div class="phantasi-view-lane"><div data-phantasi-peek-lane><button class="phantasi-story" data-rail-id="1"><span class="phantasi-story__title">One</span></button></div></div><nav class="nav-container"></nav>')
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
dom.window.matchMedia = () => ({ matches: true })
const prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
after(() => {
  if (prior) Object.defineProperty(globalThis, 'document', prior)
  else Reflect.deleteProperty(globalThis, 'document')
  if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  dom.window.close()
})
const doc = dom.window.document
const card = doc.querySelector('button')!
let hit: Element | null = card
doc.elementFromPoint = () => hit

it('navigation ends the current card session', () => {
  let ended = 0
  card.classList.add('is-peek')
  releasePhantasiStoryPeek(card, doc.querySelector('nav'), () => ended++)
  assert.equal(ended, 1)
  assert.equal(card.classList.contains('is-peek'), false)
})
it('an inert outgoing page cannot be resumed', () => {
  notePeekPointer({ clientX: 10, clientY: 10 })
  card.closest('.phantasi-view-lane')!.setAttribute('inert', '')
  assert.equal(resumePhantasiStoryPeek(), false)
  card.closest('.phantasi-view-lane')!.removeAttribute('inert')
})
it('after route replacement the live card under the pointer resumes', () => {
  const replacement = card.cloneNode(true) as HTMLElement
  card.replaceWith(replacement)
  hit = replacement
  let id = 0
  assert.equal(resumePhantasiStoryPeek((item) => { id = item.id }), true)
  assert.equal(id, 1)
  assert.equal(replacement.classList.contains('is-peek'), true)
})
it('pointer cancellation invalidates a stale hover hit', () => {
  resetPeekPointer()
  assert.equal(peekNodeFromPoint(), null)
})
it('a card without a cover clears the previous wallpaper', () => {
  writePeekFace({ src: '/one.jpg', title: 'One', source: '', sourceIcon: null })
  applyPeekFace(null)
  assert.equal(readPeekFace(), null)
})
