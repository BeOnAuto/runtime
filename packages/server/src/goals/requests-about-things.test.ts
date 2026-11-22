import { withMcpSession, type McpSession } from '@on.auto/api/testing';
import { assessmentIdOf } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { anOrderArrived, playbookServed } from '../testing/goals/ordering-playbook.ts';
import { movingUntil, type WatchedServer } from '../testing/goals/watched-goals.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const Listed = Schema.Struct({
  interactions: Schema.Array(
    Schema.Struct({
      run_id: Schema.String,
      message: Schema.String,
      causes: Schema.optionalKey(Schema.Array(Schema.String)),
      about: Schema.optionalKey(
        Schema.Array(Schema.Struct({ goal: Schema.String, id: Schema.String, per: Schema.optionalKey(Schema.String) })),
      ),
      dismissed: Schema.optionalKey(Schema.Struct({ goal: Schema.String, id: Schema.String })),
    }),
  ),
});

type Interactions = (typeof Listed.Type)['interactions'];

async function requestsOf({ server }: WatchedServer, query = ''): Promise<Interactions> {
  const { body } = await server.call('GET', `${alpha}/interactions${query}`);
  return Schema.decodeUnknownSync(Listed)(body).interactions;
}

async function orderOf(watched: WatchedServer, per: string): Promise<string> {
  return assessmentIdOf({ definition: await watched.goalOf('orders'), per });
}

function eachAboutAThing(interactions: Interactions): boolean {
  return interactions.length === 2 && interactions.every(({ about }) => about !== undefined && about.length > 0);
}

describe('a question a workflow asks about an order another workflow started by the same email marked', () => {
  it('names the order it is about, though neither run is in the other’s chain, and no other order', async () => {
    const watched = await playbookServed();

    expect((await anOrderArrived(watched, 'ORD-1', 'Juniper Cafe')).status).toBe(200);
    expect((await anOrderArrived(watched, 'ORD-2', 'Harbor Deli')).status).toBe(200);
    const asked = await movingUntil(watched, () => requestsOf(watched), eachAboutAThing);

    const byMessage = Object.fromEntries(asked.map(({ message, about }) => [message, about]));
    const [first, second] = [await orderOf(watched, 'ORD-1'), await orderOf(watched, 'ORD-2')];
    expect(byMessage).toEqual({
      'Accept wholesale order ORD-1?': [{ goal: 'orders', id: first, per: 'ORD-1' }],
      'Accept wholesale order ORD-2?': [{ goal: 'orders', id: second, per: 'ORD-2' }],
    });
    expect(asked.map(({ causes }) => causes)).toEqual([[expect.any(String)], [expect.any(String)]]);
  });
});

const Dismissal = Schema.Struct({
  dismissed: Schema.Boolean,
  questions_set_aside: Schema.Int,
  notices: Schema.optionalKey(Schema.Array(Schema.Struct({ kind: Schema.String }))),
});

const OpenCounts = Schema.Struct({
  goals: Schema.Array(
    Schema.Struct({
      assessments: Schema.Struct({
        open_count: Schema.Int,
        dismissed_count: Schema.optionalKey(Schema.Int),
        in_flight: Schema.Array(
          Schema.Struct({ id: Schema.String, dismissed: Schema.optionalKey(Schema.Struct({ by: Schema.String })) }),
        ),
      }),
    }),
  ),
});

async function dismissedOver({ server }: WatchedServer, id: string, body: object) {
  const { status, body: answer } = await server.call('PUT', `${alpha}/goals/orders/things/${id}/dismissed`, { body });
  return { status, answer: Schema.decodeUnknownSync(Dismissal)(answer) };
}

async function openCountsOf({ server }: WatchedServer) {
  const { body } = await server.call('GET', `${alpha}/goals`);
  return Schema.decodeUnknownSync(OpenCounts)(body).goals.map(({ assessments }) => ({
    open_count: assessments.open_count,
    dismissed_count: assessments.dismissed_count,
  }));
}

async function inFlightOf({ server }: WatchedServer, query = '') {
  const { body } = await server.call('GET', `${alpha}/goals${query}`);
  return Schema.decodeUnknownSync(OpenCounts)(body).goals.flatMap(({ assessments }) =>
    assessments.in_flight.map(({ id, dismissed }) => ({ id, by: dismissed?.by })),
  );
}

