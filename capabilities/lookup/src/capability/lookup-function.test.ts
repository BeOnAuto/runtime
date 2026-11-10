import { onTheStandingClock } from '@on.auto/definitions/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { lookupDocument, runsDocument } from '../testing/index.ts';
import { makeLookupFunctionAdapter } from './lookup-function.ts';

const lookup = makeLookupFunctionAdapter({
  tools: { listServers: () => Effect.succeed([]), callOnce: () => Effect.die(new Error('No call is made here')) },
  runs: { readRecorded: () => Effect.die(new Error('No run is read here')), content: memoryLedger().service.content },
});

function prepared(source: string) {
  return Effect.runSync(onTheStandingClock(lookup.prepare(source)));
}

function refusalOf(source: string) {
  return Effect.runSync(Effect.exit(onTheStandingClock(lookup.prepare(source))));
}

const anObjectSchema: unknown = expect.objectContaining({ type: 'object' });

const anArraySchema: unknown = expect.objectContaining({ type: 'array' });

const theRunsAnswer: unknown = expect.objectContaining({ type: 'object', required: ['runs', 'more'] });

const plain = ['---', 'call:', '  server: chat', '  tool: thread', 'output:', '  schema: {}', '---', ''].join('\n');

describe('the lookup capability', () => {
  it('is the lookup function type, guided by its format, reaching outside and changing nothing there', () => {
    expect([
      lookup.type,
      lookup.title,
      lookup.guide,
      lookup.noun,
      lookup.mediaType,
      lookup.reachesOutside,
      lookup.mayChangeOutside,
      lookup.longestAnyRunMs,
      lookup.resumes,
    ]).toEqual([
      'lookup',
      'Lookup',
      { name: 'lookup-function' },
      { one: 'lookup function', other: 'lookup functions' },
      'text/markdown',
      true,
      false,
      70_000,
      false,
    ]);
  });

  it('prepares a definition that calls tools, finishes within its call, lets a call in flight end, and runs at most 70 seconds', () => {
    const definition = prepared(lookupDocument());

    expect([
      definition.callsTools,
      definition.finishesLaterFor({}),
      definition.whenCancelled,
      definition.longestRunMs,
    ]).toEqual([true, false, 'finish', 70_000]);
  });
});

describe('a lookup function that reads runs', () => {
  it('calls no tool, and is saved without asking any server', () => {
    const definition = prepared(runsDocument());

    expect([
      definition.callsTools,
      Effect.runSync(Effect.exit(definition.check({ org: 'acme', playbook: 'alpha' }))),
    ]).toEqual([false, Exit.succeed({})]);
  });

  it('is summed up with its fixed answer and the definition whose runs it reads', () => {
    expect(prepared(runsDocument()).summary).toEqual({
      description: 'Reads the paces computed for one campaign since a day, newest first',
      inputSchema: anObjectSchema,
      outputSchema: theRunsAnswer,
      details: { reads: [{ type: 'computation', name: 'campaign-pace' }] },
    });
  });

  it('says how many runs it examined and answered with, and whether it left older ones unread', () => {
    expect([
      lookup.describeOutput({ runs: [{}, {}], more: false }, { examined: 5, through: '2026-10-01T09:00:00.000Z' }),
      lookup.describeOutput({ runs: [{}], more: true }, { examined: 1, through: '2026-10-01T09:00:00.000Z' }),
    ]).toEqual([
      'It examined 5 runs that succeeded and answered with 2.',
      'It examined 1 run that succeeded and answered with 1; older runs are left unread.',
    ]);
  });
});

describe('the summary of a lookup function', () => {
  it('holds its description, its schemas and the tool it reads through', () => {
    expect(prepared(lookupDocument()).summary).toEqual({
      description: 'Read the replies of a thread in the team chat, oldest first',
      inputSchema: anObjectSchema,
      outputSchema: anArraySchema,
      details: { call: { server: 'chat', tool: 'thread' } },
    });
  });

  it('holds no description or input schema when it has neither', () => {
    expect(Object.keys(prepared(plain).summary)).toEqual(['outputSchema', 'details']);
  });
});

describe('what the lookup capability says', () => {
  it('refuses a document with its problems, each at its line', () => {
    expect([
      refusalOf(lookupDocument({ output: [] })),
      refusalOf(lookupDocument({ output: [], server: 'Chat' })),
    ]).toEqual([
      Exit.fail(
        expect.objectContaining({ _tag: 'invalid_input', detail: 'The lookup function definition has a problem' }),
      ),
      Exit.fail(expect.objectContaining({ detail: 'The lookup function definition has 2 problems' })),
    ]);
  });

  it('says what the tool answered, or the answer alone where no call is recorded', () => {
    const record = { server: 'chat', tool: 'thread', read: '/messages' };

    expect([lookup.describeOutput(['Shipped the fix'], record), lookup.describeOutput('Shipped the fix')]).toEqual([
      'It asked the thread tool of chat; its answer: “Shipped the fix”.',
      'Its answer: “Shipped the fix”.',
    ]);
  });
});
