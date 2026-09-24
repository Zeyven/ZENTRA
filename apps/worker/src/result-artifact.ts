import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resultObjectKey(workspaceId: string, taskId: string, runId: string) {
  if (![workspaceId, taskId, runId].every((value) => uuid.test(value)))
    throw new Error('Invalid AYRA result identity');
  return `workspaces/${workspaceId}/tasks/${taskId}/runs/${runId}/result.txt`;
}

/** Store bytes first, then register one Task-backed Artifact in PostgreSQL. */
export function createResultArtifactCanonicalizer(pool: Pool, s3: S3Client, bucket: string) {
  if (!bucket) throw new Error('Result bucket is required');
  return async (runId: string, output: string): Promise<void> => {
    const target = await pool.query<{ workspace_id: string; task_id: string }>(
      'SELECT workspace_id, task_id FROM ayra.worker_result_target($1)',
      [runId],
    );
    const row = target.rows[0];
    if (!row) throw new Error('Result Task is unavailable');
    const body = Buffer.from(output, 'utf8');
    if (body.length < 1 || body.length > 10_485_760)
      throw new Error('Result text exceeds artifact size limits');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = resultObjectKey(row.workspace_id, row.task_id, runId);
    let exists = false;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (head.Metadata?.sha256 !== sha256 || head.ContentLength !== body.length)
        throw new Error('Result object conflicts with canonical Run output');
      exists = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('$metadata' in error) ||
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 404
      )
        throw error;
    }
    if (!exists) {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'text/plain; charset=utf-8',
            ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
            Metadata: { sha256 },
            IfNoneMatch: '*',
          }),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('$metadata' in error) ||
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 412
        )
          throw error;
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        if (head.Metadata?.sha256 !== sha256 || head.ContentLength !== body.length)
          throw new Error('Concurrent result object conflicts with canonical Run output', {
            cause: error,
          });
      }
    }
    const objectRef = `s3://${bucket}/${key}`;
    const registered = await pool.query<{ artifact_id: string }>(
      'SELECT ayra.worker_register_result_artifact($1, $2, $3, $4) AS artifact_id',
      [runId, objectRef, sha256, body.length],
    );
    if (!registered.rows[0]?.artifact_id)
      throw new Error('Result Artifact metadata was not registered');
  };
}
