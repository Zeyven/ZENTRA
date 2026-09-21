type Batch = {events: unknown[]; last_event_id: number; has_more: boolean}

// Only a completed HTTP catch-up advances the durable cursor. A newer live
// broadcast does not prove that earlier events were received.
export function createRealtimeRecovery(initial: number, pull: (after: number) => Promise<Batch>,
  notify: () => void, save: (cursor: number) => void): {recover: () => Promise<void>; stop: () => void} {
  let cursor = Number.isSafeInteger(initial) && initial >= 0 ? initial : 0
  let busy = false, stopped = false
  return {
    stop: () => {stopped = true},
    recover: async () => {
      if (stopped || busy) return
      busy = true
      try {
        for (let page = 0; page < 10; page++) {
          const result = await pull(cursor)
          if (stopped) return
          if (!Array.isArray(result.events) || !Number.isSafeInteger(result.last_event_id) || result.last_event_id < cursor ||
              (result.has_more && result.last_event_id <= cursor)) throw new Error('实时补拉游标无效')
          notify()
          cursor = result.last_event_id
          save(cursor)
          if (!result.has_more) return
        }
      } finally {busy = false}
    }
  }
}
