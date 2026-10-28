import { Effect, Option } from 'effect';

import { executed, meterStateOf, nowIso, read, type Metering } from '../admission/metering.ts';
import { countedFromTheStart } from '../counting/run-starts.ts';
import { repairIn, type Repair, type Signed, type Signers } from './signed-answers.ts';

interface Repairing extends Metering {
  readonly signers: Signers;
}

function recorded(metering: Repairing, repair: Repair, signed: Signed): Effect.Effect<void> {
  return Effect.ignore(
    Effect.gen(function* () {
      const state = yield* meterStateOf(metering);
      if (state.repairs.includes(repair.id)) return;
      const counting = yield* read(metering, () => countedFromTheStart(metering.log));
      const { id, reason, issued_at: issuedAt } = repair;
      const at = yield* nowIso;
      yield* executed(metering, { type: 'repair', id, reason, issued_at: issuedAt, repair: signed, counting, at });
      yield* Effect.logInfo(`Auto repaired the meter, which counted its ledger again from the first event: ${reason}`);
    }),
  );
}

export function repairedBy(metering: Repairing, signed: Signed | null, installation: string): Effect.Effect<void> {
  if (signed === null) {
    return Effect.void;
  }
  return Option.match(
    Option.filter(repairIn(signed, metering.signers), (repair) => repair.installation === installation),
    {
      onNone: () => Effect.logWarning('The meter ignored a repair that Auto did not sign for this installation'),
      onSome: (repair) => recorded(metering, repair, signed),
    },
  );
}
