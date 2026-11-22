import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { freshInstances } from '../instances/fresh-instances.ts';
import { filterSandboxOf } from '../instances/host-sandboxes.ts';
import { sandboxModuleOnDisk } from '../pool-testing/test-pools.ts';
import { filterMayTake, filterTakesAsWritten } from './attribute-match.ts';
import { connectionNamedBy, connectionSourcePrefix } from './connection-sources.ts';
import { hasAttributes, literalFilterOf } from './event-filter.ts';
import { filterTestingOf, filterVerdictsOf } from './filter-verdicts.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const sandbox = filterSandboxOf(freshInstances(sandboxModuleOnDisk), () => 0);

const type = 'com.example.item.added';

const reported: JsonObject = {
  specversion: '1.0',
  id: 'item-7',
  source: `${connectionSourcePrefix}tracker`,
  type,
  subject: 'board-1',
  time: '2026-10-01T08:59:00Z',
  data: { title: 'A new item' },
};

const madeByAnApp: JsonObject = { ...reported, id: 'item-8', automatic: true };

const published: JsonObject = { ...reported, source: '/ledger/eu', automatic: true };

const filters: readonly JsonObject[] = [
  { type },
  { type, subject: 'board-1' },
  { type, source: `${connectionSourcePrefix}tracker` },
  { type, source: `${connectionSourcePrefix}other` },
  { type, source: `${connectionSourcePrefix}tracker`, automatic: true },
  { type, source: '${ true }', automatic: true },
];

const placed = filters.map((attributes, index) => ({ reference: `/schedule/on/any/${index}`, attributes }));

function listened(event: JsonObject): readonly boolean[] {
  return filters.map((attributes) => hasAttributes(event, attributes, Function.constTrue));
}

describe('the source of an event a connection reports', () => {
  it('begins with the connections prefix and names the connection after it', () => {
    expect(
      [`${connectionSourcePrefix}tracker`, connectionSourcePrefix, '/connection/tracker', '/ledger/eu'].map((source) =>
        connectionNamedBy(source),
      ),
    ).toEqual(['tracker', '', undefined, undefined]);
  });
});

describe('an event a connection reports, matched by the filters of triggers, listeners and pages', () => {
  it('is taken only by a filter that names its source as written, one an app made only where it names automatic: true, and one a person made also there', async () => {
    expect([
      await filterVerdictsOf(placed, reported, sandbox, now),
      await filterVerdictsOf(placed, madeByAnApp, sandbox, now),
    ]).toEqual([
      [false, false, true, false, true, false],
      [false, false, false, false, true, false],
    ]);
  });

  it('is judged by the same rule over a page of events and in a run that listens', async () => {
    const testing = filterTestingOf(placed, sandbox);
    const verdicts = [await testing.verdictsOf(reported, now), await testing.verdictsOf(madeByAnApp, now)];
    await testing.close();

    expect(verdicts).toEqual([
      [false, false, true, false, true, false],
      [false, false, false, false, true, false],
    ]);
    expect([listened(reported), listened(madeByAnApp)]).toEqual([
      [false, false, true, false, true, false],
      [false, false, false, false, true, false],
    ]);
  });
});

describe('a filter written as JSON, as a prediction dataset’s are', () => {
  it('may take an event by the same two rules, before its attributes are compared', () => {
    expect(
      [reported, madeByAnApp, published].map((event) => filters.map((attributes) => filterMayTake(attributes, event))),
    ).toEqual([
      [false, false, true, false, true, false],
      [false, false, false, false, true, false],
      [true, true, true, true, true, true],
    ]);
  });
});

describe('a filter written as JSON with no expression, as a prediction dataset’s written out are', () => {
  it('takes an event by the same rules and its attributes as written, a mark written true granting it', () => {
    expect(
      [reported, madeByAnApp, published].map((event) =>
        filters.map((attributes) => filterTakesAsWritten(attributes, event)),
      ),
    ).toEqual([
      [false, false, true, false, true, false],
      [false, false, false, false, true, false],
      [true, true, false, false, false, false],
    ]);
  });
});

describe('an event of any other source, matched by the same filters', () => {
  it('is taken as before, whatever it says of automatic', async () => {
    expect(await filterVerdictsOf(placed, published, sandbox, now)).toEqual([true, true, false, false, false, true]);
    expect(listened(published)).toEqual([true, true, false, false, false, true]);
  });
});

const itsOwn: JsonObject = { ...reported, id: 'item-9', own: true };

const itsOwnApp: JsonObject = { ...reported, id: 'item-10', automatic: true, own: true };

const ofTheTracker = { type, source: `${connectionSourcePrefix}tracker` };

