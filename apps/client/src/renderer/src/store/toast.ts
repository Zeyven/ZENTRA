import { create } from 'zustand'

interface ToastItem {
  id: number
  msg: string
  type: 'success' | 'error' | 'info'
}

interface ToastState {
  toasts: ToastItem[]
  push: (msg: string, type?: ToastItem['type']) => void
  remove: (id: number) => void
}

let seq = 0

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  push: (msg, type = 'success') => {
    const id = ++seq
    // Routine feedback is a latest-result slot, not a playback queue.
    // Keep unacknowledged errors, but never replay stale successes after a failure.
    set((s) => {
      const errors = s.toasts.filter(t => t.type === 'error')
      return { toasts: type === 'error'
        ? [{ id, msg, type }, ...errors.filter(t => t.msg !== msg)]
        : [...errors, { id, msg, type }] }
    })
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export function toast(msg: string, type: ToastItem['type'] = 'success'): void {
  useToast.getState().push(msg, type)
}
