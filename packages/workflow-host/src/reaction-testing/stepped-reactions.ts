import { fewSweeps, type SteppedSweeps } from '../testing/stepped-clock.ts';

export { fewSweeps };
import { triggerRowsOf } from './kept-triggers.ts';
import { steppedMovedClock, type SteppedMovedClock } from './moved-clock.ts';
import { definitionRecorded } from './playbook-writes.ts';
import { reactingStartsAt } from './reacting-clock.ts';
import { reactingHost, type ReactingHost, type ReactingOptions } from './reacting-host.ts';

export interface SteppedReacting {
  readonly reacting: ReactingHost;
  readonly clock: SteppedMovedClock;
  readonly sweeps: SteppedSweeps;
}

export interface SteppedOptions extends Omit<ReactingOptions, 'clock'> {
  /** The moment the clock starts at, a second after the activation unless the test names another. */
  readonly startsAt?: number;
  /** The clock of a host before this one, for a host opened again on the same time. */
  readonly clock?: SteppedMovedClock;
}

/** A reacting host on a moved clock where time moves only when the test moves it. */
export async function steppedReacting({
  startsAt,
  clock: given,
  ...options
}: SteppedOptions = {}): Promise<SteppedReacting> {
  const clock = given ?? steppedMovedClock(startsAt ?? reactingStartsAt);
  const reacting = await reactingHost({ ...options, clock });
  return { reacting, clock, sweeps: reacting.sweeps };
}

/** The definition recorded, and the host stepped sweep by sweep until it keeps the definition's triggers. */
export async function keptDefinition(
  { reacting, sweeps }: SteppedReacting,
  definition: Parameters<typeof definitionRecorded>[1],
): Promise<void> {
  await definitionRecorded(reacting.database.store, definition);
  await sweeps.until(
    () => triggerRowsOf(reacting.database),
    (rows) => rows.some(({ workflow, version }) => workflow === definition.name && version === definition.version),
    fewSweeps,
  );
}
