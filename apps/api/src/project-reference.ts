import type { WorkspaceId } from '@ayra/domain';
import type { PoolClient } from 'pg';
import { InactiveProjectError } from './request-context';

export async function requireActiveProject(
  client: PoolClient,
  workspaceId: WorkspaceId,
  projectId: string | null,
) {
  if (!projectId) return;
  const project = await client.query(
    `SELECT id FROM projects WHERE id = $1 AND workspace_id = $2
     AND archived_at IS NULL AND deleted_at IS NULL FOR SHARE`,
    [projectId, workspaceId],
  );
  if (!project.rows[0]) throw new InactiveProjectError('Linked Project is unavailable');
}
