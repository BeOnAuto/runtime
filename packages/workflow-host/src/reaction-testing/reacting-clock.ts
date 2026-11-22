import { deliverySweeps } from '../follower/consumers.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';
import { at } from './playbook-writes.ts';

export { fewSweeps, steppedBy, type SteppedSweeps } from '../testing/stepped-clock.ts';
export { steppedMovedClock, type SteppedMovedClock } from './moved-clock.ts';

/** The moment the clock of a reacting host starts at, unless the test gives a clock: a second after the activation. */
export const reactingStartsAt = Date.parse(at) + 1000;

/** The sweeps a held record takes before the follower passes it, and a few more for what follows. */
export const pastTheDeliverySweeps = { atMost: deliverySweeps + fewSweeps.atMost };
