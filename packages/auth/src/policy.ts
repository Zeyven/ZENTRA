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
  | 'conversation:create'
  | 'conversation:read'
  | 'conversation:update'
  | 'conversation:archive'
  | 'conversation:restore'
  | 'resource:create'
  | 'resource:read'
  | 'resource:update'
  | 'resource:delete'
  | 'artifact:create'
  | 'artifact:read'
  | 'artifact:update'
  | 'artifact:delete'
  | 'run:create'
  | 'run:read'
  | 'run:update'
  | 'approval:create'
  | 'approval:read'
  | 'task:create'
  | 'task:start'
  | 'task:cancel'
  | 'task:pause'
  | 'task:resume'
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
        action === 'conversation:create' ||
        action === 'conversation:update' ||
        action === 'conversation:archive' ||
        action === 'conversation:restore' ||
        action === 'resource:create' ||
        action === 'resource:update' ||
        action === 'resource:delete' ||
        action === 'artifact:create' ||
        action === 'artifact:update' ||
        action === 'artifact:delete' ||
        action === 'run:create' ||
        action === 'run:update' ||
        action === 'approval:create' ||
        action === 'task:create' ||
        action === 'task:start' ||
        action === 'task:cancel' ||
        action === 'task:pause' ||
        action === 'task:resume' ||
        action === 'task:update' ||
        action === 'task:delete') &&
      membership.role !== 'OWNER'
    )
      return { allowed: false, reason: 'INSUFFICIENT_ROLE' };
    return { allowed: true };
  },
};
