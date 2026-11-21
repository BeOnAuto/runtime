import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { AdmissionAuthority, AuthorityAnswer } from '../admission/authority.ts';
import { meterOver } from '../admission/ledger-meter.ts';
import type { LedgerAt } from '../testing/ledgers.ts';
import { memoryLedgerAt } from '../testing/memory-ledger.ts';
import { meterRuntimeOn } from '../testing/meter-runtime.ts';
import { answerOf, runOf, startedIn } from '../testing/runs.ts';

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

export async function cloudMetered({ authority }: Asked, at: LedgerAt = memoryLedgerAt()) {
  onTestFinished(() => at.remove());
  const runtime = meterRuntimeOn(at);
  onTestFinished(() => runtime.dispose());
  const meter = await runtime.timed(Effect.map(runtime.ledgered, (ledgered) => meterOver(ledgered, authority)));
  return {
    ...runtime,
    admitted: (run: string, playbook?: string) =>
      runtime.timed(answerOf(meter.admit(runOf(run, playbook)), 'admitted')),
    started: (run: string, playbook?: string) => runtime.onTheLedger((ledger) => startedIn(ledger, run, playbook)),
  };
}
