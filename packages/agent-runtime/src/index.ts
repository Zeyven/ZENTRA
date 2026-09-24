/** AYRA-owned contract. Provider SDK objects never cross this boundary. */
export type CapabilityGrant = Readonly<{
  capability: string;
  resourceIds: readonly string[];
}>;

export type CostBudget = Readonly<{
  maxUsd: number;
  maxTokens: number;
}>;

export type ContextItem = Readonly<{
  id: string;
  text: string;
  sourceType:
    'WORKSPACE' | 'PROJECT' | 'CONVERSATION' | 'RESOURCE' | 'MEMORY' | 'ARTIFACT' | 'DECISION';
  sourceId: string;
}>;

export type ContextBundle = Readonly<{
  workspaceId: string;
  userGoal: string;
  items: readonly ContextItem[];
  tokenBudget: number;
}>;

export type AgentRunInput = Readonly<{
  taskId: string;
  runId: string;
  goal: string;
  context: ContextBundle;
  capabilities: readonly CapabilityGrant[];
  budget: CostBudget;
  policyVersion: string;
}>;

export type AgentRunState = Readonly<{
  taskId: string;
  runId: string;
  checkpointId: string;
  policyVersion: string;
}>;

export type ApprovalDecision = Readonly<{
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  stateVersion: number;
}>;

export type AgentRunResult =
  | Readonly<{ status: 'COMPLETED'; output: string; model: string; promptVersion: string }>
  | Readonly<{ status: 'WAITING_APPROVAL'; state: AgentRunState; approvalIds: readonly string[] }>
  | Readonly<{ status: 'PAUSED'; state: AgentRunState; reason: string }>;

export interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  resume(state: AgentRunState, decisions?: readonly ApprovalDecision[]): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
}

/** Handoffs cannot grant a child a capability or resource absent from its parent. */
export function assertDelegatedCapabilities(
  parent: readonly CapabilityGrant[],
  child: readonly CapabilityGrant[],
): void {
  for (const grant of child) {
    const parentResources = new Set(
      parent
        .filter((entry) => entry.capability === grant.capability)
        .flatMap((entry) => entry.resourceIds),
    );
    if (
      !grant.resourceIds.length ||
      !parentResources.size ||
      grant.resourceIds.some((id) => !parentResources.has(id))
    )
      throw new Error('DELEGATED_CAPABILITY_EXCEEDS_PARENT');
  }
}
