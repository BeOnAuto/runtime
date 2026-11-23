import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { flow } from '../testing/capabilities/flow.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from '../testing/harness.ts';

const someWords: unknown = expect.any(String);

const anId: unknown = expect.any(String);

const { createDefinition, pauseDefinition, resumeDefinition, retireDefinition, runDefinition } =
  definitionOperationsFor([probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const plain = { type: 'probe', name: 'plain' };

const resumedPlain = {
  type: 'probe',
  name: 'plain',
  definition_id: anId,
  version: 1,
  status: 'active',
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
  source: 'text',
};

async function typesOfTheDefinitions({ ledger, run }: Harness) {
  const { records } = await run(
    Effect.orDie(
      ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'everything' },
        { order: 'asc', limit: 20 },
      ),
    ),
  );
  return records.filter(({ stream }) => stream.endsWith('definitions/probe')).map(({ type }) => type);
}

async function pausedPlain() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { ...plain, source: 'text' }));
  await definitions.call(pauseDefinition, toAlpha(adaOfAcme, { ...plain, reason: 'Closing the quarter' }), later);
  return definitions;
}

describe('resume_definition', () => {
  it('makes a paused definition active again at its version and its last change, forgetting who paused it, when and why', async () => {
    const { call } = await pausedPlain();

    expect(await call(resumeDefinition, toAlpha(acmeAdmin, plain), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: resumedPlain,
    });
    expect(await call(runDefinition, toAlpha(acmeAdmin, plain), muchLater)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded' },
    });
  });
});

describe('resume_definition repeated', () => {
  it('succeeds and records nothing for a definition that is not paused', async () => {
    const definitions = await pausedPlain();
    await definitions.call(resumeDefinition, toAlpha(acmeAdmin, plain), muchLater);

    expect(
      await definitions.call(resumeDefinition, toAlpha(acmeAdmin, plain), '2026-12-01T00:00:00.000Z'),
    ).toStrictEqual({ status: 'succeeded', output: resumedPlain });
    expect(await typesOfTheDefinitions(definitions)).toEqual([
      'definition_created',
      'definition_paused',
      'definition_resumed',
    ]);
  });

  it('is refused for a retired definition, and for one the playbook does not have', async () => {
    const { call } = await pausedPlain();
    await call(retireDefinition, toAlpha(acmeAdmin, plain), muchLater);

    expect([
      await call(resumeDefinition, toAlpha(acmeAdmin, plain)),
      await call(resumeDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'missing' })),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: someWords,
        kind: 'retired',
      },
      { status: 'rejected', reason: 'not_found', detail: 'There is no probe definition missing in this playbook' },
    ]);
  });
});

describe('a paused definition that is retired', () => {
  it('keeps no trace of its pause', async () => {
    const { call } = await pausedPlain();

    expect(await call(retireDefinition, toAlpha(acmeAdmin, plain), muchLater)).toStrictEqual({
      status: 'succeeded',
      output: { ...resumedPlain, status: 'retired', updated_at: muchLater, retired_at: muchLater },
    });
  });
});

describe('the plain language of pause_definition and resume_definition', () => {
  it('says the definition starts no runs until it is resumed, and that it can run again once it is', () => {
    const resumedAsAnswered = { ...resumedPlain, definition_id: 'id-of-plain' };
    const triggered = {
      ...resumedAsAnswered,
      triggers: [{ kind: 'every', reference: '/schedule/every', milliseconds: 60_000 }],
    };

    expect([
      pauseDefinition.registration.plainLanguage?.outcome({ ...resumedAsAnswered, status: 'paused' }, plain),
      resumeDefinition.registration.plainLanguage?.outcome(resumedAsAnswered, plain),
      resumeDefinition.registration.plainLanguage?.outcome(triggered, plain),
    ]).toEqual([
      expect.stringContaining('“plain”'),
      'Resumed the probe “plain”. It can be run again.',
      expect.stringContaining('“plain”'),
    ]);
  });

  it('names the definition it tried to pause or resume', () => {
    const attempts = [pauseDefinition, resumeDefinition].map(({ registration }) => [
      registration.plainLanguage?.attempt(plain),
      registration.plainLanguage?.attempt({}),
    ]);

    expect(attempts).toEqual([
      ['pause the probe “plain”', 'pause a probe'],
      ['resume the probe “plain”', 'resume a probe'],
    ]);
  });
});

const workflows = definitionOperationsFor([flow]);

const listingBookings = {
  tool: 'list_bookings',
  with: { after: '{{ since }}' },
  list: '/bookings',
  order: 'oldest_first',
  id: ['/id'],
};

const listingCancelled = { ...listingBookings, tool: 'list_cancelled_bookings' };

function checking(name: string, read: object, type = 'booking.created') {
  const source = JSON.stringify({ on: [{ type, source: '/connections/bookings', read }] });
  return { type: 'workflow', name, source };
}

async function besideOnBookings(): Promise<Harness> {
  const definitions = harness(undefined, undefined, { stage: 'off', folds: ['workflow'] });
  await definitions.call(workflows.createDefinition, toAlpha(acmeAdmin, checking('on-bookings', listingBookings)));
  return definitions;
}

async function pausedIn({ call }: Harness, written: Readonly<ReturnType<typeof checking>>): Promise<void> {
  await call(workflows.createDefinition, toAlpha(acmeAdmin, written));
  await call(workflows.pauseDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: written.name }), later);
}

const onCancelled = { type: 'workflow', name: 'on-cancelled' };

describe('resume_definition of a workflow whose trigger names a read', () => {
  it('is refused while another active workflow checks another read under its type through the connection, after a restore too', async () => {
    const definitions = await besideOnBookings();
    await pausedIn(definitions, checking('on-cancelled', listingCancelled));
    const { call } = definitions;
    const refused = await call(workflows.resumeDefinition, toAlpha(acmeAdmin, onCancelled), muchLater);
    await call(workflows.retireDefinition, toAlpha(acmeAdmin, onCancelled), muchLater);
    await call(workflows.restoreDefinition, toAlpha(acmeAdmin, onCancelled), muchLater);
    const refusedAfterARestore = await call(workflows.resumeDefinition, toAlpha(acmeAdmin, onCancelled), muchLater);

    expect([refused, refusedAfterARestore]).toEqual([
      { status: 'rejected', reason: 'conflict', detail: someWords },
      { status: 'rejected', reason: 'conflict', detail: someWords },
    ]);
  });

  it('resumes one that checks the same read under the same type, or another read under a type of its own', async () => {
    const definitions = await besideOnBookings();
    await pausedIn(definitions, checking('on-the-same', listingBookings));
    await pausedIn(definitions, checking('on-cancelled', listingCancelled, 'booking.cancelled'));
    const { call } = definitions;

    expect([
      await call(workflows.resumeDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'on-the-same' }), muchLater),
      await call(workflows.resumeDefinition, toAlpha(acmeAdmin, onCancelled), muchLater),
    ]).toMatchObject([
      { status: 'succeeded', output: { status: 'active' } },
      { status: 'succeeded', output: { status: 'active' } },
    ]);
  });
});
