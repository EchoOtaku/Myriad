import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  neighborsInQueue,
  notesWallNeighbors,
  readingQueue,
  readingQueueFromStories,
} from './readingQueue'

it('uses the captured queue, not a later list, for neighbors', () => {
  const opened = readingQueue('starred', [
    { id: 1, title: 'A' },
    { id: 2, title: 'B' },
    { id: 3, title: 'C' },
  ])
  const agent = readingQueue(
    'agent',
    [
      { id: 9, title: 'Agent' },
      { id: 2, title: 'B' },
    ],
    'Tonight',
  )
  const fromStarred = neighborsInQueue(opened, 2)
  assert.equal(fromStarred?.prev?.id, 1)
  assert.equal(fromStarred?.next?.id, 3)
  assert.equal(fromStarred?.index, 1)
  const hijack = neighborsInQueue(agent, 2)
  assert.equal(hijack?.prev?.id, 9)
  assert.notEqual(fromStarred?.prev?.id, hijack?.prev?.id)
  assert.equal(neighborsInQueue(opened, 9), null)
  assert.equal(neighborsInQueue(readingQueue('direct', []), 1), null)
})

it('uses cached feed stories when present, otherwise the clicked story', () => {
  const cached = readingQueueFromStories(
    'feeds',
    [
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ],
    [{ id: 2, title: 'B' }],
  )
  assert.deepEqual(
    neighborsInQueue(cached, 2),
    {
      prev: { id: 1, title: 'A' },
      next: null,
      index: 1,
      total: 2,
      name: undefined,
    },
  )
  const fallback = readingQueueFromStories('feeds', null, [
    { id: 2, title: 'B' },
  ])
  assert.equal(fallback.items.length, 1)
  assert.equal(fallback.items[0]?.id, 2)
})

it('notes board keeps its own origin', () => {
  const queue = readingQueue('notes', [{ id: 4, title: '笔记' }])
  assert.equal(queue.origin, 'notes')
  assert.equal(neighborsInQueue(queue, 4)?.total, 1)
})

it('notes wall queue uses shown notes and leftover stories', () => {
  const neighbors = notesWallNeighbors(
    [
      { id: 4, title: '墙上第一篇' },
      { id: 5, title: '墙上第二篇' },
    ],
    [{ id: 6, title: '剩下的源' }, null],
  )
  const queue = readingQueueFromStories('notes', neighbors, [{ id: 5, title: '墙上第二篇' }])
  assert.equal(queue.origin, 'notes')
  assert.deepEqual(neighborsInQueue(queue, 5), {
    prev: { id: 4, title: '墙上第一篇' },
    next: { id: 6, title: '剩下的源' },
    index: 1,
    total: 3,
    name: undefined,
  })
})
