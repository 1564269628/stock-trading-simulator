import { ApiError } from './api'

export interface SessionRecovery {
  run(): Promise<void>
  stop(): void
}

export const createSessionRecovery = (options: {
  sync: () => Promise<void>
  onSuccess: () => void
  onInvalid: () => void
  onTransientError: () => void
  delay?: number
}): SessionRecovery => {
  let stopped = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleRetry = () => {
    if (!stopped && retryTimer === undefined) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void recovery.run()
      }, options.delay ?? 1000)
    }
  }

  const recovery: SessionRecovery = {
    async run() {
      if (stopped) return
      try {
        await options.sync()
        options.onSuccess()
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          options.onInvalid()
          return
        }
        options.onTransientError()
        scheduleRetry()
      }
    },
    stop() {
      stopped = true
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
    },
  }

  return recovery
}