function oneAboutAThing(interactions: Interactions): boolean {
  return interactions.length === 1 && interactions.every(({ about }) => about !== undefined && about.length > 0);
}

const Feed = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      data: Schema.Struct({
        goal: Schema.String,
        id: Schema.String,
        per: Schema.optionalKey(Schema.String),
        by: Schema.Struct({ id: Schema.String }),
      }),
    }),
  ),
});

async function thingEventsOf({ server }: WatchedServer, type: string) {
  const { body } = await server.call('GET', `${alpha}/events?type=${type}`);
  return Schema.decodeUnknownSync(Feed)(body).events.map(({ data: { goal, id, per, by } }) => ({
    goal,
    id,
    per,
    by: by.id,
  }));
}

const Bell = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({ dismissed: Schema.optionalKey(Schema.Struct({ goal: Schema.String, id: Schema.String })) }),
  ),
  counts: Schema.Struct({ needs_you: Schema.Int }),
});

async function bellOf({ server }: WatchedServer, query = '') {
  const { body } = await server.call('GET', `/v1/orgs/acme/activity?kind=needs_you${query}`);
  const { rows, counts } = Schema.decodeUnknownSync(Bell)(body);
  return { needs_you: counts.needs_you, rows: rows.map(({ dismissed }) => dismissed) };
}

function setAsideOf(interactions: Interactions) {
  return interactions.map(({ about = [], dismissed }) => ({ about: about.length, dismissed }));
}

describe('an order a question is about, dismissed over HTTP', () => {
  it('records the question waiting on it, leaves the goals read and the open requests, and comes back with dismissed: false', async () => {
    const watched = await playbookServed();
    expect((await anOrderArrived(watched, 'ORD-3', 'Juniper Cafe')).status).toBe(200);
    await movingUntil(watched, () => requestsOf(watched), oneAboutAThing);
    const id = await orderOf(watched, 'ORD-3');

    const dismissed = await dismissedOver(watched, id, {});
    const counted = await openCountsOf(watched);
    const inFlight = [await inFlightOf(watched), await inFlightOf(watched, '?dismissed=include')];
    const listed = setAsideOf(await requestsOf(watched));
    const included = setAsideOf(await requestsOf(watched, '?dismissed=include'));
    const bells = [await bellOf(watched), await bellOf(watched, '&dismissed=include')];
    const back = await dismissedOver(watched, id, { dismissed: false });

    expect(dismissed).toEqual({
      status: 200,
      answer: {
        dismissed: true,
        questions_set_aside: 1,
        notices: [{ kind: 'dismissed_for_everyone' }, { kind: 'question_still_waits' }],
      },
    });
    expect(counted).toEqual([{ open_count: 0, dismissed_count: 1 }]);
    expect(inFlight).toEqual([[], [{ id, by: 'local' }]]);
    expect([listed, included]).toEqual([[], [{ about: 1, dismissed: { goal: 'orders', id } }]]);
    expect(bells).toEqual([
      { needs_you: 0, rows: [] },
      { needs_you: 0, rows: [{ goal: 'orders', id }] },
    ]);
    expect(back).toEqual({ status: 200, answer: { dismissed: false, questions_set_aside: 0 } });
    expect(await bellOf(watched)).toEqual({ needs_you: 1, rows: [undefined] });
    expect(await openCountsOf(watched)).toEqual([{ open_count: 1, dismissed_count: 0 }]);
    expect(setAsideOf(await requestsOf(watched))).toEqual([{ about: 1, dismissed: undefined }]);
    expect([await thingEventsOf(watched, 'thing.dismissed'), await thingEventsOf(watched, 'thing.restored')]).toEqual([
      [{ goal: 'orders', id, per: 'ORD-3', by: 'local' }],
      [{ goal: 'orders', id, per: 'ORD-3', by: 'local' }],
    ]);
  });
});

describe('two orders dismissed one after the other over HTTP', () => {
  it('notices on the second the first the same caller dismissed lately', async () => {
    const watched = await playbookServed();
    expect((await anOrderArrived(watched, 'ORD-5', 'Juniper Cafe')).status).toBe(200);
    expect((await anOrderArrived(watched, 'ORD-6', 'Harbor Deli')).status).toBe(200);
    await movingUntil(watched, () => requestsOf(watched), eachAboutAThing);

    const first = await dismissedOver(watched, await orderOf(watched, 'ORD-5'), {});
    const second = await dismissedOver(watched, await orderOf(watched, 'ORD-6'), {});

    expect([first.answer.notices, second.answer.notices]).toEqual([
      [{ kind: 'dismissed_for_everyone' }, { kind: 'question_still_waits' }],
      [{ kind: 'dismissed_for_everyone' }, { kind: 'dismissed_several' }, { kind: 'question_still_waits' }],
    ]);
  });
});

