import { sha256Of } from '@on.auto/content';
import { PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { PayloadOffloading, textBytesOf } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { watchedStore } from '../testing/kept-payloads.ts';
import { longerThanAFactHolds } from '../testing/saved-definitions.ts';
import { textRead, textsByDigestOf, textsWritten, TextsInHand } from './kept-texts.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const long = longerThanAFactHolds('A document longer than a fact holds.');

const kept = { sha256: sha256Of(long), bytes: textBytesOf(long) };

describe('the texts of a definition written for its fact', () => {
  it('keep a text written twice, as its document and its overview, once, under one digest', async () => {
    const watched = watchedStore();
    const { service } = memoryLedger(undefined, [], undefined, watched.store);
    const written = await Effect.runPromise(
      textsWritten({ source: long, overview: long, diagram: 'none' }).pipe(
        Effect.provideContext(playbookLedgerOf(service, alpha)),
        Effect.provideService(PlaybookContext, alpha),
        Effect.provideService(PayloadOffloading, true),
      ),
    );

    expect(written).toEqual({
      texts: { source: { kept }, overview: { kept }, diagram: { inline: 'none' } },
      inHand: new Map([[kept.sha256, long]]),
    });
  });

  it('are named by digest, for those kept outside the fact, beside the texts read', () => {
    expect(
      textsByDigestOf(
        { source: { kept }, overview: { inline: 'An overview' } },
        { source: long, overview: 'An overview' },
      ),
    ).toEqual(new Map([[kept.sha256, long]]));
  });
});

describe('a text of a definition read', () => {
  it('is the one in hand where its digest is, with no read of the store', async () => {
    const watched = watchedStore();
    const { service } = memoryLedger(undefined, [], undefined, watched.store);

    expect(
      await Effect.runPromise(
        textRead('overview', { kept }).pipe(
          Effect.provideService(TextsInHand, new Map([[kept.sha256, long]])),
          Effect.provideContext(playbookLedgerOf(service, alpha)),
          Effect.provideService(PlaybookContext, alpha),
        ),
      ),
    ).toBe(long);
    expect(watched.reads()).toBe(0);
  });
});
