import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSessionUserId, loadSessionUserId, saveSessionUserId } from './session'

describe('session user id', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('persists the current user id', () => {
    saveSessionUserId('user-123')
    expect(loadSessionUserId()).toBe('user-123')
  })

  it('clears an expired user id', () => {
    saveSessionUserId('user-123')
    clearSessionUserId()
    expect(loadSessionUserId()).toBeNull()
  })
})
