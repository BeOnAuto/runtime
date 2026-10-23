import { internalTermsIn } from '@on.auto/operations/testing';
import { answers, jsonResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const review = workflowSource(
  'review',
  `do:
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: '\${ $data.expense }' } }
  - route:
      switch:
        - approved: { when: $data.approve === true, then: accept }
        - declined: { then: decline }
  - accept: { set: { approved: true }, then: end }
  - decline: { set: { approved: false } }
`,
);

const EventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  summary: Schema.String,
  data: Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    run_id: Schema.optionalKey(Schema.String),
  }),
  metadata: Schema.Struct({
    causation_id: Schema.NullOr(Schema.String),
    run_id: Schema.optionalKey(Schema.String),
  }),
});

type Event = typeof EventSchema.Type;

const pageOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(EventSchema),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function reviewed(): Promise<string> {
  server = await servingWorkflows([answers(jsonResult({ approve: false }))]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'verdict', source: verdict } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'review', source: review } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/review/run`, {
    body: { input: { expense: 'a yacht' } },
  });
  const runId = runIdIn(started.body);
  await settledRun(server, `${alpha}/runs/${runId}`);
  return runId;
}

async function pageAt(path: string, cursor: string | null = null) {
  const query = cursor === null ? '' : `&cursor=${cursor}`;
  return pageOf((await server.call('GET', `${path}${query}`)).body);
}

async function everyEvent(path: string, cursor: string | null = null): Promise<readonly Event[]> {
  const page = await pageAt(path, cursor);
  return page.next_cursor === null ? page.events : [...page.events, ...(await everyEvent(path, page.next_cursor))];
}

function causeOf(event: Event | undefined): string | null | undefined {
  return event?.metadata.causation_id;
}

function isOfRun({ data, metadata }: Event, runId: string): boolean {
  return [data.run_id, metadata.run_id].includes(runId);
}

function startOf(events: readonly Event[], runId: string): Event | undefined {
  return events.find(({ type, metadata }) => type === 'run_started' && metadata.run_id === runId);
}

function named(events: readonly Event[], type: string, name?: string): Event {
  const found = events.find((event) => event.type === type && (name === undefined || event.data.name === name));
  if (found === undefined) {
    throw new Error(`No ${type} ${name ?? ''} among the events`);
  }
  return found;
}

describe('the graph of a workflow run, over HTTP', () => {
  it('names every event and its cause, from the start through each step to the finish', async () => {
    const runId = await reviewed();
    const events = await everyEvent(`${alpha}/runs/${runId}/history?limit=100`);
    const started = named(events, 'run_started');
    const [first, second] = events.filter(({ type }) => type === 'workflow_input_applied');

    expect([
      causeOf(started),
      causeOf(first),
      causeOf(named(events, 'step_waiting', 'judge')),
      causeOf(second),
      causeOf(named(events, 'step_finished', 'judge')),
      causeOf(named(events, 'step_finished', 'route')),
      causeOf(named(events, 'step_finished', 'decline')),
      causeOf(named(events, 'run_succeeded')),
    ]).toEqual([
      null,
      started.id,
      first?.id,
      first?.id,
      second?.id,
      named(events, 'step_finished', 'judge').id,
      named(events, 'step_finished', 'route').id,
      second?.id,
    ]);
    expect([named(events, 'step_waiting', 'judge').id, named(events, 'step_finished', 'judge').id]).toEqual([
      `${String(first?.id)}_1`,
      `${String(second?.id)}_1`,
    ]);
    expect(events.slice(0, 3).map(({ type }) => type)).toEqual([
      'run_started',
      'workflow_input_applied',
      'step_waiting',
    ]);
    expect(events.filter(({ type }) => type === 'step_started')).toEqual([]);
    expect(events.map(({ type }) => type)).not.toContain('run_deferred');
    expect(events.flatMap(({ summary }) => internalTermsIn(summary))).toEqual([]);
  });
});

const decodeRows = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Record(Schema.String, Schema.Json)) }),
);

function rowCalled(page: unknown, id: string | undefined): unknown {
  return decodeRows(page).events.find((row) => row['id'] === id);
}

describe('one event of a workflow run, read by its id, over HTTP', () => {
  it('is the row the history shows, a step by the id of its record, an underscore and its number, and the input by the id of the record', async () => {
    const runId = await reviewed();
    const page = (await server.call('GET', `${alpha}/runs/${runId}/history?limit=100`)).body;
    const [first, second] = pageOf(page).events.filter(({ type }) => type === 'workflow_input_applied');
    const record = String(second?.id);
    const encoded = `${alpha}/events/${record}%5F2`;

    const asItIs = await server.call('GET', `${alpha}/events/${record}_2`);
    const percentEncoded = await server.call('GET', encoded);
    const decodedByAProxy = await server.call('GET', decodeURIComponent(encoded));
    const input = await server.call('GET', `${alpha}/events/${String(first?.id)}`);
    const beyond = await server.call('GET', `${alpha}/events/${String(first?.id)}_9`);

    expect([asItIs, percentEncoded, decodedByAProxy, input].map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    expect([asItIs.body, percentEncoded.body, decodedByAProxy.body, input.body]).toEqual([
      rowCalled(page, `${record}_2`),
      rowCalled(page, `${record}_2`),
      rowCalled(page, `${record}_2`),
      rowCalled(page, first?.id),
    ]);
    expect(asItIs.body).toMatchObject({ id: `${record}_2` });
    expect(beyond).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });

  it('refuses a step numbered from 0 or with a leading zero as no id of an event', async () => {
    const runId = await reviewed();
    const page = (await server.call('GET', `${alpha}/runs/${runId}/history?limit=100`)).body;
    const first = pageOf(page).events.find(({ type }) => type === 'workflow_input_applied');

    const refused = await Promise.all(
      ['_0', '_02'].map((step) => server.call('GET', `${alpha}/events/${String(first?.id)}${step}`)),
    );

    expect(refused).toMatchObject([
      { status: 422, body: { reason: 'invalid_input' } },
      { status: 422, body: { reason: 'invalid_input' } },
    ]);
  });
});

describe('the tree of a workflow run, over HTTP', () => {
  it('reads the whole tree of a run in the feed, its child started by the input that started the call, and nothing for the child', async () => {
    const runId = await reviewed();
    const tree = await everyEvent(`${alpha}/events?run_id=${runId}&order=asc&limit=100`);
    const waiting = named(tree, 'step_waiting', 'judge');
    const child = String(waiting.data.run_id);
    const ofChild = await everyEvent(`${alpha}/events?run_id=${child}&limit=100`);
    const childStarted = startOf(tree, child);

    expect(causeOf(childStarted)).toBe(waiting.id.slice(0, waiting.id.indexOf('_')));
    expect(tree.filter((event) => isOfRun(event, child)).map(({ type }) => type)).toEqual([
      'step_waiting',
      'run_started',
      'model_call_started',
      'model_call_answered',
      'run_succeeded',
    ]);
    expect(ofChild).toEqual([]);
  });

  it('is never given by the input of run_definition, which refuses a lineage', async () => {
    await reviewed();

    const refused = await server.call('POST', `${alpha}/definitions/workflow/review/run`, {
      body: { input: {}, lineage: { causationId: null, correlationId: 'mine' } },
    });

    expect(refused).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ detail: 'Expected no excess property', pointer: '/lineage' }] },
    });
  });
});

describe('the pages of a workflow run, over HTTP', () => {
  it('reads on from a page that ends at an input, the steps of that input first, with nothing lost or repeated', async () => {
    const runId = await reviewed();
    const feed = `${alpha}/events?run_id=${runId}&order=asc`;
    const tree = await everyEvent(`${feed}&limit=100`);
    const at = tree.findLastIndex(({ type }) => type === 'workflow_input_applied');
    const upToTheInput = await pageAt(`${feed}&limit=${at + 1}`);
    const after = await everyEvent(`${feed}&limit=100`, upToTheInput.next_cursor);

    expect([upToTheInput.events, after]).toEqual([tree.slice(0, at + 1), tree.slice(at + 1)]);
    expect(after[0]?.type).toBe('step_finished');
  });

  it('pages the history by events in the order recorded, ends inside an input, and reads on with nothing lost or repeated', async () => {
    const runId = await reviewed();
    const whole = await everyEvent(`${alpha}/runs/${runId}/history?limit=100`);
    const byTwo = await everyEvent(`${alpha}/runs/${runId}/history?limit=2`);
    const newestFirst = await everyEvent(`${alpha}/runs/${runId}/history?order=desc&limit=3`);

    expect(byTwo.map(({ id }) => id)).toEqual(whole.map(({ id }) => id));
    expect(newestFirst.map(({ id }) => id)).toEqual(whole.map(({ id }) => id).toReversed());
    expect(new Set(byTwo.map(({ id }) => id)).size).toBe(whole.length);
  });
});
