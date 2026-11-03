import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeptViewState } from '../capability/view-standing.ts';
import { defineRenderPage } from '../operations/render-page.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toPlaybook } from '../testing/harness.ts';
import {
  foldingNothing,
  greeting,
  pageOfTheDays,
  playbookWithTheWorkflow,
  resultOfTheGreeting,
  workflowWithItsPage,
} from '../testing/page-playbooks.ts';
import { keepingTheViews, uncheckedPages } from '../testing/page-ports.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';
import { viewsBeingBuilt, viewsOutOfReach } from './page-rendering.ts';

const greetingPage = workflowWithItsPage(resultOfTheGreeting);

const daysPage = workflowWithItsPage(pageOfTheDays);

const liveDays: KeptViewState = {
  version: 2,
  phase: 'live',
  view: { by_day: { period: 'day', lines: [{ name: 'Posts', points: [{ at: '2026-10-31', value: 3 }] }] } },
  checkpoint: 'cursor',
  checkpointAt: '2026-11-01T09:00:00.000Z',
  lastEvent: null,
  folded: 1,
};

function runIdOf(outcome: { readonly status: string; readonly output?: unknown }): string {
  return String(Reflect.get(new Object(outcome.output), 'run_id'));
}

const workflow = { type: 'workflow', name: 'morning-social-content' };

const lastMonth: KeptViewState = {
  ...liveDays,
  view: { by_day: { period: 'day', lines: [{ name: 'Posts', points: [] }] } },
  checkpointAt: '2026-10-01T09:00:00.000Z',
};

const askingTheDay = workflowWithItsPage(`${foldingNothing}\nlately: |\n  {{ today }}`);

describe('the preview of a page as of a run', () => {
  it('answers the run’s result, and lately and standing over the views as they stood', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays, lastMonth));
    await ready;
    await updating({ ...workflow, source: daysPage });
    const ran = await running({ ...workflow, input: {} });

    expect(await rendering({ ...workflow, run_id: runIdOf(ran) })).toMatchObject({
      output: {
        page: {
          result: 'Good morning',
          lately: '0 days',
          standing: { state: 'live', checkpoint_at: lastMonth.checkpointAt, folded: 1 },
        },
      },
    });
  });

  it('renders lately at the moment of the run', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays, lastMonth));
    await ready;
    await updating({ ...workflow, source: askingTheDay });
    const ran = await running({ ...workflow, input: {} });

    expect(await rendering({ ...workflow, run_id: runIdOf(ran) })).toMatchObject({
      output: { page: { lately: '2026-10-01' } },
    });
  });

  it('says so in place of lately, with the standing out of reach, past the bound of a replay', async () => {
    const outOfReach = { ...lastMonth, phase: 'out_of_reach', checkpointAt: null } satisfies KeptViewState;
    const { updating, rendering, running, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays, outOfReach));
    await ready;
    await updating({ ...workflow, source: daysPage });
    const ran = await running({ ...workflow, input: {} });

    expect(await rendering({ ...workflow, run_id: runIdOf(ran) })).toMatchObject({
      output: {
        page: {
          result: 'Good morning',
          lately: viewsOutOfReach,
          standing: { state: 'out_of_reach', version: 2 },
        },
      },
    });
  });
});

describe('the preview of a page as of a run whose views it cannot replay', () => {
  it('says the views are being built where the replay finds no view', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: daysPage });
    const ran = await running({ ...workflow, input: {} });

    expect(await rendering({ ...workflow, run_id: runIdOf(ran) })).toMatchObject({
      output: { page: { lately: viewsBeingBuilt, standing: { state: 'rebuilding' } } },
    });
  });

  it('reads no views for a page without data', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays, lastMonth));
    await ready;
    await updating({ ...workflow, source: greetingPage });
    const ran = await running({ ...workflow, input: {} });
    const answered = await rendering({ ...workflow, run_id: runIdOf(ran) });

    expect(answered).toMatchObject({ output: { page: { result: 'Good morning from version 2' } } });
    expect(answered).not.toHaveProperty('output.page.standing');
    expect(answered).not.toHaveProperty('output.page.lately');
  });
});

describe('the preview of a page as of a run that is still going, or that it refuses', () => {
  it('renders over the views as they stand for a run still going', async () => {
    const { relayer, running, call } = await withHandOn();
    await running();
    const page = { source: '', version: 1, details: {} };
    const renderPage = defineRenderPage([relayer.capability], {
      ...uncheckedPages,
      pageOf: () => Effect.succeed(page),
      resultOf: () => Effect.undefined,
      viewsOf: () => Effect.succeed({ lately: 'As the views stand' }),
    });

    expect(
      await call(
        renderPage,
        toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'relay', name: 'hand-on', run_id: relayedId }),
      ),
    ).toMatchObject({ output: { page: { lately: 'As the views stand' } } });
  });

  it('refuses a run of another definition, one the playbook does not have, and run_id beside sample_output', async () => {
    const { updating, rendering, running, saving, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    await updating({ ...workflow, source: daysPage });
    await saving({ type: 'workflow', name: 'evening-social-content', source: greeting });
    const other = await running({ type: 'workflow', name: 'evening-social-content', input: {} });
    const ran = await running({ ...workflow, input: {} });

    expect(await rendering({ ...workflow, run_id: runIdOf(other) })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/run_id' }],
    });
    expect(await rendering({ ...workflow, run_id: 'd3f7e6a0-0000-4000-8000-000000000001' })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
    expect(await rendering({ ...workflow, run_id: runIdOf(ran), sample_output: {} })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/run_id' }],
    });
  });
});
