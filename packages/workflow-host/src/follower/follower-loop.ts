import { startListeningLoop, type LoopParts } from '../loop/host-loop.ts';
import { followerWakeUpOf, type FollowerWork } from './follower-wake-up.ts';

/** The follower sleeps on the host's clock, unless a test gives it a pace of its own. */
export interface FollowerParts extends FollowerWork, Pick<LoopParts, 'pace'> {}

export interface Follower {
  readonly stop: () => Promise<void>;
}

/** The follower times its fallback sweep by the pace it is given, else by its clock. */
export function startFollower(parts: FollowerParts): Follower {
  return startListeningLoop({ ...parts, pace: parts.pace ?? parts.clock }, (signal) => followerWakeUpOf(parts, signal));
}