const asking: readonly JsonObject[] = [
  ofTheTracker,
  { ...ofTheTracker, automatic: true },
  { ...ofTheTracker, own: true },
  { ...ofTheTracker, automatic: true, own: true },
  { type, own: true },
];

const placedAsking = asking.map((attributes, index) => ({ reference: `/schedule/on/any/${index}`, attributes }));

describe('an event the connection’s own account caused, matched by the filters of triggers, listeners and pages', () => {
  it('is taken only by a filter that names its source and writes own: true, and one an app made only where it also writes automatic: true', async () => {
    const testing = filterTestingOf(placedAsking, sandbox);
    const tested = [await testing.verdictsOf(itsOwn, now), await testing.verdictsOf(itsOwnApp, now)];
    await testing.close();
    const expected = [
      [false, false, true, true, false],
      [false, false, false, true, false],
    ];

    expect([
      await filterVerdictsOf(placedAsking, itsOwn, sandbox, now),
      await filterVerdictsOf(placedAsking, itsOwnApp, sandbox, now),
    ]).toEqual(expected);
    expect(tested).toEqual(expected);
    expect(
      [itsOwn, itsOwnApp].map((event) =>
        asking.map((attributes) => hasAttributes(event, attributes, Function.constTrue)),
      ),
    ).toEqual(expected);
  });

  it('is judged by that rule only under a connection’s source, an event of any other source by its attributes as before', () => {
    expect(
      [itsOwn, { ...itsOwn, source: '/ledger/eu' }].map((event) =>
        asking.map((attributes) => filterMayTake(attributes, event)),
      ),
    ).toEqual([
      [false, false, true, true, false],
      [true, true, true, true, true],
    ]);
  });
});

const ofTheTrackerMarked = (marks: JsonObject): JsonObject => ({ ...reported, id: 'item-11', ...marks });

const markedTable = [
  { mark: 'automatic', other: 'own' },
  { mark: 'own', other: 'automatic' },
] as const;

function filtering(marks: JsonObject): JsonObject {
  return { ...ofTheTracker, ...marks };
}

function takes(attributes: JsonObject, event: JsonObject): boolean {
  return hasAttributes(event, attributes, Function.constTrue);
}

describe.each(markedTable)('a mark of a connection’s event, $mark', ({ mark, other }) => {
  const unmarked = ofTheTrackerMarked({});
  const marked = ofTheTrackerMarked({ [mark]: true });
  const markedTwice = ofTheTrackerMarked({ [mark]: true, [other]: true });

  it('is not asked for by a filter that leaves it out, which takes the event without it alone', () => {
    expect([takes(filtering({}), unmarked), takes(filtering({}), marked)]).toEqual([true, false]);
  });

  it('is asked for by a filter that writes it true, which takes the event with it and the event without it', () => {
    expect([takes(filtering({ [mark]: true }), unmarked), takes(filtering({ [mark]: true }), marked)]).toEqual([
      true,
      true,
    ]);
  });

  it('written false, makes a filter that takes neither', () => {
    expect([takes(filtering({ [mark]: false }), unmarked), takes(filtering({ [mark]: false }), marked)]).toEqual([
      false,
      false,
    ]);
  });

  it('beside the other mark on one event, is taken only by a filter that writes both', () => {
    expect(
      [{ [mark]: true }, { [other]: true }, { [mark]: true, [other]: true }].map((marks: JsonObject) =>
        takes(filtering(marks), markedTwice),
      ),
    ).toEqual([false, false, true]);
  });

  it('on an event of any other source, is compared exactly as any attribute is', () => {
    const onTheLedger = { ...unmarked, source: '/ledger/eu' };
    const askingTheLedger = { type, source: '/ledger/eu', [mark]: true };

    expect([takes(askingTheLedger, onTheLedger), takes(askingTheLedger, { ...onTheLedger, [mark]: true })]).toEqual([
      false,
      true,
    ]);
  });
});

function refusedAt(attributes: JsonObject): readonly string[] {
  const reading = literalFilterOf({ with: { type, ...attributes } }, '/schedule/on/one');
  return 'rejections' in reading ? reading.rejections.map(({ pointer }) => pointer) : [];
}

describe('a trigger’s filter that asks for what an app or the connection’s own account did', () => {
  it.each(['automatic', 'own'])(
    'writes %s as the boolean the runtime types it as, and is refused for it written any other way',
    (mark) => {
      expect([true, false, 'true', 1].map((value: Json) => refusedAt({ [mark]: value }))).toEqual([
        [],
        [],
        [`/schedule/on/one/with/${mark}`],
        [`/schedule/on/one/with/${mark}`],
      ]);
    },
  );
});
