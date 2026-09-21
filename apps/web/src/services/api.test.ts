import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves the HTTP status for API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'user not found' }),
    }))

    await expect(api('/state?userId=user-1')).rejects.toMatchObject({ name: 'ApiError', message: 'user not found', status: 404 })
  })

  it('keeps fetch network failures distinguishable from HTTP errors', async () => {
    const networkError = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError))
    await expect(api('/state?userId=user-1')).rejects.toBe(networkError)
  })
})
