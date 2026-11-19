import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { messageIdOf, type FactScrub, type LedgerPorts } from '../index.ts';
import { placedIn } from '../projections-testing/definition-rows-behaviour.ts';
import { labelFacts, labelRows, LabelFactSchema } from '../projections/label-rows.ts';
import { remarkRows } from '../projections/remark-rows.ts';
import { topicFacts, topicRows, topicWaitMs, type TopicFact } from '../projections/topic-rows.ts';
import { runFacts, runTallies, type RunFact } from '../run-outcomes/run-tallies.ts';
import {
  acme,
  alpha,
  erasedContext,
  made,
  remarked,
  remarks,
  rowsOf,
  scrubbed,
  type FactScrubEntry,
} from './scrub-parts.ts';

function rowsOfAStreamRefolded(entry: FactScrubEntry): void {
  describe('the row of a projection keyed by its stream that a scrubbed fact folded into', () => {
    it('is folded again from the facts of its stream, the scrubbed data and the erasure among them', async () => {
      const ledger = await entry.aLedger([remarkRows]);
      const untouched = 'playbook/acme/alpha/remarks/r2';
      await remarked(ledger, remarks, made('first'), made('call me on 0123'));
      await remarked(ledger, untouched, made('untouched'));

      await scrubbed(ledger, remarks, 2);

      expect((await rowsOf(ledger, 'remarks', alpha)).map(({ key, row }) => [key, row])).toEqual([
        ['r1', { text: '', remarks: 2, erasures: 1, last_message: messageIdOf(remarks, 3) }],
        ['r2', { text: 'untouched', remarks: 1, erasures: 0, last_message: messageIdOf(untouched, 1) }],
      ]);
    });

    it('is folded again for a stream of an org', async () => {
      const ledger = await entry.aLedger([remarkRows]);
      const ofAcme = 'org/acme/remarks/r1';
      await remarked(ledger, ofAcme, made('write to me at home'));

      await scrubbed(ledger, ofAcme, 1);

      expect(await rowsOf(ledger, 'remarks', acme)).toEqual([
        { org: 'acme', key: 'r1', row: { text: '', remarks: 1, erasures: 1, last_message: messageIdOf(ofAcme, 2) } },
      ]);
    });
  });
}

type RecordedTopic = typeof topicFacts.eventSchema.Type;

function topics(ledger: LedgerPorts, stream: string, ...facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, topicFacts, facts));
}

function topicErasing(data: Schema.JsonObject): FactScrub<RecordedTopic> {
  return {
    eventSchema: topicFacts.eventSchema,
    data,
    erasure: { type: 'topic_noted', data: { topic: 'erased', note: 'a note was erased' } },
    context: erasedContext,
  };
}

function scrubbedTopic(ledger: LedgerPorts, stream: string, data: Schema.JsonObject): Promise<unknown> {
  return Effect.runPromise(ledger.scrubFact(stream, 1, topicErasing(data)));
}

const opened: TopicFact = { type: 'topic_opened', data: { topic: 'spring', at: 0 } };

function noted(note: string): TopicFact {
  return { type: 'topic_noted', data: { topic: 'spring', note } };
}

function rowsOfAKeyRefolded(entry: FactScrubEntry): void {
  describe('the rows of a projection keyed by its mapping that a scrubbed fact folded into', () => {
    it('are folded again in the order their facts were appended, leaving the columns its reader advanced as they stand', async () => {
      const ledger = await entry.aLedger([topicRows]);
      await topics(ledger, 'playbook/acme/alpha/runs/r1', opened);
      await topics(ledger, 'playbook/acme/alpha/notes/n1', noted('call me on 0123'));
      await Effect.runPromise(
        ledger.advanceRow('topics', alpha, 'spring', { set: { open: false, due_at: null }, when: [] }),
      );

      await scrubbedTopic(ledger, 'playbook/acme/alpha/notes/n1', { topic: 'spring', note: 'a note was erased' });

      expect((await rowsOf(ledger, 'topics', alpha)).map(({ key, row }) => [key, row])).toEqual([
        [
          'spring',
          {
            topic: 'spring',
            note: 'a note was erased',
            last_message: messageIdOf('playbook/acme/alpha/notes/n1', 1),
            open: false,
            next_at: topicWaitMs,
            due_at: null,
          },
        ],
      ]);
    });

    it('folds the row of the key the fact had and the row of the key it has, and keeps none that folds to nothing', async () => {
      const ledger = await entry.aLedger([topicRows]);
      await topics(ledger, 'playbook/acme/alpha/runs/r1', opened);
      await topics(ledger, 'playbook/acme/alpha/notes/n1', noted('first'));

      await scrubbedTopic(ledger, 'playbook/acme/alpha/runs/r1', { topic: 'autumn', at: 0 });

      expect((await rowsOf(ledger, 'topics', alpha)).map(({ key, row }) => [key, row['note'], row['open']])).toEqual([
        ['autumn', null, true],
      ]);
    });
  });
}

