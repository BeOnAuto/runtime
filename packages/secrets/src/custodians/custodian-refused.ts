import { Data } from 'effect';

export type CustodianAct = 'wrap' | 'unwrap';

export class CustodianRefused extends Data.TaggedError('custodian_refused')<{
  readonly kid: string;
  readonly detail: string;
}> {}

export function custodianRefused(kid: string, act: CustodianAct, words: string): CustodianRefused {
  return new CustodianRefused({
    kid,
    detail: `The custodian of the key ${kid} refused to ${act} a data key: ${words}`,
  });
}
