import assert from 'node:assert/strict'
import { afterEach, it, mock } from 'node:test'
import { displayImageUrl } from '../components/phantasi/notes/noteImageUrl'
import { apiService } from './api'
import { listMedia, saveMediaEdit, uploadMedia } from './mediaApi'

const asset = {
  id: 7, kind: 'upload' as const, url: '/media/federation/1/photo.png',
  mime: 'image/png', name: 'photo.png', size: 12, created_at: 1, references: [],
}

afterEach(() => mock.restoreAll())

it('list and saved edits retain API references and paths; display resolves per origin', async () => {
  const items = [asset]
  mock.method(apiService, 'get', async () => ({ success: true, items }))
  mock.method(apiService, 'post', async () => ({ item: asset }))
  assert.equal(await listMedia(), items)
  assert.equal(await saveMediaEdit(7, 'data:image/png;base64,AA==', false), asset)
  for (const origin of ['', 'https://api.example']) {
    assert.equal(displayImageUrl(asset.url, origin), `${origin}${asset.url}`)
  }
  assert.equal(asset.url, '/media/federation/1/photo.png')
})

it('invalid catalog rows fail instead of disappearing or receiving empty URLs', async () => {
  mock.method(apiService, 'get', async () => ({ items: [asset, { ...asset, url: '' }] }))
  mock.method(apiService, 'post', async () => ({ item: { ...asset, id: '7' } }))
  await assert.rejects(listMedia(), /Invalid media response/)
  await assert.rejects(saveMediaEdit(7, 'data:image/png;base64,AA==', false), /Invalid media response/)
})

it('upload retains the response asset and sends file contents in multipart', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  })
  const file = new File(['image bytes'], 'photo.png', { type: 'image/png' })
  mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (String(url).includes('csrf')) return Response.json({ csrf_token: null })
    assert.equal(url, '/api/media')
    assert.equal(options?.method, 'POST')
    const uploaded = (options?.body as FormData).get('file') as File
    assert.equal(await uploaded.text(), await file.text())
    return { ok: true, json: async () => ({ success: true, item: asset }) } as Response
  })
  assert.equal(await uploadMedia(file), asset)
})
