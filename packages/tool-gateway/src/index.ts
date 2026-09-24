import { createHash } from 'node:crypto';

export type ToolRisk = 'SAFE' | 'REVERSIBLE' | 'EXTERNAL_WRITE' | 'HIGH_RISK';
export type ToolIdentity = Readonly<{
  workspaceId: string;
  userId: string;
  taskId: string;
  runId: string;
  stateVersion: number;
  capabilities: readonly Readonly<{ capability: string; resourceIds: readonly string[] }>[];
}>;

export type ToolCall = Readonly<{
  runId: string;
  toolId: string;
  toolVersion: string;
  resourceRef: string;
  arguments: unknown;
  approvalId?: string;
  idempotencyKey?: string;
  snapshotId?: string;
}>;

export type AuthorizedToolCall = ToolCall & Readonly<{ identity: ToolIdentity }>;

export type ApprovalBinding = Readonly<{
  approvalId: string;
  workspaceId: string;
  userId: string;
  taskId: string;
  runId: string;
  action: string;
  resourceRef: string;
  argumentsHash: string;
  stateVersion: number;
}>;

export interface AyraTool<I, O> {
  id: string;
  version: string;
  risk: ToolRisk;
  capability: string;
  inputSchema: { parse(value: unknown): I };
  authorize(identity: ToolIdentity, resourceRef: string, input: I): Promise<boolean>;
  execute(
    context: Readonly<{
      identity: ToolIdentity;
      resourceRef: string;
      idempotencyKey?: string;
      snapshotId?: string;
      credential: string | null;
    }>,
    input: I,
  ): Promise<O>;
  sanitize(output: O): unknown;
}

export interface ToolGatewayDependencies {
  runIdentity: { resolve(runId: string): Promise<ToolIdentity | null> };
  policy: {
    authorize(
      call: AuthorizedToolCall,
      risk: ToolRisk,
    ): Promise<{ allowed: boolean; approvalRequired: boolean }>;
  };
  approval: { consume(binding: ApprovalBinding): Promise<boolean> };
  vault: {
    resolve(identity: ToolIdentity, toolId: string, resourceRef: string): Promise<string | null>;
  };
  verifyHighRisk: { check(call: AuthorizedToolCall, argumentsHash: string): Promise<boolean> };
  audit: {
    recordAttempt(call: AuthorizedToolCall, argumentsHash: string): Promise<void>;
    recordSuccess(call: AuthorizedToolCall, argumentsHash: string): Promise<void>;
    recordFailure(call: AuthorizedToolCall, argumentsHash: string): Promise<void>;
  };
}

function stableJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('INVALID_TOOL_ARGUMENTS');
    seen.add(value);
    const serialized = `[${value.map((item) => stableJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return serialized;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (seen.has(value)) throw new Error('INVALID_TOOL_ARGUMENTS');
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (Object.getOwnPropertySymbols(record).length) throw new Error('INVALID_TOOL_ARGUMENTS');
    const keys = Object.keys(record).sort();
    if (keys.some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype'))
      throw new Error('INVALID_TOOL_ARGUMENTS');
    const serialized = `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key], seen)}`).join(',')}}`;
    seen.delete(value);
    return serialized;
  }
  throw new Error('INVALID_TOOL_ARGUMENTS');
}

export function hashToolArguments(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export class ToolGateway {
  private readonly tools = new Map<string, AyraTool<unknown, unknown>>();

  constructor(private readonly dependencies: ToolGatewayDependencies) {}

  register<I, O>(tool: AyraTool<I, O>): void {
    if (!tool.id || !tool.version || !tool.capability || this.tools.has(tool.id))
      throw new Error('INVALID_OR_DUPLICATE_TOOL');
    this.tools.set(tool.id, tool as AyraTool<unknown, unknown>);
  }

  async execute(call: ToolCall): Promise<unknown> {
    const identity = await this.dependencies.runIdentity.resolve(call.runId);
    if (!identity || identity.runId !== call.runId) throw new Error('TOOL_RUN_UNAUTHENTICATED');
    const tool = this.tools.get(call.toolId);
    if (!tool || tool.version !== call.toolVersion) throw new Error('TOOL_UNAVAILABLE');
    const resourceRef = call.resourceRef.trim();
    if (!resourceRef || !Number.isSafeInteger(identity.stateVersion) || identity.stateVersion < 1)
      throw new Error('INVALID_TOOL_CALL');
    if (
      !identity.capabilities.some(
        (grant) => grant.capability === tool.capability && grant.resourceIds.includes(resourceRef),
      )
    )
      throw new Error('TOOL_CAPABILITY_DENIED');

    const input = tool.inputSchema.parse(call.arguments);
    const argumentsHash = hashToolArguments(input);
    const canonicalCall = { ...call, identity, resourceRef, arguments: input };
    if (!(await tool.authorize(identity, resourceRef, input)))
      throw new Error('TOOL_RESOURCE_DENIED');
    const policy = await this.dependencies.policy.authorize(canonicalCall, tool.risk);
    if (!policy.allowed) throw new Error('TOOL_POLICY_DENIED');

    if (
      tool.risk !== 'SAFE' &&
      (!call.idempotencyKey || call.idempotencyKey.length < 8 || call.idempotencyKey.length > 128)
    )
      throw new Error('TOOL_IDEMPOTENCY_REQUIRED');
    if (tool.risk === 'REVERSIBLE' && !call.snapshotId) throw new Error('TOOL_SNAPSHOT_REQUIRED');
    if (
      tool.risk === 'HIGH_RISK' &&
      !(await this.dependencies.verifyHighRisk.check(canonicalCall, argumentsHash))
    )
      throw new Error('TOOL_VERIFICATION_REQUIRED');
    const requiresApproval =
      policy.approvalRequired || tool.risk === 'EXTERNAL_WRITE' || tool.risk === 'HIGH_RISK';
    if (requiresApproval && !call.approvalId) throw new Error('TOOL_APPROVAL_REQUIRED');
    await this.dependencies.audit.recordAttempt(canonicalCall, argumentsHash);
    try {
      if (requiresApproval) {
        const consumed = await this.dependencies.approval.consume({
          approvalId: call.approvalId!,
          workspaceId: identity.workspaceId,
          userId: identity.userId,
          taskId: identity.taskId,
          runId: identity.runId,
          action: `${tool.id}@${tool.version}`,
          resourceRef,
          argumentsHash,
          stateVersion: identity.stateVersion,
        });
        if (!consumed) throw new Error('TOOL_APPROVAL_INVALID');
      }
      const credential = await this.dependencies.vault.resolve(identity, tool.id, resourceRef);
      const output = await tool.execute(
        {
          identity,
          resourceRef,
          ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
          ...(call.snapshotId ? { snapshotId: call.snapshotId } : {}),
          credential,
        },
        input,
      );
      const result = tool.sanitize(output);
      await this.dependencies.audit.recordSuccess(canonicalCall, argumentsHash);
      return result;
    } catch (error) {
      await this.dependencies.audit.recordFailure(canonicalCall, argumentsHash);
      throw error;
    }
  }
}
