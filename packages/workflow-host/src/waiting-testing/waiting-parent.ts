import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { waitingCallsOf } from '../calls/call-rows.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import type { HostedOptions } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { followedHost, type FollowedHost } from './followed-host.ts';

export const parentId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const parentRun = `acme/alpha/${parentId}`;

const States = Schema.Array(Schema.Struct({ state: Schema.String, delivered: Schema.Number }));

interface CallState {
  readonly state: string;
  readonly delivered: number;
}

export interface WaitingParent extends FollowedHost {
  readonly callStates: () => Promise<readonly CallState[]>;
  readonly answeredCalls: () => Promise<readonly CallState[]>;
}

export async function waitingParent(child: string, options: HostedOptions = {}): Promise<WaitingParent> {
  const followed = await followedHost({ ...options, answer: () => Effect.succeed({ status: 'waiting', child }) });
  const { database, hosted } = followed;
  hosted.know(parentId);
  await Effect.runPromise(
    hosted.host.start(runAt(parentId), startOf(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'))),
  );
  await until(
    () => Effect.runPromise(waitingCallsOf(database, parentRun)),
    (waiting) => waiting.length === 1,
  );
  const callStates = async () =>
    Schema.decodeUnknownSync(States)(
      await Effect.runPromise(database.read(statement`SELECT state, delivered FROM workflow_calls`)),
    );
  return {
    ...followed,
    callStates,
    answeredCalls: () => until(callStates, (states) => states.every(({ delivered }) => delivered === 1)),
  };
}
