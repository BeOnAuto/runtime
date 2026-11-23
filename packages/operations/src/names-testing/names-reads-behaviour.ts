import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HeldName } from '../definition-names/name-judgement.ts';
import { messageIdOf } from '../ledger/message-lineage.ts';
import { cursorOfParts } from '../reading/cursor-parts.ts';
import { answerOf, fact, made, shared, unbounded, type NamesAtThePortEntry } from './noted-names.ts';

type Held = Pick<HeldName, 'definitionType' | 'name' | 'status'> & { readonly hasTriggers?: boolean };

function heldName(definition: string, { hasTriggers = false, ...held }: Held): HeldName {
  return { definitionKey: `definition/acme/${definition}/`, playbookKey: 'playbook/acme/alpha/', hasTriggers, ...held };
}

function namesOfAPlaybook(entry: NamesAtThePortEntry): void {
  describe('the names of a playbook, read at the port', () => {
    it('answers the definition that holds a name of a type in a playbook, and the name a definition holds with its playbook', async () => {
      const port = await entry.keeping(unbounded);
      await answerOf(
        port,
        shared,
        made('a', 'triage'),
        made('b', 'triage', { type: 'workflow', starts: true }),
        made('c', 'old'),
      );
      await answerOf(port, shared, fact('set_aside', '-', { definition: 'c' }));

      const answers = await Effect.runPromise(
        Effect.all([
          port.ledger.holderOfName({ playbookKey: 'playbook/acme/alpha/', definitionType: 'workflow', name: 'triage' }),
          port.ledger.holderOfName({ playbookKey: 'playbook/acme/alpha/', definitionType: 'reasoning', name: 'old' }),
          port.ledger.nameHeldBy('definition/acme/a/'),
        ]),
      );

      expect(answers).toEqual([
        heldName('b', { definitionType: 'workflow', name: 'triage', status: 'active', hasTriggers: true }),
        heldName('c', { definitionType: 'reasoning', name: 'old', status: 'retired' }),
        heldName('a', { definitionType: 'reasoning', name: 'triage', status: 'active' }),
      ]);
    });

    it('answers no definition for a name none holds in that playbook and type, nor for a definition that holds no name', async () => {
      const port = await entry.keeping(unbounded);
      await answerOf(port, shared, made('a', 'triage'), made('b', 'brief'));
      await answerOf(port, shared, fact('forgotten', '-', { definition: 'b' }));

      const answers = await Effect.runPromise(
        Effect.all([
          port.ledger.holderOfName({ playbookKey: 'playbook/acme/beta/', definitionType: 'reasoning', name: 'triage' }),
          port.ledger.holderOfName({ playbookKey: 'playbook/acme/alpha/', definitionType: 'workflow', name: 'triage' }),
          port.ledger.holderOfName({ playbookKey: 'playbook/acme/alpha/', definitionType: 'reasoning', name: 'brief' }),
          port.ledger.nameHeldBy('definition/acme/b/'),
          port.ledger.nameHeldBy('definition/acme/z/'),
        ]),
      );

      expect(answers).toEqual([undefined, undefined, undefined, undefined, undefined]);
    });
  });
}

function namesOfAKind(entry: NamesAtThePortEntry): void {
  describe('the names of a kind, read at the port', () => {
    it('answers every name a playbook holds of a type, by the key of its definition, retired ones among them', async () => {
      const port = await entry.keeping(unbounded);
      await answerOf(
        port,
        shared,
        made('b', 'triage'),
        made('a', 'brief'),
        made('c', 'old'),
        made('d', 'flow', { type: 'workflow' }),
        made('e', 'triage', { playbook: 'beta' }),
      );
      await answerOf(port, shared, fact('set_aside', '-', { definition: 'c' }));

      const answers = await Effect.runPromise(
        Effect.all([
          port.ledger.namesHeldIn({ playbookKey: 'playbook/acme/alpha/', definitionType: 'reasoning' }),
          port.ledger.namesHeldIn({ playbookKey: 'playbook/acme/gamma/', definitionType: 'reasoning' }),
        ]),
      );

      expect(answers).toEqual([
        [
          heldName('a', { definitionType: 'reasoning', name: 'brief', status: 'active' }),
          heldName('b', { definitionType: 'reasoning', name: 'triage', status: 'active' }),
          heldName('c', { definitionType: 'reasoning', name: 'old', status: 'retired' }),
        ],
        [],
      ]);
    });
  });
}

const alpha = { org: 'acme', playbook: 'alpha' };

