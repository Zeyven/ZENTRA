import { describe, expect, it } from 'vitest';
import type { UserId, WorkspaceId } from '@ayra/domain';
import { workspacePolicy } from './policy';

const actor = '00000000-0000-7000-8000-000000000001' as UserId;
const workspaceId = '00000000-0000-7000-8000-000000000002' as WorkspaceId;
const owner = { workspaceId, role: 'OWNER', status: 'ACTIVE' } as const;
const member = { workspaceId, role: 'MEMBER', status: 'ACTIVE' } as const;

describe('workspace project policy', () => {
  it('fails closed for missing or mismatched membership', () => {
    expect(workspacePolicy.authorize({ actor, workspaceId, action: 'project:read' })).toEqual({
      allowed: false,
      reason: 'NO_MEMBERSHIP',
    });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'project:create',
        membership: {
          ...owner,
          workspaceId: '00000000-0000-7000-8000-000000000003' as WorkspaceId,
        },
      }),
    ).toEqual({ allowed: false, reason: 'NO_MEMBERSHIP' });
  });
  it('lets members read but reserves Project writes for owners', () => {
    expect(
      workspacePolicy.authorize({ actor, workspaceId, action: 'project:read', membership: member }),
    ).toEqual({ allowed: true });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'project:create',
        membership: member,
      }),
    ).toEqual({ allowed: false, reason: 'INSUFFICIENT_ROLE' });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'project:update',
        membership: owner,
      }),
    ).toEqual({ allowed: true });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'project:archive',
        membership: member,
      }),
    ).toEqual({ allowed: false, reason: 'INSUFFICIENT_ROLE' });
    expect(
      workspacePolicy.authorize({ actor, workspaceId, action: 'task:read', membership: member }),
    ).toEqual({ allowed: true });
    expect(
      workspacePolicy.authorize({ actor, workspaceId, action: 'task:create', membership: member }),
    ).toEqual({ allowed: false, reason: 'INSUFFICIENT_ROLE' });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'conversation:read',
        membership: member,
      }),
    ).toEqual({ allowed: true });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'conversation:archive',
        membership: member,
      }),
    ).toEqual({ allowed: false, reason: 'INSUFFICIENT_ROLE' });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'resource:read',
        membership: member,
      }),
    ).toEqual({ allowed: true });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'resource:delete',
        membership: member,
      }),
    ).toEqual({ allowed: false, reason: 'INSUFFICIENT_ROLE' });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'artifact:read',
        membership: member,
      }),
    ).toEqual({ allowed: true });
    expect(
      workspacePolicy.authorize({
        actor,
        workspaceId,
        action: 'artifact:create',
        membership: member,
      }),
    ).toEqual({ allowed: false, reason: 'INSUFFICIENT_ROLE' });
  });
});
