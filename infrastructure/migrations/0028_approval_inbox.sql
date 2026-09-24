-- Keyset pagination for the target user's pending Approval inbox.
CREATE INDEX approvals_pending_inbox_idx
  ON approvals (workspace_id, user_id, created_at DESC, id DESC)
  WHERE status = 'PENDING';
