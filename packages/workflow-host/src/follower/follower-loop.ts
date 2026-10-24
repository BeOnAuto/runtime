import type { HostClock } from '../loop/host-clock.ts';
import { startListeningLoop } from '../loop/host-loop.ts';
import { followerWakeUpOf, type FollowerWork } from './follower-wake-up.ts';

export interface FollowerParts extends FollowerWork {
  readonly pace: HostClock;
}

export interface Follower {
  readonly stop: () => Promise<void>;
}

export function startFollower(parts: FollowerParts): Follower {
  return startListeningLoop(parts, (signal) => followerWakeUpOf(parts, signal));
}
