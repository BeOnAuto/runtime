import { valueAt } from '@on.auto/definitions/tool-blocks';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import type { OneCall } from '@on.auto/tool-servers';
import { Effect, Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { listedEventOf } from '../events/arrival-readings.ts';
import type { Destination } from '../events/destination-fields.ts';
import { providerNamed, providersShippedRoots, readProviders, subscriptionCallsOf, triggersAskerOf } from '../index.ts';
import {
  aCompletedIssue,
  anIssue,
  aPage,
  aWhoAmIAnswer,
  someoneElse,
  theConnectedAccount,
  theLastPage,
} from '../testing/linear-answers.ts';
import { answeredWith } from '../testing/subscription-services.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const linearsEntry = Result.getOrThrow(providerNamed(shipped, 'linear')).entry;

const linearsDestinations = linearsEntry.events?.destinations ?? [];

const CREATED = 'app.linear.issue.created';

const UPDATED = 'app.linear.issue.updated';

const COMPLETED = 'app.linear.issue.completed';

const checkOf = (type: string): Destination =>
  Option.getOrThrow(
    Option.fromNullishOr(linearsDestinations.find(({ events = [] }) => events.some((each) => each.type === type))),
  );

const readOf = (type: string) => Option.getOrThrow(Option.fromNullishOr(checkOf(type).read));

const since = '2026-11-20T09:00:00.000Z';

const isAList = Schema.is(Schema.Array(Schema.Json));

interface PageRead {
  readonly called: readonly OneCall[];
  readonly items: readonly Schema.Json[];
  readonly next: unknown;
}

const askedFor = (type: string, team: string) =>
  Effect.runSync(
    triggersAskerOf(() => Effect.succeed([{ connection: 'linear', type, subject: team }]))({
      org: 'acme',
      playbook: 'alpha',
      taken: new Map([['linear', linearsDestinations]]),
    }),
  );

const topicFor = (type: string) => askedFor(type, 'Engineering')[0]?.topic ?? '';

const place = { org: 'acme', playbook: 'alpha', connection: 'linear' };

function throughLinear(answer: Schema.Json) {
  const called: OneCall[] = [];
  const calls = subscriptionCallsOf({
    callOnce: (call) =>
      Effect.sync(() => {
        called.push(call);
        return answeredWith(answer);
      }),
    requestOnce: () => Effect.die('a request was sent'),
    mostRequestBytesTo: () => 1_048_576,
    callbackOf: () => {},
  });
  return { called, calls };
}

function pageRead(type: string, answer: Schema.Json, pageToken: string): PageRead {
  const read = readOf(type);
  const { called, calls } = throughLinear(answer);
  const done = Effect.runSync(calls.read({ read, place, topic: topicFor(type), since, pageToken }));
  const document = done.outcome === 'answered' ? done.document : undefined;
  const listed = valueAt(document, read.list);
  const next = valueAt(document, read.next_page_token ?? '/');
  return { called, items: isAList(listed) ? listed : [], next };
}

function identifiedBy(answer: Schema.Json) {
  const identity = Option.getOrThrow(Option.fromNullishOr(linearsEntry.events?.identity));
  const { called, calls } = throughLinear(answer);
  const identification = Effect.runSync(calls.identify({ identity, place }));
  return { called, identification };
}

const calledWith = ({ called }: Pick<PageRead, 'called'>) =>
  called.map(({ reference, input, requiredMark }) => ({ reference, input, requiredMark }));

const pageTokensAsked = ({ called }: PageRead) => called.map(({ input }) => input['cursor']);

const cursorsIn = (type: string, { items }: PageRead) => items.map((item) => valueAt(item, readOf(type).cursor ?? '/'));

const eventsIn = (type: string, { items }: PageRead) => items.map((item) => listedEventOf(checkOf(type), item));

const idOf = (...parts: readonly string[]) => parts.map((part) => encodeURIComponent(part)).join('/');

const fields: readonly string[] = [
  'uuid',
  'title',
  'url',
  'createdAt',
  'updatedAt',
  'completedAt',
  'status',
  'statusType',
  'priority',
  'assignee',
  'team',
];

const listingFor = (sinceAs: Readonly<Record<string, string>>, asked: readonly string[]) => ({
  team: 'Engineering',
  ...sinceAs,
  limit: 50,
  cursor: '',
  fields: asked,
});

const theIssueAsData = {
  identifier: 'ENG-123',
  title: anIssue.title,
  url: anIssue.url,
  status: 'In Progress',
  status_type: 'started',
  priority: 'High',
  assignee: 'Ada Lovelace',
  created_at: anIssue.createdAt,
};

const theCompletedIssueAsData = {
  identifier: 'ENG-122',
  title: aCompletedIssue.title,
  url: aCompletedIssue.url,
  status: 'Done',
  status_type: 'completed',
  priority: 'No priority',
  created_at: aCompletedIssue.createdAt,
  completed_at: aCompletedIssue.completedAt,
};

const asListedBy = (type: string) => ({ type, subject: 'Engineering' });

const eachRead = [
  {
    type: CREATED,
    sinceAs: { createdAt: since, orderBy: 'createdAt' },
    cursor: '/createdAt',
    asked: [...fields, 'createdById'],
  },
  { type: UPDATED, sinceAs: { updatedAt: since, orderBy: 'updatedAt' }, cursor: '/updatedAt', asked: fields },
  {
    type: COMPLETED,
    sinceAs: { updatedAt: since, completedAt: since, orderBy: 'updatedAt' },
    cursor: '/updatedAt',
    asked: fields,
  },
] as const;

/** The event a check lists for an issue, its id the type, the issue and what else the check keys its events by. */
const eventOf = (type: string, uuid: string, time: string, data: object, ...keyedBy: readonly string[]) => ({
  ...asListedBy(type),
  id: idOf(type, uuid, ...keyedBy),
  time,
  data,
});

const createdOnce = [
  { ...eventOf(CREATED, anIssue.uuid, anIssue.createdAt, theIssueAsData), actor: theConnectedAccount },
  { ...eventOf(CREATED, aCompletedIssue.uuid, aCompletedIssue.createdAt, theCompletedIssueAsData), actor: someoneElse },
];

const eachAsItWas = [
  eventOf(UPDATED, anIssue.uuid, anIssue.updatedAt, theIssueAsData, anIssue.updatedAt),
  eventOf(UPDATED, aCompletedIssue.uuid, aCompletedIssue.updatedAt, theCompletedIssueAsData, aCompletedIssue.updatedAt),
];

describe('the checks Linear’s entry declares', () => {
  it.each(eachRead)(
    'list a team’s issues for $type since the mark through the tool that lists issues, read only, newest first by $cursor, a page at a time',
    ({ type, sinceAs, cursor, asked }) => {
      const first = pageRead(type, aPage, '');
      const last = pageRead(type, theLastPage, aCompletedIssue.uuid);
      const read = readOf(type);

      expect(calledWith(first)).toEqual([
        {
          reference: { server: 'linear', tool: 'list_issues' },
          input: listingFor(sinceAs, asked),
          requiredMark: 'reads',
        },
      ]);
      expect(pageTokensAsked(last)).toEqual([aCompletedIssue.uuid]);
      expect([read.order, read.start, read.cursor, first.next, last.next]).toEqual([
        'newest_first',
        '{{ now }}',
        cursor,
        aCompletedIssue.uuid,
        undefined,
      ]);
    },
  );

  it('turn an issue created into one event of it, once, its creation the cursor', () => {
    const page = pageRead(CREATED, aPage, '');

    expect([cursorsIn(CREATED, page), eventsIn(CREATED, page)]).toEqual([
      [anIssue.createdAt, aCompletedIssue.createdAt],
      createdOnce,
    ]);
  });

  it('turn each issue changed into one event of it as it was then, its update time the cursor', () => {
    const page = pageRead(UPDATED, aPage, '');

    expect([cursorsIn(UPDATED, page), eventsIn(UPDATED, page)]).toEqual([
      [anIssue.updatedAt, aCompletedIssue.updatedAt],
      eachAsItWas,
    ]);
  });
});

describe('the account a Linear connection acts as', () => {
  it('is asked of the tool that names who is signed in, which need not be marked as one that only reads, with its workspace', () => {
    const { called, identification } = identifiedBy(aWhoAmIAnswer);

    expect(calledWith({ called })).toEqual([
      { reference: { server: 'linear', tool: 'whoami' }, input: {}, requiredMark: undefined },
    ]);
    expect(identification).toEqual({
      user: { id: theConnectedAccount, name: 'Grace Hopper' },
      account: { id: aWhoAmIAnswer.workspace.id },
    });
  });

  // The intake takes an event as the connection's own when its actor is the account recorded for the connection, and
  // starts no workflow from it unless the trigger asks for its own (`isItsOwn` of `@on.auto/workflow-host`).
  it('is the actor of an issue created that it created, and not of one someone else created; the other checks name no actor', () => {
    const { identification } = identifiedBy(aWhoAmIAnswer);
    const created = eventsIn(CREATED, pageRead(CREATED, aPage, ''));
    const otherChecks = [UPDATED, COMPLETED].flatMap((type) => eventsIn(type, pageRead(type, aPage, '')));

    expect(created.map((event) => event?.actor === identification.user.id)).toEqual([true, false]);
    expect(otherChecks.map((event) => event?.actor)).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('the check of the issues Linear’s entry says are completed', () => {
  it('turns an issue completed into one event for each time it is completed, whatever changes it after', () => {
    const page = pageRead(COMPLETED, { issues: [aCompletedIssue] }, '');
    const done = aCompletedIssue.completedAt;
    const changedAfter = { ...aCompletedIssue, updatedAt: '2026-11-20T11:00:00.000Z', title: 'Dates are fixed' };
    const completedAgain = { ...aCompletedIssue, completedAt: '2026-11-21T08:00:00.000Z' };
    const completedIdOf = (issue: Schema.Json) => listedEventOf(checkOf(COMPLETED), issue)?.id;

    expect(eventsIn(COMPLETED, page)).toEqual([
      eventOf(COMPLETED, aCompletedIssue.uuid, done, theCompletedIssueAsData, done),
    ]);
    expect([completedIdOf(aCompletedIssue), completedIdOf(changedAfter), completedIdOf(completedAgain)]).toEqual([
      idOf(COMPLETED, aCompletedIssue.uuid, aCompletedIssue.completedAt),
      idOf(COMPLETED, aCompletedIssue.uuid, aCompletedIssue.completedAt),
      idOf(COMPLETED, aCompletedIssue.uuid, completedAgain.completedAt),
    ]);
  });
});

describe('the events Linear’s entry declares', () => {
  it('are three, each a trigger names a team for, each heard through its own check, under a topic no other check writes', () => {
    const asked = [CREATED, UPDATED, COMPLETED].map((type) =>
      askedFor(type, 'Engineering').map(({ topic, destination }) => [topic, destination] as const),
    );

    expect(linearsEntry.events?.types?.map(({ type, subject }) => [type, subject?.required])).toEqual([
      [CREATED, true],
      [UPDATED, true],
      [COMPLETED, true],
    ]);
    expect(linearsDestinations.map(({ type }) => type)).toEqual(['polling', 'polling', 'polling']);
    expect(asked).toEqual([
      [['issues created in Engineering', checkOf(CREATED)]],
      [['issues created or updated in Engineering', checkOf(UPDATED)]],
      [['issues completed in Engineering', checkOf(COMPLETED)]],
    ]);
    expect(new Set([CREATED, UPDATED, COMPLETED].map((type) => checkOf(type))).size).toBe(3);
  });

  it('mark the tool the checks call as one that only reads, so a check calls it whatever Linear’s server says of it', () => {
    expect([...new Set(linearsDestinations.map(({ read }) => read?.tool))]).toEqual(['list_issues']);
    expect(linearsEntry.marks).toEqual({ reads: ['list_issues'] });
  });
});
