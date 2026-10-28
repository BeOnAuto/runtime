import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { AdmissionAuthority, AuthorityAnswer } from '../admission/authority.ts';
import { meterOver } from '../admission/ledger-meter.ts';
import { meterDefaults } from '../admission/metering.ts';
import type { Fault } from '../meter-stream/meter-events.ts';
import { sqliteLedger, tamperingOn } from '../testing/ledgers.ts';
import { meterRuntimeOn } from '../testing/meter-runtime.ts';
import { answerOf, runOf, runStreamOf, starts } from '../testing/runs.ts';
import { testSigners } from '../testing/test-signing.ts';

export const playbookObject = 'cloud/acme/alpha';

export interface Asked {
  readonly authority: AdmissionAuthority;
  readonly asked: () => readonly string[];
  readonly faults: () => readonly Fault[];
}

type Repairing = () => ReturnType<AdmissionAuthority['repairFor']>;

const noRepair: Repairing = () => Promise.resolve(null);

export function authorityAnswering(answer: () => Promise<AuthorityAnswer>, repair: Repairing = noRepair): Asked {
  const asked: string[] = [];
  const faults: Fault[] = [];
  return {
    authority: {
      installation: playbookObject,
      admit: (_run, action) => {
        asked.push(action);
        return answer();
      },
      repairFor: (fault) => {
        faults.push(fault);
        return repair();
      },
    },
    asked: () => [...asked],
    faults: () => [...faults],
  };
}

export const admitting = () => Promise.resolve<AuthorityAnswer>({ admitted: true });

export async function cloudMetered({ authority }: Asked) {
  const at = sqliteLedger();
  onTestFinished(() => at.remove());
  const runtime = meterRuntimeOn(at);
  onTestFinished(() => runtime.dispose());
  const meter = await runtime.timed(
    Effect.flatMap(runtime.ledgered, (ledgered) => meterOver(ledgered, meterDefaults, authority, testSigners)),
  );
  return {
    ...runtime,
    tampering: tamperingOn(at),
    admitted: (run: string) => runtime.timed(answerOf(meter.admit(runOf(run)), 'admitted')),
    started: (run: string) => runtime.onTheLedger((ledger) => ledger.execute(runStreamOf(run), starts, null)),
  };
}

export async function faultedOver(asking: Asked) {
  const metered = await cloudMetered(asking);
  await metered.admitted('run-1');
  await metered.started('run-1');
  await metered.admitted('run-2');
  await metered.tampering.deleted(String((await metered.state()).checkpoint?.last));
  return metered;
}
