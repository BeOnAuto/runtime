import { presentationOf } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { echoingFunction } from '../testing/capabilities/paged.ts';
import { firstMoment } from '../testing/harness.ts';
import {
  askedAt,
  definitionFactsOf,
  keepingPlaybook,
  keptArmOfText,
  keptFunctionName,
  twoHoursLater,
} from '../testing/kept-documents.ts';
import { createdAtTheFloor } from '../testing/saved-at-the-floor.ts';
import { savedPlaybook, savingAFunction, savingOperations } from '../testing/saved-definitions.ts';

const { getDefinition, listDefinitions, pauseDefinition } = savingOperations;

const { first } = savingAFunction;

const unreadNow: unknown = expect.stringContaining('could not be read just now; ask again in a moment');

const pausedUnread =
  "Saved. The reasoning function greet-reasoning was paused, but storage didn't respond, so it can't be shown yet. Refresh in a moment to check the current status.";

describe('a definition whose texts its playbook keeps outside its facts, read', () => {
  it('answers its texts as read, and lists them without a read', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await createdAtTheFloor(definitions, first);

    expect(await askedAt(definitions, firstMoment)(listDefinitions, { type: savingAFunction.type })).toMatchObject({
      status: 'succeeded',
      output: { definitions: [{ name: keptFunctionName }] },
    });
    expect(watched.reads()).toBe(0);
    expect(await asked(getDefinition)).toMatchObject({
      status: 'succeeded',
      output: { source: first.source, overview: first.overview, diagram: first.diagram },
    });
    expect(watched.reads()).toBe(3);
  });

  it('is unavailable while its texts cannot be read, and refused, naming the text lost, once they are gone', async () => {
    const [unreachable, lost] = [keepingPlaybook(), keepingPlaybook()];
    await createdAtTheFloor(unreachable.definitions, first);
    await createdAtTheFloor(lost.definitions, first);
    unreachable.watched.fail();
    lost.watched.lose();

    expect([
      await unreachable.asked(getDefinition),
      await askedAt(lost.definitions, twoHoursLater)(getDefinition),
    ]).toMatchObject([
      { status: 'rejected', reason: 'unavailable', kind: 'content_unavailable', detail: unreadNow },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'unworkable',
        detail:
          "The document of version 1 of the reasoning function greet-reasoning is missing from the playbook's content; update_definition saves the reasoning function again with one",
      },
    ]);
  });
});

describe('a definition whose texts its playbook keeps outside its facts, paused', () => {
  it('is paused while its texts cannot be read, and says so, answering why its texts are not in the answer', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await createdAtTheFloor(definitions, first);
    watched.fail();

    expect(await asked(pauseDefinition)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'content_unavailable',
      detail: pausedUnread,
    });
    expect((await definitionFactsOf(definitions)).map(({ type }) => type)).toEqual([
      'definition_created',
      'definition_paused',
    ]);
  });
});

describe('an overview its playbook keeps outside the fact of its version', () => {
  const small = { source: savingAFunction.small.source, overview: String(first.overview), diagram: 'none' };

  it('is never read as absent: answered as read, shown on the feed by its digest and size, and refused by name once it is gone', async () => {
    const [readable, lost] = [keepingPlaybook(), keepingPlaybook()];
    await createdAtTheFloor(readable.definitions, small);
    await createdAtTheFloor(lost.definitions, small);
    lost.watched.lose();
    const { records } = await Effect.runPromise(
      readable.definitions.ledger.service.readRecorded(
        savedPlaybook,
        { kind: 'everything' },
        { order: 'asc', limit: 1 },
      ),
    );
    const { present } = presentationOf(makeDefinitionPresenters([echoingFunction]));
    const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'whole' } as const;
    const overview = keptArmOfText(small.overview);

    expect(await readable.asked(getDefinition)).toMatchObject({ status: 'succeeded', output: small });
    expect(
      records.flatMap((record) =>
        present({ ...record, stream: record.stream.replace(showing.streamPrefix, '') }, showing),
      ),
    ).toMatchObject([{ data: { overview_sha256: overview.sha256, overview_bytes: overview.bytes } }]);
    expect(await askedAt(lost.definitions, twoHoursLater)(getDefinition)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail:
        "The overview of version 1 of the reasoning function greet-reasoning is missing from the playbook's content; update_definition saves the reasoning function again with one",
    });
  });
});
