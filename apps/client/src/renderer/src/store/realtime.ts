import { create } from 'zustand'

interface RealtimeState {
  version: number
  connected: boolean
  bump: () => void
}

export const useRealtime = create<RealtimeState>((set) => ({
  version: 0,
  connected: false,
  bump: () => set((s) => ({ version: s.version + 1 }))
}))

// 供非组件上下文（api 层等）调用
export function bumpRealtime(): void {
  useRealtime.getState().bump()
}
export function setRealtimeConnected(connected:boolean){useRealtime.setState({connected})}
