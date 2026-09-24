import { describe, expect, it, vi } from 'vitest';
import {
  hashToolArguments,
  ToolGateway,
  type AyraTool,
  type ToolCall,
  type ToolIdentity,
  type ToolRisk,
} from './index';

const identity = {
  workspaceId: 'workspace-a',
  userId: 'user-a',
  taskId: 'task-a',
  runId: 'run-a',
  stateVersion: 7,
  capabilities: [{ capability: 'repo.write', resourceIds: ['repo-a'] }],
};
const call: ToolCall = {
  runId: 'run-a',
  toolId: 'repo.push',
  toolVersion: '1',
  resourceRef: 'repo-a',
  arguments: { branch: 'fix-a', commits: 2 },
  approvalId: 'approval-a',
  idempotencyKey: 'unique-run-call-a',
};
const tool: AyraTool<{ branch: string; commits: number }, { secret: string; result: string }> = {
  id: 'repo.push',
  version: '1',
  risk: 'EXTERNAL_WRITE',
  capability: 'repo.write',
  inputSchema: {
    parse(value) {
      if (
        typeof value !== 'object' ||
        value === null ||
        !('branch' in value) ||
        typeof value.branch !== 'string' ||
        !('commits' in value) ||
        typeof value.commits !== 'number'
      )
        throw new Error('INVALID_SCHEMA');
      return { branch: value.branch, commits: value.commits };
    },
  },
  authorize: async () => true,
  execute: async (context) => ({ secret: context.credential ?? '', result: 'pushed' }),
  sanitize: (output) => ({ result: output.result }),
};

function setup(risk: ToolRisk = 'EXTERNAL_WRITE', verificationAllowed = true) {
  const resolveIdentity = vi.fn(async (): Promise<ToolIdentity | null> => identity);
  const consume = vi.fn(async () => true);
  const resolve = vi.fn(async () => 'private-token');
  const verify = vi.fn(async () => verificationAllowed);
  const recordAttempt = vi.fn(async () => {});
  const recordSuccess = vi.fn(async () => {});
  const recordFailure = vi.fn(async () => {});
  const gateway = new ToolGateway({
    runIdentity: { resolve: resolveIdentity },
    policy: { authorize: async () => ({ allowed: true, approvalRequired: false }) },
    approval: { consume },
    vault: { resolve },
    verifyHighRisk: { check: verify },
    audit: { recordAttempt, recordSuccess, recordFailure },
  });
  gateway.register({ ...tool, risk });
  return {
    gateway,
    resolveIdentity,
    consume,
    resolve,
    verify,
    recordAttempt,
    recordSuccess,
    recordFailure,
  };
}

describe('Tool Gateway authorization', () => {
  it('binds external approval to exact run, resource, action, and canonical arguments', async () => {
    const { gateway, consume, resolve, recordAttempt, recordSuccess } = setup();
    expect(await gateway.execute(call)).toEqual({ result: 'pushed' });
    expect(consume).toHaveBeenCalledWith({
      approvalId: 'approval-a',
      workspaceId: 'workspace-a',
      runOwnerId: 'user-a',
      taskId: 'task-a',
      runId: 'run-a',
      action: 'repo.push@1',
      resourceRef: 'repo-a',
      argumentsHash: hashToolArguments({ branch: 'fix-a', commits: 2 }),
      stateVersion: 7,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(recordAttempt).toHaveBeenCalledOnce();
    expect(recordSuccess).toHaveBeenCalledOnce();
  });

  it('never resolves credentials when capability or approval is missing', async () => {
    const { gateway, resolveIdentity, resolve } = setup();
    const { approvalId: ignoredApproval, ...withoutApproval } = call;
    void ignoredApproval;
    resolveIdentity.mockResolvedValue({ ...identity, capabilities: [] });
    await expect(gateway.execute(call)).rejects.toThrow('TOOL_CAPABILITY_DENIED');
    resolveIdentity.mockResolvedValue(identity);
    await expect(gateway.execute(withoutApproval)).rejects.toThrow('TOOL_APPROVAL_REQUIRED');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated Run before reading caller supplied capabilities', async () => {
    const { gateway, resolveIdentity, consume, resolve } = setup();
    resolveIdentity.mockResolvedValue(null);
    await expect(gateway.execute(call)).rejects.toThrow('TOOL_RUN_UNAUTHENTICATED');
    resolveIdentity.mockResolvedValue({ ...identity, runId: 'different-run' });
    await expect(gateway.execute(call)).rejects.toThrow('TOOL_RUN_UNAUTHENTICATED');
    expect(consume).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not consume an Approval when attempt audit cannot be recorded', async () => {
    const { gateway, consume, resolve, recordAttempt } = setup();
    recordAttempt.mockRejectedValue(new Error('AUDIT_UNAVAILABLE'));
    await expect(gateway.execute(call)).rejects.toThrow('AUDIT_UNAVAILABLE');
    expect(consume).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects stale approval, missing idempotency key, and version drift before execution', async () => {
    const { gateway, consume, resolve } = setup();
    const { idempotencyKey: ignoredKey, ...withoutKey } = call;
    void ignoredKey;
    consume.mockResolvedValue(false);
    await expect(gateway.execute(call)).rejects.toThrow('TOOL_APPROVAL_INVALID');
    await expect(gateway.execute(withoutKey)).rejects.toThrow('TOOL_IDEMPOTENCY_REQUIRED');
    await expect(gateway.execute({ ...call, toolVersion: '2' })).rejects.toThrow(
      'TOOL_UNAVAILABLE',
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('hashes object arguments independently of key insertion order', () => {
    expect(hashToolArguments({ b: 2, a: { z: 3, x: 1 } })).toBe(
      hashToolArguments({ a: { x: 1, z: 3 }, b: 2 }),
    );
    expect(() => hashToolArguments({ value: Number.NaN })).toThrow('INVALID_TOOL_ARGUMENTS');
  });

  it('requires a snapshot for reversible writes and independent verification for high risk', async () => {
    const reversible = setup('REVERSIBLE');
    await expect(reversible.gateway.execute(call)).rejects.toThrow('TOOL_SNAPSHOT_REQUIRED');
    expect(reversible.resolve).not.toHaveBeenCalled();

    const highRisk = setup('HIGH_RISK', false);
    await expect(highRisk.gateway.execute(call)).rejects.toThrow('TOOL_VERIFICATION_REQUIRED');
    expect(highRisk.consume).not.toHaveBeenCalled();
    expect(highRisk.resolve).not.toHaveBeenCalled();
  });
});
