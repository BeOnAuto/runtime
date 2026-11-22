import { Effect, Layer } from 'effect';

import type { CompositionParts } from '../../composition/composition-root.ts';
import { loggedModelAccess, type ModelAccessOf } from '../../composition/served-reasoning.ts';
import type { ComposedServerOptions } from '../../server-options/composed-options.ts';
import { heardFrom, sleepsTold } from '../waiting/happenings.ts';
import { steppedServerClock, type SteppedServerClock } from '../waiting/stepped-server-clock.ts';
import { statementsInHand, workInHand } from '../waiting/work-in-hand.ts';
import { compositionOfATestServer } from './prepared-parts.ts';
import { composedOnTheClock, composedWithTheLedgerOver, type ServedParts } from './served-parts.ts';
import { servingAlso, toldOf, type ToldComposition } from './told-composition.ts';

export { patientThreadPool } from './worker-pools.ts';

export interface TestCompositionParts extends Omit<CompositionParts, 'clock'> {
  /** The models the server reaches, the shipped access unless given. */
  readonly modelAccessOf?: ModelAccessOf;
  /** Ports the server is served beside what it composes, as a later composition gives them. */
  readonly servedAlso?: Parameters<typeof servingAlso>[1];
  /**
   * Why the server runs on the system's clock in place of a stepped one. Time a test does not step is a wait on the real
   * clock, so only what is itself the subject (a clock of a process's own, say) is a reason; convenience is not.
   */
  readonly onTheSystemClockBecause?: string;
  readonly preparingItself?: ServedParts['preparingItself'];
}

/** The shipped composition, told to the waiting tests, with the stepped clock it runs on unless its test said why not. */
export interface TestComposition extends ComposedServerOptions {
  readonly clock: SteppedServerClock | undefined;
  readonly answered: ToldComposition['answered'];
  readonly arrived: ToldComposition['arrived'];
}

/**
 * Hears from each server composed so until its services close, as it stops: at rest once its host sleeps on the stepped
 * clock, every fiber, with no request in hand.
 */
function heardWhileServing(told: ToldComposition, clock: SteppedServerClock): ComposedServerOptions {
  const busy = (): boolean => told.arrived().length > told.answered().length;
  const counted = composedOnTheClock(
    composedWithTheLedgerOver(told.composed, (ledger) => statementsInHand(clock.inHand, ledger)),
    clock.now,
  );
  return {
    ...counted,
    composed: async (settings, telemetry, shippedFiles) => {
      const composed = await counted.composed(settings, telemetry, shippedFiles);
      const heard = Layer.effectDiscard(
        Effect.acquireRelease(
          Effect.sync(() => heardFrom({ atRest: clock.atRest, busy })),
          (unheard) => Effect.sync(unheard),
        ),
      );
      return { ...composed, services: Layer.merge(composed.services, heard) };
    },
  };
}

/**
 * TIME MOVES ONLY WHEN THE TEST MOVES IT, IN STEPS THE TEST NAMES.
 *
 * The server as it ships, goals and their results included unless the parts say otherwise, for a test that starts it
 * with `startServer`: its host sleeps on a stepped clock of its own, which moves only when the test moves it or steps
 * its sweeps, and each append, request and sleep is told to the waiting tests. A test that needs the system's clock
 * says why in `onTheSystemClockBecause`.
 */
export function testComposition({
  modelAccessOf = loggedModelAccess,
  onTheSystemClockBecause,
  goals = true,
  goalsResults = true,
  preparingItself,
  servedAlso,
  ...parts
}: TestCompositionParts = {}): TestComposition {
  const clock = onTheSystemClockBecause === undefined ? steppedServerClock() : undefined;
  const composition = compositionOfATestServer(
    modelAccessOf,
    { goals, goalsResults, ...parts, ...(clock === undefined ? {} : { clock: sleepsTold(clock) }) },
    preparingItself,
  );
  const served = servedAlso === undefined ? composition : servingAlso(composition, servedAlso);
  const told = toldOf(served, clock === undefined ? workInHand() : clock.inHand);
  return {
    ...(clock === undefined ? told.composed : heardWhileServing(told, clock)),
    clock,
    answered: told.answered,
    arrived: told.arrived,
  };
}
