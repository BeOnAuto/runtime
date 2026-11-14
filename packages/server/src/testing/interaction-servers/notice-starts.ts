import type { Meter, MeteredRun } from '@on.auto/definitions';
import { chatDelivery } from '@on.auto/interaction/testing';
import type { FunctionStart, StartFunction, StartRefused, StartRejected } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { refusingMeter, type RefusingMeter } from '../accounts/refusing-meter.ts';
import { temporaryLedger, type TemporaryLedger } from '../records/temporary-ledger.ts';
import { alpha } from '../servers/reasoning-server.ts';
import { chatEnvironment, chatServer } from './chat-deliveries.ts';
import { servingInteractions, type InteractionServer } from './interaction-server.ts';

export const noticeRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const goalTrigger = { kind: 'goal', reference: 'goals/weekly-revenue/assessments/a-1' } as const;

export const notice: FunctionStart = {
  org: 'acme',
  playbook: 'alpha',
  type: 'interaction',
  name: 'brief-out',
  runId: noticeRunId,
  input: { campaign: 'Spring', owner: 'ada' },
  trigger: goalTrigger,
};

export interface NoticeServer {
  readonly server: InteractionServer;
  readonly chat: Awaited<ReturnType<typeof chatServer>>;
  readonly meter: RefusingMeter;
  readonly metered: () => readonly MeteredRun[];
  readonly start: (start: FunctionStart) => Promise<void>;
  readonly refusalOf: (start: FunctionStart) => Promise<StartRefused | StartRejected>;
  readonly runs: () => Promise<readonly string[]>;
  readonly ledger: TemporaryLedger;
}

const RunsSchema = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

const decodeRuns = Schema.decodeUnknownSync(RunsSchema);

function recordingMeter(over: Meter): { readonly meter: Meter; readonly metered: () => readonly MeteredRun[] } {
  const metered: MeteredRun[] = [];
  return {
    meter: {
      admit: (run) =>
        Effect.andThen(
          Effect.sync(() => metered.push(run)),
          over.admit(run),
        ),
    },
    metered: () => [...metered],
  };
}

export async function servingNotices(): Promise<NoticeServer> {
  const chat = await chatServer();
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const meter = refusingMeter();
  const recording = recordingMeter(meter.meter);
  const port = Promise.withResolvers<StartFunction>();
  const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url), {
    ledger,
    meter: recording.meter,
    startingWork: ({ start }) => {
      port.resolve(start);
      return Promise.resolve({ dueWork: [], consumers: [] });
    },
  });
  const start = await port.promise;
  return {
    server,
    chat,
    meter,
    metered: recording.metered,
    start: (asked) => Effect.runPromise(start(asked)),
    refusalOf: (asked) => Effect.runPromise(Effect.flip(start(asked))),
    runs: async () => decodeRuns((await server.call('GET', `${alpha}/runs`)).body).runs.map(({ run_id: id }) => id),
    ledger,
  };
}
