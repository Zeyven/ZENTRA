import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';

export const releaseProbeSignal = defineSignal<[string]>('releaseProbe');
export const probeStatusQuery = defineQuery<'WAITING' | 'RELEASED'>('probeStatus');

/** A test-only workflow that proves a Worker restart preserves workflow state. */
export async function durabilityProbeWorkflow(runId: string): Promise<{
  runId: string;
  token: string;
}> {
  let token: string | undefined;
  setHandler(releaseProbeSignal, (value) => {
    token = value;
  });
  setHandler(probeStatusQuery, () => (token === undefined ? 'WAITING' : 'RELEASED'));
  await condition(() => token !== undefined);
  return { runId, token: token! };
}
