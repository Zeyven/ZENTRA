export type LogSource = 'request' | 'system' | 'operation' | 'audit' | 'clock' | 'realtime'
export interface MaintenanceLog {
  id: number; source: LogSource; created_at: string; store_id: number | null; user_id: number | null; operator_name: string | null
  action: string; level: string; request_id: string | null; method: string | null; route: string | null
  status_code: number | null; duration_ms: number | null; detail?: unknown
}
export interface LogPage {
  rows: MaintenanceLog[]; has_more: boolean; next_cursor: number | null; limit: number; source: LogSource
}
export interface MaintenanceSummary {
  version: string; server_time: string; timezone: string; uptime_seconds: number; memory_mb: number; database_readable: boolean
  collector: { started_at: string; failed_writes: number; last_write_at: string | null; last_failure_at: string | null }
  retention: { days: number; max_rows: number }
  recent: { requests: number; errors: number; rejected: number; slow: number; average_ms: number }
  coverage: { source: LogSource; label: string; latest: { id: number; created_at: string } | null }[]
}