function rowsOfAnOrgKeyRefolded(entry: FactScrubEntry): void {
  describe('the row of a projection keyed by its mapping over the streams of an org', () => {
    it('is folded again from the facts of the org alone', async () => {
      const ledger = await entry.aLedger([{ ...topicRows, scopes: ['playbook', 'org'] }]);
      await topics(ledger, 'org/acme/runs/r1', opened);
      await topics(ledger, 'org/acme/notes/n1', noted('call me on 0123'));
      await topics(ledger, 'playbook/acme/alpha/notes/n1', noted('of alpha'));

      await scrubbedTopic(ledger, 'org/acme/notes/n1', { topic: 'spring', note: 'a note was erased' });

      expect((await rowsOf(ledger, 'topics', acme)).map(({ key, row }) => [key, row['note'], row['open']])).toEqual([
        ['spring', 'a note was erased', true],
      ]);
    });
  });
}

function rowsOfADefinitionKeyRefolded(entry: FactScrubEntry): void {
  describe('the row of a projection keyed by its mapping over the streams of a definition', () => {
    it('is folded again from the facts of the definition alone', async () => {
      const ledger = await entry.aLedger([{ ...topicRows, scopes: ['definition'] }]);
      await placedIn(ledger, 'd1', 'alpha');
      await topics(ledger, 'definition/acme/d1/runs/r1', opened);
      await topics(ledger, 'definition/acme/d1/notes/n1', noted('call me on 0123'));
      await topics(ledger, 'definition/acme/d2/notes/n1', noted('of d2'));

      await scrubbedTopic(ledger, 'definition/acme/d1/notes/n1', { topic: 'spring', note: 'a note was erased' });

      expect((await rowsOf(ledger, 'topics', alpha)).map(({ key, row }) => [key, row['note'], row['open']])).toEqual([
        ['spring', 'a note was erased', true],
      ]);
    });
  });

  describe('the row of a projection that keeps its rows at the org of the streams it folds', () => {
    it("is folded again from the facts of every definition of the org, in the store's order, and of no other org", async () => {
      const ledger = await entry.aLedger([{ ...topicRows, scopes: ['definition'], partition: 'org' }]);
      await topics(ledger, 'definition/acme/d1/runs/r1', opened);
      await topics(ledger, 'definition/acme/d2/notes/n1', noted('call me on 0123'));
      await topics(ledger, 'definition/acme/d1/notes/n2', noted('of d1'));
      await topics(ledger, 'definition/umbrella/d3/notes/n3', noted('of umbrella'));

      await scrubbedTopic(ledger, 'definition/acme/d2/notes/n1', { topic: 'spring', note: 'a note was erased' });

      expect((await rowsOf(ledger, 'topics', acme)).map(({ key, row }) => [key, row['note'], row['open']])).toEqual([
        ['spring', 'of d1', true],
      ]);
    });
  });
}

function childRowsRefolded(entry: FactScrubEntry): void {
  describe('the rows of a key of a projection that keeps several under it, which a scrubbed fact folded into', () => {
    it('are folded again from nothing over the facts of the key, the rows the scrubbed fact no longer answers dropped', async () => {
      const ledger = await entry.aLedger([labelRows]);
      const notes = 'playbook/acme/alpha/notes/n1';
      await Effect.runPromise(
        ledger.execute(notes, labelFacts, [
          { type: 'labels_set', data: { note: 'n1', labels: ['urgent', 'call 0123'] } },
          { type: 'label_added', data: { note: 'n1', label: 'urgent' } },
        ]),
      );

      await Effect.runPromise(
        ledger.scrubFact(notes, 1, {
          eventSchema: LabelFactSchema,
          data: { note: 'n1', labels: ['urgent'] },
          erasure: { type: 'label_added', data: { note: 'n1', label: 'erased' } },
          context: erasedContext,
        }),
      );

      expect((await rowsOf(ledger, 'labels', alpha)).map(({ key, child, row }) => [key, child, row])).toEqual([
        ['n1', 'erased', { label: 'erased', place: 2, set_at: 3 }],
        ['n1', 'urgent', { label: 'urgent', place: 1, set_at: 1 }],
      ]);
    });
  });
}

function began(fn: string): RunFact {
  return { type: 'run_began', data: { at: '2026-10-05T09:00:00.000Z', fn } };
}

function runOutcomeRefolded(entry: FactScrubEntry): void {
  describe('the outcome of a run whose fact is scrubbed', () => {
    it('is folded again from the facts of the run', async () => {
      const ledger = await entry.aLedger([], runTallies);
      await placedIn(ledger, 'd1', 'alpha');
      const run = 'definition/acme/d1/runs/r1';
      await Effect.runPromise(ledger.execute(run, runFacts, [began('call me on 0123')]));

      await Effect.runPromise(
        ledger.scrubFact(run, 1, {
          eventSchema: runFacts.eventSchema,
          data: { at: '2026-10-06T09:00:00.000Z', fn: 'erased' },
          erasure: { type: 'run_noted', data: {} },
          context: erasedContext,
        }),
      );
      const outcomes = await Effect.runPromise(
        ledger.readRunOutcomes(alpha, { from: '2026-10-05', to: '2026-10-06' }, {}),
      );

      expect(outcomes.map(({ day, runs }) => [day, runs])).toEqual([['2026-10-06', 1]]);
    });
  });
}

export function refoldedRowsBehaviour(entry: FactScrubEntry): void {
  rowsOfAStreamRefolded(entry);
  rowsOfAKeyRefolded(entry);
  rowsOfAnOrgKeyRefolded(entry);
  rowsOfADefinitionKeyRefolded(entry);
  childRowsRefolded(entry);
  runOutcomeRefolded(entry);
}
