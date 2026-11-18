import { PlaybookContext, playbookLedgerOf, type PlaybookAddress } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { bookOf, controls, experiments, sales, type Book } from '../assessor/assessor-ledger.ts';
import { goalsReadWith } from '../reads/get-playbook-goals.ts';
import { goalsOperationsServed } from '../reads/goals-operations.ts';
import { serverConnectedThrough, type ServerConnected } from './goal-connections.ts';

const created = { created_by: { id: 'person:owner', name: 'Owner' }, playbook: sales.playbook };

function calling(...calls: readonly (readonly [string, string])[]) {
  return { calls: calls.map(([type, name]) => ({ type, name, steps: [{ number: 1, name: 'step' }] })) };
}

interface Saved {
  readonly type: string;
  readonly name: string;
  readonly front: string;
  readonly details?: Schema.Json;
}

function functionSaved(book: Book, { type, name, front, details = {} }: Saved) {
  return book.definitionChanged(
    { type, name },
    'definition_created',
    { content: { source: `---\n${front}\n---\nDoes its part.`, details }, ...created },
    { definitionType: type, definitionName: name, definitionVersion: 1 },
  );
}

function workflowSaved(book: Book, name: string, goal: string, details = {}) {
  const contributes = [{ goal, purpose: 'Does its part.', per_id: '/id', measures: '/n' }];
  return book.definitionChanged(
    { type: 'workflow', name },
    'definition_created',
    { content: { source: `document: ${name}\n`, details: { ...details, contributes } }, ...created },
    { definitionType: 'workflow', definitionName: name, definitionVersion: 1 },
  );
}

async function playbookWithTwoGoals() {
  const book = bookOf();
  await book.goalsSaved([experiments, controls]);
  await functionSaved(book, {
    type: 'interaction',
    name: 'tell-owner',
    front: 'deliver:\n  server: chat\n  tool: post',
  });
  await functionSaved(book, {
    type: 'lookup',
    name: 'customer-rows',
    front: 'call:\n  server: crm-api\n  tool: rows',
    details: calling(['interaction', 'tell-owner']),
  });
  await workflowSaved(book, 'track-customers', experiments.id, calling(['lookup', 'customer-rows']));
  await workflowSaved(book, 'check-controls', controls.id);
  return book;
}

const connectedOnly =
  (...servers: readonly string[]): ServerConnected =>
  (_address, server) =>
    Effect.succeed(servers.includes(server));

function readOf(book: Book, connected?: ServerConnected) {
  return Effect.runPromise(
    goalsReadWith(undefined, connected).pipe(
      Effect.provideService(PlaybookContext, sales),
      Effect.provide(playbookLedgerOf(book.ledger, sales)),
    ),
  );
}

describe('the connections of a goal', () => {
  it('lists every server its workflows and the functions they call use, and whether each is connected', async () => {
    const book = await playbookWithTwoGoals();

    const [tracked, checked] = (await readOf(book, connectedOnly('crm-api'))).goals;

    expect(tracked?.connections).toEqual([
      { server: 'chat', name: 'chat', connected: false, workflows: ['track-customers'] },
      { server: 'crm-api', name: 'crm-api', connected: true, workflows: ['track-customers'] },
    ]);
    expect(checked?.connections).toEqual([]);
  });

  it('makes a missing one a gap the person closes, and none where every server is connected', async () => {
    const book = await playbookWithTwoGoals();

    const missing = (await readOf(book, connectedOnly('crm-api'))).goals[0]?.gaps.filter(
      ({ kind }) => kind === 'connection_missing',
    );
    const connected = (await readOf(book, connectedOnly('crm-api', 'chat'))).goals[0]?.gaps;

    expect(missing).toEqual([
      {
        kind: 'connection_missing',
        goal: experiments.id,
        detail:
          'Ask the person to connect chat in Studio. The workflow track-customers of the goal paying-customers uses chat, which is not connected, or not offered to this playbook. Only the person can connect it; nothing you save fixes it.',
        fixed_by: 'person',
        ask: 'Connect chat in Studio',
      },
    ]);
    expect(connected?.some(({ kind }) => kind === 'connection_missing')).toBe(false);
  });

  it('is left out where the runtime cannot tell, and where it is not asked', async () => {
    const book = await playbookWithTwoGoals();

    const failing = await readOf(book, () => Effect.die(new Error('The connections could not be read')));
    const unasked = await readOf(book);

    expect(failing.goals[0]).not.toHaveProperty('connections');
    expect(unasked.goals[0]).not.toHaveProperty('connections');
  });
});

describe('a server two workflows of a goal use', () => {
  it('names both in its connection and in its gap', async () => {
    const book = await playbookWithTwoGoals();
    await workflowSaved(book, 'welcome-customers', experiments.id, calling(['interaction', 'tell-owner']));

    const [tracked] = (await readOf(book, connectedOnly('crm-api'))).goals;

    expect(tracked?.connections?.[0]).toEqual({
      server: 'chat',
      name: 'chat',
      connected: false,
      workflows: ['track-customers', 'welcome-customers'],
    });
    expect(tracked?.gaps.find(({ kind }) => kind === 'connection_missing')?.detail).toContain(
      'The workflows track-customers and welcome-customers of the goal paying-customers use chat,',
    );
  });
});

describe('the servers of two workflows of a goal', () => {
  it('are listed by the server, whichever workflow comes first', async () => {
    const book = await playbookWithTwoGoals();
    await functionSaved(book, { type: 'lookup', name: 'ticket-rows', front: 'call:\n  server: tickets\n  tool: rows' });
    await workflowSaved(book, 'audit-customers', experiments.id, calling(['lookup', 'ticket-rows']));

    const [tracked] = (await readOf(book, connectedOnly('crm-api'))).goals;

    expect(tracked?.connections?.map(({ server, workflows }) => [server, workflows])).toEqual([
      ['chat', ['track-customers']],
      ['crm-api', ['track-customers']],
      ['tickets', ['audit-customers']],
    ]);
  });
});

describe('a server connected, as the tool access names it', () => {
  it('is connected when the access offers every tool of it to the playbook, and not when it refuses', async () => {
    const asked: (readonly [PlaybookAddress, unknown])[] = [];
    const offering = serverConnectedThrough({
      named: (address, references) => Effect.sync(() => asked.push([address, references])),
    });
    const refusing = serverConnectedThrough({ named: () => Effect.fail('tool_server_not_configured') });

    expect(await Effect.runPromise(Effect.all([offering(sales, 'chat'), refusing(sales, 'crm-api')]))).toEqual([
      true,
      false,
    ]);
    expect(asked).toEqual([[sales, [{ server: 'chat', tool: '*' }]]]);
  });
});

describe('the goals read served with the connections', () => {
  it('is get_playbook_goals, judged or not', () => {
    const connected = connectedOnly();

    expect(
      [
        goalsOperationsServed(true, true, true, { connected }),
        goalsOperationsServed(true, false, true, { connected }),
      ].map(([read]) => read?.registration.name),
    ).toEqual(['get_playbook_goals', 'get_playbook_goals']);
  });
});
