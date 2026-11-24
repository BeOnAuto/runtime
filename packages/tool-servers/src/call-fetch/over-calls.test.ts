import { CallFetch, CallSubjectTokens, type FetchOfACall, type SubjectTokensOfACall } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { overCalls } from './over-calls.ts';

function unsent(): FetchOfACall {
  return () => Promise.reject(new Error('Nothing is sent in this test'));
}

function aSigner(): SubjectTokensOfACall {
  return { signedFor: ({ org }) => Promise.resolve(`signed-for-${org}`) };
}

function boundBy(ofTheCall: Effect.Effect<string>, fetch?: FetchOfACall, signer?: SubjectTokensOfACall): string {
  const fetched = fetch === undefined ? ofTheCall : ofTheCall.pipe(Effect.provideService(CallFetch, fetch));
  const signed = signer === undefined ? fetched : fetched.pipe(Effect.provideService(CallSubjectTokens, signer));
  return Effect.runSync(signed);
}

describe('what an access is made over, by the fetch and the subject tokens a call binds', () => {
  it('is the access its own where the call binds neither, and is made once for each fetch and signer a call binds, with the composed signer where it binds a fetch alone and the composed fetch where it binds a signer alone', () => {
    const [ownFetch, lent, another] = [unsent(), unsent(), unsent()];
    const [composed, signer, otherSigner] = [aSigner(), aSigner(), aSigner()];
    const names = new Map<unknown, string>([
      [ownFetch, 'own fetch'],
      [lent, 'lent fetch'],
      [another, 'another fetch'],
      [composed, 'composed signer'],
      [signer, 'call signer'],
      [otherSigner, 'other signer'],
    ]);
    const made: string[] = [];
    const ofTheCall = overCalls({ fetch: ownFetch, subjectTokens: composed, made: 'own' }, (bound) => {
      made.push(`${String(names.get(bound.fetch))} and ${String(names.get(bound.subjectTokens))}`);
      return `made ${made.length}`;
    });

    const answers = [
      boundBy(ofTheCall),
      boundBy(ofTheCall, lent),
      boundBy(ofTheCall, lent),
      boundBy(ofTheCall, undefined, signer),
      boundBy(ofTheCall, lent, signer),
      boundBy(ofTheCall, lent, signer),
      boundBy(ofTheCall, lent, otherSigner),
      boundBy(ofTheCall, another, signer),
      boundBy(ofTheCall, ownFetch),
    ];

    expect(answers).toEqual(['own', 'made 1', 'made 1', 'made 2', 'made 3', 'made 3', 'made 4', 'made 5', 'own']);
    expect(made).toEqual([
      'lent fetch and composed signer',
      'own fetch and call signer',
      'lent fetch and call signer',
      'lent fetch and other signer',
      'another fetch and call signer',
    ]);
  });
});
