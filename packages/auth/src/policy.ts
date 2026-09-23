import type { UserId, WorkspaceId } from '@ayra/domain';

export type WorkspaceRole = 'OWNER' | 'MEMBER';
export type PolicyAction =
  | 'workspace:create'
  | 'workspace:read'
  | 'workspace:update'
  | 'project:create'
  | 'project:read'
  | 'project:update'
  | 'project:archive'
  | 'project:restore'
  | 'task:create'
  | 'task:read'
  | 'task:update'
  | 'task:delete';
export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'NO_MEMBERSHIP' | 'INSUFFICIENT_ROLE' };

export interface PolicyEngine {
  authorize(input: {
    actor: UserId;
    action: PolicyAction;
    workspaceId?: WorkspaceId;
    membership?: {
      readonly workspaceId: WorkspaceId;
      readonly role: WorkspaceRole;
      readonly status: 'ACTIVE';
    } | null;
  }): PolicyDecision;
}

export const workspacePolicy: PolicyEngine = {
  authorize({ action, workspaceId, membership }) {
    if (action === 'workspace:create') return { allowed: true };
    if (!workspaceId || !membership || membership.workspaceId !== workspaceId)
      return { allowed: false, reason: 'NO_MEMBERSHIP' };
    if (
      (action === 'workspace:update' ||
        action === 'project:create' ||
        action === 'project:update' ||
        action === 'project:archive' ||
        action === 'project:restore' ||
        action === 'task:create' ||
        action === 'task:update' ||
        action === 'task:delete') &&
      membership.role !== 'OWNER'
    )
      return { allowed: false, reason: 'INSUFFICIENT_ROLE' };
    return { allowed: true };
  },
};
