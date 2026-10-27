import { Effect, Option } from 'effect';

import { executed, meterStateOf, nowIso, read } from '../admission/metering.ts';
import { countedFromTheStart } from '../counting/run-starts.ts';
import type { Licensing } from './licensing.ts';
import { repairIn, type Repair, type Signed } from './signed-answers.ts';

function recorded(licensing: Licensing, repair: Repair, signed: Signed): Effect.Effect<void> {
  return Effect.ignore(
    Effect.gen(function* () {
      const state = yield* meterStateOf(licensing);
      if (state.repairs.includes(repair.id)) return;
      const counting = yield* read(licensing, () => countedFromTheStart(licensing.log));
      const { id, reason, issued_at: issuedAt } = repair;
      const at = yield* nowIso;
      yield* executed(licensing, { type: 'repair', id, reason, issued_at: issuedAt, repair: signed, counting, at });
      yield* Effect.logInfo(`Auto repaired the meter, which counted its ledger again from the first event: ${reason}`);
    }),
  );
}

export function repairedBy(licensing: Licensing, signed: Signed | null, installation: string): Effect.Effect<void> {
  if (signed === null) {
    return Effect.void;
  }
  return Option.match(
    Option.filter(repairIn(signed, licensing.signers), (repair) => repair.installation === installation),
    {
      onNone: () => Effect.logWarning('The meter ignored a repair that Auto did not sign for this installation'),
      onSome: (repair) => recorded(licensing, repair, signed),
    },
  );
}