function factsOfAPlaybook(entry: NamesAtThePortEntry): void {
  describe("a playbook's reads of its facts, at the port", () => {
    it('cover the streams of the definitions that hold a name in it, in the order appended, and no other', async () => {
      const port = await entry.keeping(unbounded);
      await answerOf(port, 'playbook/acme/alpha/notes', fact('remarked', 'first'));
      await answerOf(port, 'definition/acme/a/notes', made('a', 'triage'));
      await answerOf(port, 'definition/acme/b/notes', made('b', 'brief', { playbook: 'beta' }));
      await answerOf(port, 'definition/acme/c/notes', fact('remarked', 'held by none'));

      const [recorded, appended, ofItsDefinition, ofAnother] = await Effect.runPromise(
        Effect.all([
          port.ledger.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 10 }),
          Effect.orDie(
            port.ledger.readAppendedFacts(
              { kind: 'playbook', playbook: alpha },
              { after: cursorOfParts([]), most: 10, dataOf: [] },
            ),
          ),
          port.ledger.readRecordedEvent(alpha, messageIdOf('definition/acme/a/notes', 1)),
          port.ledger.readRecordedEvent(alpha, messageIdOf('definition/acme/b/notes', 1)),
        ]),
      );

      const inOrder = ['playbook/acme/alpha/notes', 'definition/acme/a/notes'];
      expect([
        recorded.records.map(({ stream }) => stream),
        appended.facts.map(({ stream }) => stream),
        ofItsDefinition?.stream,
        ofAnother,
      ]).toEqual([inOrder, inOrder, 'definition/acme/a/notes', undefined]);
    });
  });
}

const acrossAcme = { kind: 'org', org: { org: 'acme' }, streams: ['org/acme/playbooks'] } as const;

function factsAcrossAnOrg(entry: NamesAtThePortEntry): void {
  describe("an org's reads of every fact of its playbooks, at the port", () => {
    it('cover the streams of the org it names and every stream of its playbooks and their definitions, each fact of a playbook named with its playbook', async () => {
      const port = await entry.keeping(unbounded);
      const start = await Effect.runPromise(
        Effect.orDie(port.ledger.readAppendedFacts(acrossAcme, { most: 10, dataOf: [] })),
      );
      await answerOf(port, 'org/acme/playbooks', fact('remarked', 'registered'));
      await answerOf(port, 'org/acme/keys', fact('remarked', 'not named'));
      await answerOf(port, 'playbook/acme/alpha/notes', fact('remarked', 'first'));
      await answerOf(port, 'definition/acme/a/notes', made('a', 'triage'));
      await answerOf(port, 'definition/acme/b/notes', made('b', 'brief', { playbook: 'beta' }));
      await answerOf(port, 'definition/acme/c/notes', fact('remarked', 'held by none'));
      await answerOf(port, 'playbook/other/alpha/notes', fact('remarked', 'of another org'));
      await answerOf(port, 'org/other/playbooks', fact('remarked', 'of another org'));

      const appended = await Effect.runPromise(
        Effect.orDie(port.ledger.readAppendedFacts(acrossAcme, { after: start.cursor, most: 10, dataOf: [] })),
      );

      expect(appended.facts.map(({ stream, playbook }) => [stream, playbook])).toEqual([
        ['org/acme/playbooks', undefined],
        ['playbook/acme/alpha/notes', 'alpha'],
        ['definition/acme/a/notes', 'alpha'],
        ['definition/acme/b/notes', 'beta'],
        ['definition/acme/c/notes', undefined],
      ]);
    });
  });
}

function streamsOfAPlaybook(entry: NamesAtThePortEntry): void {
  describe('the definition that holds a stream, read at the port', () => {
    it('answers the key of the definition of the playbook under which a stream lies, and none for a stream no definition of the playbook holds', async () => {
      const port = await entry.keeping(unbounded);
      await answerOf(
        port,
        shared,
        made('a', 'triage'),
        made('b', 'brief'),
        made('c', 'flow', { type: 'workflow' }),
        made('d', 'triage', { playbook: 'beta' }),
      );
      await answerOf(port, 'definition/acme/b/runs/first', fact('remarked', 'first'));
      await answerOf(port, 'definition/acme/c/runs/second', fact('remarked', 'second'));
      await answerOf(port, 'definition/acme/d/runs/third', fact('remarked', 'third'));

      const answers = await Effect.runPromise(
        Effect.all([
          port.ledger.holderOfStream({ playbookKey: 'playbook/acme/alpha/', stream: 'runs/first' }),
          port.ledger.holderOfStream({ playbookKey: 'playbook/acme/alpha/', stream: 'runs/second' }),
          port.ledger.holderOfStream({ playbookKey: 'playbook/acme/alpha/', stream: 'runs/third' }),
          port.ledger.holderOfStream({ playbookKey: 'playbook/acme/beta/', stream: 'runs/third' }),
          port.ledger.holderOfStream({ playbookKey: 'playbook/acme/alpha/', stream: 'runs/none' }),
        ]),
      );

      expect(answers).toEqual(['definition/acme/b/', 'definition/acme/c/', undefined, 'definition/acme/d/', undefined]);
    });
  });
}

export function namesReadAtThePort(entry: NamesAtThePortEntry): void {
  namesOfAPlaybook(entry);
  namesOfAKind(entry);
  factsOfAPlaybook(entry);
  factsAcrossAnOrg(entry);
  streamsOfAPlaybook(entry);
}
