import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { waitingCallsOf } from '../calls/call-rows.ts';
import { runOfTheTestsStarted } from '../reaction-testing/playbook-writes.ts';
import { runKeyOf } from '../runs/run-address.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import type { SteppedHostedOptions } from '../testing/host-runs.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';
import { followedHost, type FollowedHost } from './followed-host.ts';

export const parentId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const parentRun = runKeyOf(runAt(parentId));

const States = Schema.Array(Schema.Struct({ state: Schema.String, delivered: Schema.Number }));

interface CallState {
  readonly state: string;
  readonly delivered: number;
}

export interface WaitingParent extends FollowedHost {
  readonly callStates: () => Promise<readonly CallState[]>;
  readonly answeredCalls: () => Promise<readonly CallState[]>;
}

export async function waitingParent(child: string, options: SteppedHostedOptions = {}): Promise<WaitingParent> {
  const followed = await followedHost({ ...options, answer: () => Effect.succeed({ status: 'waiting', child }) });
  const { database, hosted } = followed;
  hosted.know(parentId);
  await runOfTheTestsStarted(database.store, parentId);
  await Effect.runPromise(
    hosted.host.start(runAt(parentId), startOf(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'))),
  );
  await hosted.sweeps.until(
    () => Effect.runPromise(waitingCallsOf(database, parentRun)),
    (waiting) => waiting.length === 1,
    fewSweeps,
  );
  const callStates = async () =>
    Schema.decodeUnknownSync(States)(
      await Effect.runPromise(database.read(statement`SELECT state, delivered FROM workflow_calls`)),
    );
  return {
    ...followed,
    callStates,
    answeredCalls: () =>
      hosted.sweeps.until(callStates, (states) => states.every(({ delivered }) => delivered === 1), fewSweeps),
  };
}
