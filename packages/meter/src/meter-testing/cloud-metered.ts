import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { AdmissionAuthority, AuthorityAnswer } from '../admission/authority.ts';
import { meterOver } from '../admission/ledger-meter.ts';
import { sqliteLedger, tamperingOn } from '../testing/ledgers.ts';
import { meterRuntimeOn } from '../testing/meter-runtime.ts';
import { answerOf, runOf, runStreamOf, starts } from '../testing/runs.ts';

export interface Asked {
  readonly authority: AdmissionAuthority;
  readonly asked: () => readonly string[];
}

export function authorityAnswering(answer: () => Promise<AuthorityAnswer>): Asked {
  const asked: string[] = [];
  return {
    authority: {
      admit: (_run, action) => {
        asked.push(action);
        return answer();
      },
    },
    asked: () => [...asked],
  };
}

export const admitting = () => Promise.resolve<AuthorityAnswer>({ admitted: true });

export async function cloudMetered({ authority }: Asked) {
  const at = sqliteLedger();
  onTestFinished(() => at.remove());
  const runtime = meterRuntimeOn(at);
  onTestFinished(() => runtime.dispose());
  const meter = await runtime.timed(Effect.map(runtime.ledgered, (ledgered) => meterOver(ledgered, authority)));
  return {
    ...runtime,
    tampering: tamperingOn(at),
    admitted: (run: string) => runtime.timed(answerOf(meter.admit(runOf(run)), 'admitted')),
    started: (run: string) => runtime.onTheLedger((ledger) => ledger.execute(runStreamOf(run), starts, null)),
  };
}
