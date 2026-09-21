import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createHomeStickerItem, serializeDashboardLayout } from './homeLayout'
import { applyPublishedStickerUrls } from './homeLayoutPublication'

it('applies published URLs while preserving subsequent moves, replacements and deletions', () => {
  const tile = createHomeStickerItem({ size: '2x2', position: { x: 0, y: 0 }, imageUrl: '/api/media/1/content', prompt: 'cat' })
  const submitted = { standard: [], free: [tile] }
  const saved = serializeDashboardLayout({ standard: [], free: [{ ...tile, config: { ...tile.config, imageUrl: '/media/assets/public/cat.png' } }] })
  const moved = { standard: [], free: [{ ...tile, position: { x: 2, y: 3 } }] }
  const applied = applyPublishedStickerUrls(moved, submitted, saved)
  assert.equal(applied.free[0].config?.imageUrl, '/media/assets/public/cat.png')
  assert.deepEqual(applied.free[0].position, { x: 2, y: 3 })
  const replaced = { standard: [], free: [{ ...tile, config: { ...tile.config, imageUrl: '/api/media/2/content' } }] }
  assert.equal(applyPublishedStickerUrls(replaced, submitted, saved), replaced)
  const deleted = { standard: [], free: [] }
  assert.equal(applyPublishedStickerUrls(deleted, submitted, saved), deleted)
  assert.equal(applyPublishedStickerUrls(submitted, submitted, undefined), submitted)
  assert.equal(applyPublishedStickerUrls(submitted, submitted, 'invalid'), submitted)
})
