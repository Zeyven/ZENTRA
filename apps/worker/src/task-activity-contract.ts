/** Activity boundary for AYRA's durable Task orchestration. */
export interface TaskActivities {
  loadTask(runId: string): Promise<{ taskId: string; goal: string; type: string }>;
  enterStage(
    runId: string,
    stage: 'UNDERSTANDING' | 'PLANNING' | 'RUNNING' | 'VERIFYING',
  ): Promise<void>;
  understand(runId: string, goal: string): Promise<string>;
  plan(runId: string, understanding: string): Promise<string>;
  execute(runId: string, plan: string): Promise<string>;
  verify(runId: string, output: string): Promise<boolean>;
  completeRun(runId: string, output: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  failRun(runId: string, reason: string): Promise<void>;
}
