import { Ledger } from '@on.auto/operations';
import { goalsWantedWordsOf } from '@on.auto/playbooks';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../../testing/servers/reasoning-server.ts';
import {
  createdWithGoals,
  goalsText,
  goalsTextGaps,
  restatedGoalsText,
  servingReasoningWithGoals,
} from '../../testing/settings/goals-kept.ts';

const playbooks = '/v1/orgs/acme/playbooks';

const aShapeThatCannotChange = goalsText.replace('  per: experiment\n', '');

const page = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '  views:',
  '    runs: categories',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      return { runs: { values: [...(view.runs?.values ?? []), { name: event.type, value: 1 }] } };',
  '    }',
  "runs: '{{ views.runs.values | size }} runs.'",
].join('\n');

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function serving(ledgerOver?: (ledger: Ledger['Service']) => Ledger['Service']): Promise<ReasoningServer> {
  server = await servingReasoningWithGoals([], {}, undefined, ledgerOver === undefined ? {} : { ledgerOver });
  return server;
}

function cuttingTheFirstGoalsWrite(ledger: Ledger['Service']): Ledger['Service'] {
  let cut = false;
  return Ledger.of({
    ...ledger,
    execute: (stream, decider, command, lineage) => {
      if (cut || !stream.endsWith('/goals/playbook')) {
        return ledger.execute(stream, decider, command, lineage);
      }
      cut = true;
      return Effect.die(new Error('The ledger stopped before the goals were written'));
    },
  });
}

const savedGoals = { source: goalsText, version: 1, gaps: goalsTextGaps };

describe('create_playbook on a server that keeps goals', () => {
  it('is refused without goals, with the question for the person, and creates nothing', async () => {
    const { call } = await serving();

    const refused = await call('POST', playbooks, { body: { playbook: 'alpha', name: 'Alpha' } });

    expect(refused).toMatchObject({ status: 422, body: { detail: goalsWantedWordsOf(true) } });
    expect(await call('GET', alpha)).toMatchObject({ status: 404 });
  });

  it('creates the playbook with its goals in its own ledger, which get_playbook then reads', async () => {
    const { call } = await serving();

    const created = await createdWithGoals({ call });

    expect(created).toMatchObject({ status: 201, body: { id: 'alpha', goals: savedGoals } });
    expect(await call('GET', alpha)).toMatchObject({ status: 200, body: { id: 'alpha', goals: savedGoals } });
  });

  it('refuses goals the check refuses, and creates nothing', async () => {
    const { call } = await serving();

    const refused = await call('POST', playbooks, {
      body: { playbook: 'alpha', name: 'Alpha', goals: '- id: first-customer\n' },
    });

    expect(refused).toMatchObject({ status: 422 });
    expect(await call('GET', alpha)).toMatchObject({ status: 404 });
  });

  it('repairs a create whose goals were cut when the same caller creates it again', async () => {
    const { call } = await serving(cuttingTheFirstGoalsWrite);

    expect(await createdWithGoals({ call })).toMatchObject({ status: 500 });
    expect(await call('GET', alpha)).toMatchObject({
      status: 200,
      body: { goals: { gaps: [{ kind: 'no_goal', fixed_by: 'person' }] } },
    });
    expect(await createdWithGoals({ call })).toMatchObject({ status: 201, body: { goals: savedGoals } });
    expect(await createdWithGoals({ call })).toMatchObject({ status: 409 });
  });
});

async function made(): Promise<ReasoningServer> {
  const madeOne = await serving();
  await createdWithGoals(madeOne);
  return madeOne;
}

describe('update_playbook on a server that keeps goals', () => {
  it('saves the page and the goals together, as a new version of the goals', async () => {
    const { call } = await made();

    const updated = await call('PUT', alpha, { body: { name: 'Shop', page, goals: restatedGoalsText } });

    expect(updated).toMatchObject({
      status: 200,
      body: {
        name: 'Shop',
        page: { source: page },
        goals: { source: restatedGoalsText, version: 2, gaps: goalsTextGaps },
      },
    });
  });

  it('changes nothing when the goals change a shape that cannot change', async () => {
    const { call } = await made();

    const refused = await call('PUT', alpha, { body: { name: 'Shop', page, goals: aShapeThatCannotChange } });

    expect(refused).toMatchObject({ status: 422, body: { errors: [{ pointer: '/goals/0/per' }] } });
    const read = await call('GET', alpha);
    expect(read).toMatchObject({ status: 200, body: { name: 'Alpha', goals: savedGoals } });
    expect(read.body).not.toHaveProperty('page');
  });

  it('answers the page and the goals as they stand when only the name changes', async () => {
    const { call } = await made();
    await call('PUT', alpha, { body: { page } });

    expect(await call('PUT', alpha, { body: { name: 'Shop' } })).toMatchObject({
      status: 200,
      body: { name: 'Shop', page: { source: page }, goals: savedGoals },
    });
  });

  it('removes the page beside goals that are unchanged', async () => {
    const { call } = await made();
    await call('PUT', alpha, { body: { page } });

    const updated = await call('PUT', alpha, { body: { page: null, goals: goalsText } });

    expect(updated).toMatchObject({ status: 200, body: { goals: savedGoals } });
    expect(updated.body).not.toHaveProperty('page');
  });
});

describe('a refused page on a server that keeps goals', () => {
  it('changes nothing when the page is refused beside goals the check takes', async () => {
    const { call } = await made();

    const refused = await call('PUT', alpha, {
      body: { name: 'Shop', page: `${page}\nresult: Ran.`, goals: restatedGoalsText },
    });

    expect(refused).toMatchObject({ status: 422, body: { errors: [{ pointer: '/page' }] } });
    const read = await call('GET', alpha);
    expect(read).toMatchObject({ status: 200, body: { name: 'Alpha', goals: savedGoals } });
    expect(read.body).not.toHaveProperty('page');
  });
});