describe('a dismissed order a new question is asked about', () => {
  it('comes back by Auto in every read, its questions listed and counted again, with why in the events', async () => {
    const watched = await playbookServed();
    expect((await anOrderArrived(watched, 'ORD-4', 'Juniper Cafe')).status).toBe(200);
    await movingUntil(watched, () => requestsOf(watched), oneAboutAThing);
    const id = await orderOf(watched, 'ORD-4');
    expect((await dismissedOver(watched, id, {})).answer.dismissed).toBe(true);
    const [waiting] = await requestsOf(watched, '?dismissed=include');
    watched.clock.moveTo(watched.clock.now() + 60_000);

    const answered = await watched.server.call('POST', `${alpha}/runs/${String(waiting?.run_id)}/answer`, {
      body: { answer: { accepted: true } },
    });
    const listed = await movingUntil(watched, () => requestsOf(watched), oneAboutAThing);

    expect(answered.status).toBe(200);
    expect(setAsideOf(listed)).toEqual([{ about: 1, dismissed: undefined }]);
    expect(setAsideOf(await requestsOf(watched, '?dismissed=include'))).toEqual(setAsideOf(listed));
    expect(await openCountsOf(watched)).toEqual([{ open_count: 1, dismissed_count: 0 }]);
    expect(await inFlightOf(watched, '?dismissed=include')).toEqual([{ id, by: undefined }]);
    expect([await bellOf(watched), await bellOf(watched, '&dismissed=include')]).toEqual([
      { needs_you: 1, rows: [undefined] },
      { needs_you: 1, rows: [undefined] },
    ]);
    expect(await thingEventsOf(watched, 'thing.restored')).toEqual([
      { goal: 'orders', id, per: 'ORD-4', by: 'playbook:alpha' },
    ]);
    expect((await dismissedOver(watched, id, {})).answer).toMatchObject({ dismissed: true, questions_set_aside: 1 });
  });
});

function onMcp<T>({ server }: WatchedServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

function calledIn(session: McpSession) {
  return async (name: string, input: Readonly<Record<string, unknown>> = {}) =>
    (await session.callTool(name, input)).structuredContent;
}

describe('an order a question is about, dismissed over MCP', () => {
  it('leaves list_interactions unless asked with dismissed: include, shows in the events with who, and comes back', async () => {
    const watched = await playbookServed();
    expect((await anOrderArrived(watched, 'ORD-4', 'Harbor Deli')).status).toBe(200);
    await movingUntil(watched, () => requestsOf(watched), oneAboutAThing);
    const id = await orderOf(watched, 'ORD-4');
    const thing = { goal: 'orders', id };

    const seen = await onMcp(watched, async (session) => {
      const call = calledIn(session);
      return {
        dismissed: await call('dismiss_goal_thing', thing),
        listed: await call('list_interactions'),
        included: await call('list_interactions', { dismissed: 'include' }),
        events: await call('list_playbook_events', { type: 'thing.dismissed' }),
        back: await call('dismiss_goal_thing', { ...thing, dismissed: false }),
        listedAgain: await call('list_interactions'),
        backEvents: await call('list_playbook_events', { type: 'thing.restored' }),
      };
    });

    const event = (type: string) => ({ events: [{ type, data: { ...thing, per: 'ORD-4', by: { id: 'local' } } }] });
    expect(seen).toMatchObject({
      dismissed: { ...thing, dismissed: true, questions_set_aside: 1 },
      listed: { interactions: [] },
      included: { interactions: [{ dismissed: thing }] },
      events: event('thing.dismissed'),
      back: { ...thing, dismissed: false, questions_set_aside: 0 },
      listedAgain: { interactions: [{ about: [thing] }] },
      backEvents: event('thing.restored'),
    });
    expect(JSON.stringify(seen.listedAgain)).not.toMatch(/dismissed/u);
  });
});
