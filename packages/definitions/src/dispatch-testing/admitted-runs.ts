import type { PlaybookRequest } from '@on.auto/operations';
import { Effect } from 'effect';

import {
  RunAdmission,
  type Capability,
  type PlaybookOperation,
  type PreparedDefinition,
  type RunDispatch,
} from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

export const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
export const source = '{"greeting":"Hello"}';
export const toAlpha = toPlaybook('acme', 'alpha');
export const asked = { type: 'echo', name: 'greet', run_id: runId, input: { name: 'Ada' } };

export async function admittedRuns(admission: RunAdmission['Service'], capability: Capability = echo) {
  const definitions = harness();
  const operations = definitionOperationsFor([capability]);
  await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source }));
  const call = (operation: PlaybookOperation, request: PlaybookRequest) =>
    definitions.run(definitions.dispatch(operation, request).pipe(Effect.provideService(RunAdmission, admission)));
  return { definitions, operations, call, running: () => call(operations.runDefinition, toAlpha(acmeAdmin, asked)) };
}

export function recordedAdmission() {
  const seen: RunDispatch[] = [];
  const service: RunAdmission['Service'] = {
    dispatch: (run) =>
      Effect.sync(() => {
        seen.push(run);
      }),
  };
  return { seen, service };
}

export const repeatedAdmission: Capability = {
  ...echo,
  prepare: (document, stripped) =>
    Effect.gen(function* () {
      const prepared = yield* echo.prepare(document, stripped);
      const guarded: PreparedDefinition = {
        ...prepared,
        run: (input, context) =>
          prepared.run(input, {
            ...context,
            beforeDispatch: () => Effect.andThen(context.beforeDispatch(), context.beforeDispatch()),
          }),
      };
      return guarded;
    }),
};
