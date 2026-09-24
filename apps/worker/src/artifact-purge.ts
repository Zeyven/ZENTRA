import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';

type PurgeClaim = {
  request_id: string;
  workspace_id: string;
  artifact_id: string;
  task_id: string;
  run_id: string | null;
  object_ref: string;
  provenance: { kind?: string };
  claim_token: string;
};

export type ArtifactPurgeResult = {
  claimed: number;
  completed: number;
  failed: number;
};

/** Only policy-scheduled, due Artifact requests can be claimed. No implicit retention window. */
export async function purgeDueArtifacts(
  pool: Pool,
  objects: S3Client,
  bucket: string,
  limit = 10,
): Promise<ArtifactPurgeResult> {
  const claims = await pool.query<PurgeClaim>('SELECT * FROM ayra.claim_due_artifact_purges($1)', [
    limit,
  ]);
  const result: ArtifactPurgeResult = { claimed: claims.rows.length, completed: 0, failed: 0 };
  for (const claim of claims.rows) {
    const key = claim.run_id
      ? `workspaces/${claim.workspace_id}/tasks/${claim.task_id}/runs/${claim.run_id}/result.txt`
      : null;
    let errorCode: 'UNSUPPORTED_OBJECT_REF' | 'OBJECT_DELETE_FAILED' | 'DATABASE_FINALIZE_FAILED' =
      'UNSUPPORTED_OBJECT_REF';
    try {
      if (
        !key ||
        claim.provenance?.kind !== 'RUN_RESULT' ||
        claim.object_ref !== `s3://${bucket}/${key}`
      )
        throw new Error('Unsupported managed Artifact object reference');
      errorCode = 'OBJECT_DELETE_FAILED';
      await objects.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      errorCode = 'DATABASE_FINALIZE_FAILED';
      const completed = await pool.query<{ outcome: string }>(
        'SELECT ayra.complete_artifact_purge($1, $2) AS outcome',
        [claim.request_id, claim.claim_token],
      );
      if (completed.rows[0]?.outcome !== 'COMPLETED')
        throw new Error('Artifact purge claim became stale');
      result.completed += 1;
    } catch {
      result.failed += 1;
      await pool.query('SELECT ayra.fail_artifact_purge($1, $2, $3)', [
        claim.request_id,
        claim.claim_token,
        errorCode,
      ]);
    }
  }
  return result;
}
