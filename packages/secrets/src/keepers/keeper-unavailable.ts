import { Data } from 'effect';

import type { CustodianAct } from '../custodians/custodian-refused.ts';

export class KeeperUnavailable extends Data.TaggedError('keeper_unavailable')<{
  readonly kid?: string | undefined;
  readonly detail: string;
}> {}

export function keeperUnavailable(seconds: number): KeeperUnavailable {
  return new KeeperUnavailable({
    detail: `The keeper of the secret, or the custodian of its key, did not answer within ${seconds} seconds`,
  });
}

export function custodianUnanswered(kid: string, act: CustodianAct, words: string): KeeperUnavailable {
  return new KeeperUnavailable({
    kid,
    detail: `The custodian of the key ${kid} did not answer a request to ${act} a data key: ${words}`,
  });
}
