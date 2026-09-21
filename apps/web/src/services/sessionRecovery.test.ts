import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { createSessionRecovery } from './sessionRecovery'

describe('session recovery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('treats a 404 as an invalid session', async () => {
    const onInvalid = vi.fn()
    const recovery = createSessionRecovery({ sync: async () => { throw new ApiError('user not found', 404) }, onSuccess: vi.fn(), onInvalid, onTransientError: vi.fn() })
    await recovery.run()
    expect(onInvalid).toHaveBeenCalledOnce()
  })

  it('retries transient failures without invalidating the session', async () => {
    let attempts = 0
    const sync = vi.fn(async () => { attempts += 1; if (attempts === 1) throw new TypeError('Failed to fetch') })
    const onInvalid = vi.fn()
    const recovery = createSessionRecovery({ sync, onSuccess: vi.fn(), onInvalid, onTransientError: vi.fn() })
    await recovery.run()
    expect(onInvalid).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('keeps only one retry timer', async () => {
    const sync = vi.fn(async () => { throw new Error('offline') })
    const recovery = createSessionRecovery({ sync, onSuccess: vi.fn(), onInvalid: vi.fn(), onTransientError: vi.fn() })
    await Promise.all([recovery.run(), recovery.run()])
    await vi.advanceTimersByTimeAsync(1000)
    expect(sync).toHaveBeenCalledTimes(3)
  })
})
