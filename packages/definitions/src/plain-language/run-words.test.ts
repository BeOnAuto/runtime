import type { RouteRegistration } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { makeDefinitionOperations } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { probe } from '../testing/probe.ts';
import { relay } from '../testing/relay.ts';

const relaying = relay().capability;

const operations = makeDefinitionOperations([echo, probe().capability, relaying]);

function registrationOf(name: string): RouteRegistration {
  const found = operations.find(({ registration }) => registration.name === name);
  if (found === undefined) {
    throw new Error(`There is no operation ${name}`);
  }
  return found.registration;
}

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = {
  run_id: runId,
  type: 'echo',
  name: 'greet',
  definition_version: 1,
  status: 'succeeded',
  output: { greeting: 'Hello' },
  started_at: '2026-10-02T09:00:00.000Z',
  started_by: 'acme-admin',
  finished_at: '2026-10-02T09:00:01.000Z',
};

const running = { type: 'echo', name: 'greet' };

function ran(answer: Readonly<Record<string, unknown>>): string | undefined {
  return registrationOf('run_definition').plainLanguage?.outcome(answer, running);
}

function lookedUp(answer: Readonly<Record<string, unknown>>): string | undefined {
  return registrationOf('get_run').plainLanguage?.outcome(answer, { run_id: runId });
}

const withoutOutput = Object.fromEntries(
  Object.entries(run).filter(([key]: readonly [string, unknown]) => key !== 'output'),
);

describe('the plain language of run_definition', () => {
  it('says the definition ran and what came back, in the words of its capability', () => {
    expect(ran(run)).toBe('Ran the greeting “greet”. It answered with its greeting.');
  });

  it('says a run that goes on after the call has started and carries on', () => {
    expect(ran({ ...withoutOutput, type: 'relay', name: 'pass', status: 'started' })).toBe(
      'The relay “pass” has started and is still running. It carries on by itself, and how it ends can be looked up later.',
    );
  });

  it('names the definition it tried to run, or what it tried', () => {
    expect([
      registrationOf('run_definition').plainLanguage?.attempt(running),
      registrationOf('run_definition').plainLanguage?.attempt({}),
    ]).toEqual(['run the greeting “greet”', 'run a greeting, probe, or relay']);
  });
});

const rejections: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>, string]> = [
  [
    'input it did not accept',
    { reason: 'invalid_input', detail: 'x', issues: [] },
    'what was given does not fit what it needs. This can be corrected and tried again; the details below say what to change.',
  ],
  [
    'an input its input schema refused',
    { reason: 'invalid_input', kind: 'input_schema', detail: 'x', issues: [] },
    'what was given does not fit what it needs. This can be corrected and tried again; the details below say what to change.',
  ],
  [
    'something it relies on that was not available',
    { reason: 'unavailable', detail: 'x' },
    'something the server relies on is not available right now. Only whoever runs the server can put this right, so there is nothing to change on your side; once they have, it can be tried again. Meanwhile, everything that does not need it still works.',
  ],
  [
    'a model the server does not offer, without saying why',
    { reason: 'unavailable', detail: 'x', kind: 'model_not_offered' },
    'this server does not offer the model named. This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.',
  ],
  [
    'a model of a provider the server is not set up for, while it can use others',
    { reason: 'unavailable', detail: 'x', kind: 'model_not_offered', because: 'provider_not_configured' },
    'this server does not offer the model named, because its provider is not set up on this server, though others are. This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.',
  ],
  [
    'a model outside those whoever runs the server allows',
    { reason: 'unavailable', detail: 'x', kind: 'model_not_offered', because: 'model_not_allowed' },
    'this server does not offer the model named, because it is not among the models whoever runs the server allows. This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.',
  ],
  [
    'a definition it could not run as written',
    { reason: 'conflict', detail: 'x', kind: 'unworkable' },
    'it cannot work as it is written. This can be corrected and tried again; the details below say what to change.',
  ],
  [
    'a clash that names no kind',
    { reason: 'conflict', detail: 'x' },
    'it clashes with something already there. The details below say what is in the way.',
  ],
  [
    'a workflow whose result was larger than a run may record',
    { reason: 'conflict', detail: 'x', kind: 'oversized' },
    'its result is larger than a run may record. This can be put right on your side: once its result keeps only what is needed, such as fewer or smaller values, it can be run again.',
  ],
  [
    'a run cancelled because the step that waited for it ran out of time',
    { reason: 'cancelled', detail: 'x', kind: 'deadline' },
    'the step that waited for it ran out of time, so it was cancelled. Nothing more of it runs, but what it did before may have changed something; the step that waited for it decides what happens next.',
  ],
  [
    'a step that met a run whose tools may have been called',
    { reason: 'conflict', detail: 'x', kind: 'tools_called' },
    'this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something. So it was not run again: start a new run instead, after checking what its history shows it has called so far.',
  ],
];

describe('the plain language of get_run', () => {
  it('says how a run ended and what came back', () => {
    expect(lookedUp(run)).toBe('The run of the greeting “greet” finished. It answered with its greeting.');
  });

  it('says a run is still going', () => {
    expect(lookedUp({ ...withoutOutput, status: 'started' })).toBe(
      'The greeting “greet” is still running; how it ends can be looked up again later.',
    );
  });

  it.each(rejections)('says a run did not go through for %s, and what can be done', (_case, rejection, words) => {
    expect(lookedUp({ ...withoutOutput, status: 'rejected', rejection })).toBe(
      `The run of the greeting “greet” did not go through: ${words}`,
    );
  });

  it('says a run that broke down was not the person’s doing', () => {
    expect(lookedUp({ ...withoutOutput, status: 'failed' })).toBe(
      'The run of the greeting “greet” broke down because of a problem inside the server; it was not caused by anything you did.',
    );
  });

  it('points to the details for a result it has no words for', () => {
    expect([
      lookedUp({ ...run, type: 'gone' }),
      lookedUp(withoutOutput),
      lookedUp({ ...withoutOutput, status: 'rejected' }),
    ]).toEqual([
      'The run of the item “greet” finished. Its result is in the details below.',
      'The run of the greeting “greet” finished. Its result is in the details below.',
      'The run of the greeting “greet” did not go through: it cannot work as it is written. This can be corrected and tried again; the details below say what to change.',
    ]);
  });

  it('says what it tried', () => {
    expect([
      registrationOf('get_run').plainLanguage?.attempt({ run_id: runId }),
      registrationOf('get_run').plainLanguage?.attempt({}),
    ]).toEqual(['look up the run', 'look up a run']);
  });
});

describe('the words of the test capabilities for what came back', () => {
  it('are a sentence each', () => {
    expect([probe().capability.describeOutput(null), relaying.describeOutput(null)]).toEqual([
      'It answered.',
      'It handed its input on.',
    ]);
  });
});
