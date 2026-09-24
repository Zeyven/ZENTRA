export type TaskStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'VERIFYING'
  | 'PAUSED'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED';

export type Task = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  goal: string;
  type: string;
  status: TaskStatus;
  currentRunId: string | null;
  version: number;
  deletedAt: string | null;
};

export type TaskEvent = {
  id: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: string;
};

export class AyraApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`AYRA API request failed (${status}: ${code})`);
    this.name = 'AyraApiError';
  }
}

export type AyraClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
};

export function createAyraClient(options: AyraClientOptions) {
  const base = new URL(options.baseUrl);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid AYRA API base URL');
  const fetcher = options.fetch ?? fetch;

  async function request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST';
      body?: object;
      idempotencyKey?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const token = await options.getAccessToken();
    if (!token) throw new AyraApiError(401, 'authentication_required');
    if (/\s/.test(token)) throw new Error('Invalid AYRA access token');
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new Error('Cross-origin AYRA API request');
    const response = await fetcher(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
      cache: 'no-store',
      redirect: 'error',
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : 'request_failed';
      throw new AyraApiError(response.status, code);
    }
    return body as T;
  }

  return {
    getTask: (taskId: string, signal?: AbortSignal) =>
      request<Task>(`/v1/tasks/${encodeURIComponent(taskId)}`, { ...(signal ? { signal } : {}) }),
    listTasks: (workspaceId: string, projectId?: string, signal?: AbortSignal) => {
      const query = new URLSearchParams({ workspaceId });
      if (projectId) query.set('projectId', projectId);
      return request<{ tasks: Task[] }>(`/v1/tasks?${query}`, { ...(signal ? { signal } : {}) });
    },
    createTask: (
      input: { workspaceId: string; projectId?: string; title: string; goal: string; type: string },
      idempotencyKey: string,
    ) => {
      if (!idempotencyKey) throw new Error('Task creation requires an idempotency key');
      return request<Task>('/v1/tasks', { method: 'POST', body: input, idempotencyKey });
    },
    startTask: (taskId: string, version: number, idempotencyKey: string) => {
      if (!idempotencyKey) throw new Error('Task start requires an idempotency key');
      return request<{ taskId: string; runId: string; status: TaskStatus; version: number }>(
        `/v1/tasks/${encodeURIComponent(taskId)}/start`,
        { method: 'POST', body: { version }, idempotencyKey },
      );
    },
    cancelTask: (taskId: string, version: number, idempotencyKey: string) => {
      if (!idempotencyKey) throw new Error('Task cancel requires an idempotency key');
      return request<{ taskId: string; runId: string | null; status: TaskStatus; version: number }>(
        `/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: 'POST', body: { version }, idempotencyKey },
      );
    },
    pauseTask: (taskId: string, version: number, idempotencyKey: string) => {
      if (!idempotencyKey) throw new Error('Task pause requires an idempotency key');
      return request<{ taskId: string; runId: string; status: TaskStatus; version: number }>(
        `/v1/tasks/${encodeURIComponent(taskId)}/pause`,
        { method: 'POST', body: { version }, idempotencyKey },
      );
    },
    resumeTask: (taskId: string, version: number, idempotencyKey: string) => {
      if (!idempotencyKey) throw new Error('Task resume requires an idempotency key');
      return request<{ taskId: string; runId: string; status: TaskStatus; version: number }>(
        `/v1/tasks/${encodeURIComponent(taskId)}/resume`,
        { method: 'POST', body: { version }, idempotencyKey },
      );
    },
    getTaskEvents: (taskId: string, afterVersion = 0, signal?: AbortSignal) =>
      request<{ taskId: string; events: TaskEvent[]; nextAfterVersion: number }>(
        `/v1/tasks/${encodeURIComponent(taskId)}/events?${new URLSearchParams({ afterVersion: String(afterVersion) })}`,
        { ...(signal ? { signal } : {}) },
      ),
    getArtifactAccess: (artifactId: string, signal?: AbortSignal) =>
      request<{ url: string; expiresAt: string }>(
        `/v1/artifacts/${encodeURIComponent(artifactId)}/access`,
        { ...(signal ? { signal } : {}) },
      ),
  };
}
