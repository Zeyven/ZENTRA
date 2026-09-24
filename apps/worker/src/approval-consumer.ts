import type { ToolGatewayDependencies } from '@ayra/tool-gateway';
import type { Pool } from 'pg';

type ApprovalConsumer = ToolGatewayDependencies['approval'];

/** Requires a canonical Run Identity resolver upstream; never accepts Agent-supplied actor IDs. */
export function createApprovalConsumer(pool: Pool): ApprovalConsumer {
  return {
    async consume(binding) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
          binding.runOwnerId,
        ]);
        const result = await client.query<{ outcome: string }>(
          `SELECT ayra.consume_approval($1, $2, $3, $4, $5, $6) AS outcome`,
          [
            binding.approvalId,
            binding.runId,
            binding.action,
            binding.resourceRef,
            binding.argumentsHash,
            binding.stateVersion,
          ],
        );
        const outcome = result.rows[0]?.outcome;
        if (outcome !== 'CONSUMED' && outcome !== 'INVALID')
          throw new Error('Unknown Approval consumption outcome');
        await client.query('COMMIT');
        return outcome === 'CONSUMED';
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
