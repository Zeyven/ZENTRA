import type { UserId, WorkspaceId } from '@ayra/domain';
import type { PoolClient } from 'pg';

export async function roleInWorkspace(client: PoolClient, actor: UserId, workspaceId: WorkspaceId) {
  const result = await client.query<{ role: 'OWNER' | 'MEMBER' }>(
    `SELECT role FROM workspace_memberships
     WHERE workspace_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [workspaceId, actor],
  );
  return result.rows[0]?.role;
}
