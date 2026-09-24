/** Activity boundary for AYRA's durable Task orchestration. */
export type ApprovalWait = Readonly<{
  kind: 'APPROVAL_REQUIRED';
  approvalId: string;
  stateVersion: number;
}>;

export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'STALE';
export type ApprovedRequest = Readonly<{ approvalId: string; stateVersion: number }>;

export interface TaskActivities {
  loadTask(runId: string): Promise<{ taskId: string; goal: string; type: string }>;
  enterStage(
    runId: string,
    stage: 'UNDERSTANDING' | 'PLANNING' | 'RUNNING' | 'VERIFYING',
  ): Promise<void>;
  understand(runId: string, goal: string): Promise<string>;
  plan(runId: string, understanding: string): Promise<string>;
  execute(
    runId: string,
    plan: string,
    approvedRequest?: ApprovedRequest,
  ): Promise<string | ApprovalWait>;
  approvalState(runId: string, approvalId: string, stateVersion: number): Promise<ApprovalState>;
  verify(runId: string, output: string): Promise<boolean>;
  completeRun(runId: string, output: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  failRun(runId: string, reason: string): Promise<void>;
}
