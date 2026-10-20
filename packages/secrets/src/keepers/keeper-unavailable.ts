import { Data } from 'effect';

export class KeeperUnavailable extends Data.TaggedError('keeper_unavailable')<{
  readonly detail: string;
}> {}

export function keeperUnavailable(seconds: number): KeeperUnavailable {
  return new KeeperUnavailable({
    detail: `The keeper of the secret, or the custodian of its key, did not answer within ${seconds} seconds`,
  });
}
