import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { messageIdOf } from '../index.ts';
import { remarkRows, remarkedContext } from '../projections/remark-rows.ts';
import { refoldedRowsBehaviour } from './refolded-rows-behaviour.ts';
import {
  alpha,
  erasedAt,
  erasedContext,
  erasing,
  made,
  refusalOf,
  remarked,
  remarks,
  remarksIn,
  rowsOf,
  scrubbed,
  type FactScrubEntry,
} from './scrub-parts.ts';

function scrubbedInPlace(entry: FactScrubEntry): void {
  describe('a fact scrubbed in place', () => {
    it('holds the scrubbed data from then on, at its position, with its type and context, and the erasure at the head', async () => {
      const ledger = await entry.aLedger([]);
      await remarked(ledger, remarks, made('call me on 0123'), made('kept'));

      const outcome = await scrubbed(ledger, remarks, 1);

      expect(outcome).toEqual(Result.succeed({ version: 3 }));
      expect(await remarksIn(ledger, remarks)).toEqual({
        state: [
          { type: 'remark_made', data: { text: '' }, context: remarkedContext },
          { type: 'remark_made', data: { text: 'kept' }, context: remarkedContext },
          { type: 'remark_erased', data: { position: 1 }, context: erasedContext },
        ],
        version: 3,
      });
    });

    it('is read whole as it was recorded but for its data', async () => {
      const ledger = await entry.aLedger([]);
      await remarked(ledger, remarks, made('call me on 0123'));
      const before = await Effect.runPromise(ledger.readRecordedEvent(alpha, messageIdOf(remarks, 1)));

      await scrubbed(ledger, remarks, 1);

      expect(await Effect.runPromise(ledger.readRecordedEvent(alpha, messageIdOf(remarks, 1)))).toEqual({
        ...before,
        data: { text: '' },
      });
    });
  });
}

function scrubbedAside(entry: FactScrubEntry): void {
  describe('a fact scrubbed in place, of a stream no projection folds or with a lineage', () => {
    it('is of a stream no projection folds, and changes no row', async () => {
      const ledger = await entry.aLedger([remarkRows]);
      const unkeyed = 'playbook/acme/alpha/remarks';
      await remarked(ledger, unkeyed, made('call me on 0123'));
      await remarked(ledger, remarks, made('kept'));

      await scrubbed(ledger, unkeyed, 1);

      expect((await remarksIn(ledger, unkeyed)).state.map(({ data }) => data)).toEqual([{ text: '' }, { position: 1 }]);
      expect((await rowsOf(ledger, 'remarks', alpha)).map(({ row }) => row['text'])).toEqual(['kept']);
    });

    it('keeps of the data it is given the shape of the fact alone, so nothing given beside it is stored', async () => {
      const ledger = await entry.aLedger([remarkRows]);
      await remarked(ledger, remarks, made('call me on 0123'));

      await scrubbed(ledger, remarks, 1, erasing(1, { text: '', kept: 'call me on 0123' }));

      expect(await Effect.runPromise(ledger.readRecordedEvent(alpha, messageIdOf(remarks, 1)))).toEqual(
        expect.objectContaining({ data: { text: '' } }),
      );
      expect((await rowsOf(ledger, 'remarks', alpha)).map(({ row }) => row['text'])).toEqual(['']);
    });

    it('appends the erasure with the lineage it is given', async () => {
      const ledger = await entry.aLedger([]);
      await remarked(ledger, remarks, made('call me on 0123'));
      const lineage = { causationId: 'request-1', correlationId: null };

      await scrubbed(ledger, remarks, 1, { ...erasedAt(1), lineage });

      expect(await Effect.runPromise(ledger.readRecordedEvent(alpha, messageIdOf(remarks, 2)))).toMatchObject({
        type: 'remark_erased',
        causationId: 'request-1',
        correlationId: null,
      });
    });
  });
}

function scrubRefused(entry: FactScrubEntry): void {
  describe('a scrub the ledger refuses', () => {
    it('names the stream that holds nothing, the position that is not the stream’s and data that is not of the fact’s shape, and changes nothing', async () => {
      const ledger = await entry.aLedger([remarkRows]);
      await remarked(ledger, remarks, made('call me on 0123'));

      const refusals = [
        await refusalOf(ledger, 'playbook/acme/alpha/remarks/r2', 1),
        await refusalOf(ledger, remarks, 0),
        await refusalOf(ledger, remarks, 2),
        await refusalOf(ledger, remarks, 1.5),
        await refusalOf(ledger, remarks, 1, erasing(1, { text: 7 })),
        await refusalOf(ledger, remarks, 1, erasing(1, { position: 1 })),
      ];

      expect(refusals).toEqual([
        'no_stream',
        'not_its_position',
        'not_its_position',
        'not_its_position',
        'not_its_shape',
        'not_its_shape',
      ]);
      expect((await remarksIn(ledger, remarks)).state.map(({ data }) => data)).toEqual([{ text: 'call me on 0123' }]);
      expect((await rowsOf(ledger, 'remarks', alpha)).map(({ row }) => row['text'])).toEqual(['call me on 0123']);
    });
  });
}

export function factScrubBehaviour(entry: FactScrubEntry): void {
  scrubbedInPlace(entry);
  scrubbedAside(entry);
  scrubRefused(entry);
  refoldedRowsBehaviour(entry);
}
