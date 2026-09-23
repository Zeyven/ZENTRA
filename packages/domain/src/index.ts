/** AYRA-owned IDs; provider IDs must stay in adapter mappings. */
declare const idBrand: unique symbol;
export type EntityId<T extends string> = string & { readonly [idBrand]: T };
export type UserId = EntityId<'User'>;
export type WorkspaceId = EntityId<'Workspace'>;
export type TaskId = EntityId<'Task'>;
export type RunId = EntityId<'Run'>;
export const taskStatuses = [
  'DRAFT',
  'QUEUED',
  'UNDERSTANDING',
  'PLANNING',
  'RUNNING',
  'WAITING_APPROVAL',
  'VERIFYING',
  'PAUSED',
  'BLOCKED',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const baselineVersion = 'AYRA BASELINE v1.0 — FROZEN';
