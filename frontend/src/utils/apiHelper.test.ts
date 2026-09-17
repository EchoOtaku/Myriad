import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError } from '../services/api'
import { handleErrorResponse, readJsonOk } from './apiHelper.ts'

describe('handleErrorResponse', () => {
  it('throws ApiError with the backend code and message', async () => {
    const response = Response.json(
      {
        error: 'Setup already completed',
        message: 'Admin exists',
        code: 'setup_completed',
      },
      { status: 403 },
    )
    await assert.rejects(
      () => handleErrorResponse(response, '操作失败'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 403)
        assert.equal(error.code, 'setup_completed')
        assert.equal(error.message, 'Admin exists')
        return true
      },
    )
  })

  it('does not dump raw JSON when the body is not JSON', async () => {
    const response = new Response('upstream exploded', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    })
    await assert.rejects(
      () => handleErrorResponse(response, '操作失败'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 502)
        assert.equal(error.message, 'upstream exploded')
        return true
      },
    )
  })

  it('readJsonOk keeps the server message on HTTP errors', async () => {
    const response = Response.json(
      { success: false, message: 'Source filter rejected', code: 'bad_request' },
      { status: 400 },
    )
    await assert.rejects(
      () => readJsonOk(response, '资料库没能加载。'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 400)
        assert.equal(error.code, 'bad_request')
        assert.equal(error.message, 'Source filter rejected')
        return true
      },
    )
  })

  it('readJsonOk returns JSON when the response is ok', async () => {
    const body = { success: true, items: [] }
    const parsed = await readJsonOk(Response.json(body))
    assert.deepEqual(parsed, body)
  })
})
