import { StreamProjectionRefused } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Kept } from './guarded-builds.ts';

function loggedOne(kept: Kept): Effect.Effect<void> {
  if (kept.kept === 'refused') {
    return Effect.void;
  }
  if (kept.kept === 'disagreed') {
    return Effect.logError('The rows of a read model disagree with its facts after it was built again').pipe(
      Effect.annotateLogs({ read_model: kept.projection, playbook: kept.playbook }),
    );
  }
  if (kept.kept === 'built') {
    const { projection, stream, from, through, facts, bytes, pages, ms } = kept;
    return Effect.logInfo('A read model was brought up to date from its facts').pipe(
      Effect.annotateLogs({ read_model: projection, stream, from, through, facts, bytes, pages, ms }),
    );
  }
  const { projection, playbook, because } = kept;
  const said = 'The rows of a read model were reset, and are built again from its facts on its next read';
  return (because === 'asked' ? Effect.logInfo(said) : Effect.logWarning(said)).pipe(
    Effect.annotateLogs({ read_model: projection, playbook, because }),
  );
}

function disagreement(kept: readonly Kept[]): Effect.Effect<void> {
  const refused = kept.find((each) => each.kept === 'disagreed' || each.kept === 'refused');
  return refused === undefined
    ? Effect.void
    : Effect.die(new StreamProjectionRefused(refused.projection, refused.playbook));
}

export function keptLogged(kept: readonly Kept[]): Effect.Effect<void> {
  return Effect.forEach(kept, loggedOne, { discard: true }).pipe(Effect.andThen(disagreement(kept)));
}
