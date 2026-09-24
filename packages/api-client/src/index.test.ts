import { describe, expect, it, vi } from 'vitest';
import { AyraApiError, createAyraClient } from './index';

describe('AYRA client authorization boundary', () => {
  it('does not call the network without a session', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createAyraClient({
      baseUrl: 'https://api.ayra.example',
      getAccessToken: () => null,
      fetch: fetcher,
    });
    await expect(client.getTask('task-id')).rejects.toMatchObject({
      status: 401,
      code: 'authentication_required',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a Task start key and version only to the configured API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ taskId: 'task-id', runId: 'run-id', status: 'QUEUED', version: 2 }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const client = createAyraClient({
      baseUrl: 'https://api.ayra.example',
      getAccessToken: async () => 'session-token',
      fetch: fetcher,
    });
    await client.startTask('task-id', 1, 'retry-key');
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.ayra.example/v1/tasks/task-id/start');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Idempotency-Key': 'retry-key',
      },
      body: '{"version":1}',
      cache: 'no-store',
      redirect: 'error',
    });
  });

  it('preserves canonical API conflict codes for recovery', async () => {
    const client = createAyraClient({
      baseUrl: 'https://api.ayra.example',
      getAccessToken: () => 'session-token',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'version_or_state_conflict' }), { status: 409 }),
        ),
    });
    await expect(client.startTask('task-id', 1, 'retry-key')).rejects.toEqual(
      new AyraApiError(409, 'version_or_state_conflict'),
    );
  });

  it('scopes approval inbox requests to the configured API and workspace', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextAfter: null }), { status: 200 }),
      );
    const client = createAyraClient({
      baseUrl: 'https://api.ayra.example',
      getAccessToken: () => 'session-token',
      fetch: fetcher,
    });
    await client.listPendingApprovals('workspace-id', { limit: 20, after: 'approval-id' });
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://api.ayra.example/v1/approvals?workspaceId=workspace-id&limit=20&after=approval-id',
    );
    expect(options).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer session-token' },
      cache: 'no-store',
      redirect: 'error',
    });
  });

  it('rejects credential-bearing and insecure remote API origins', () => {
    for (const baseUrl of [
      'http://api.ayra.example',
      'https://user:secret@api.ayra.example',
      'https://api.ayra.example/other/',
    ]) {
      expect(() => createAyraClient({ baseUrl, getAccessToken: () => null })).toThrow(
        'Invalid AYRA API base URL',
      );
    }
  });
});
