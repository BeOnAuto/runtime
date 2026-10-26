import type { Run, SettleRun } from '@on.auto/definitions';
import { NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

const settledRun: Run = {
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  type: 'workflow',
  name: 'flow',
  definition_version: 1,
  status: 'succeeded',
  output: 'done',
  started_at: '2026-10-01T09:00:00.000Z',
  started_by: { id: 'acme-admin', name: 'acme-admin' },
  finished_at: '2026-10-01T09:00:01.000Z',
};

export function knownRuns(): { readonly settle: SettleRun; readonly know: (id: string) => void } {
  const known = new Set<string>();
  return {
    settle: ({ id }) =>
      known.has(id)
        ? Effect.succeed(settledRun)
        : Effect.fail(new NotFound({ detail: 'There is no such run in this playbook' })),
    know: (id) => {
      known.add(id);
    },
  };
}
