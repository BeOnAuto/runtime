import { describe, expect, it } from 'vitest';

import { playbookWithTheWorkflow, workflowWithItsPage } from '../testing/page-playbooks.ts';

const workflow = { type: 'workflow', name: 'morning-social-content' };

const countingTheWaiting = workflowWithItsPage("result: '{{ output.greeting }}: {{ output.waiting }} waiting'");

const greetingOnly = workflowWithItsPage("result: '{{ output.greeting }} from the first page'");

function runIdOf(outcome: { readonly status: string; readonly output?: unknown }): string {
  return String(Reflect.get(new Object(outcome.output), 'run_id'));
}

describe('the result of a run on the page of its own version', () => {
  it('renders a run of a version without a page as a run without a page, though a later version has one', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow();
    await ready;
    const first = await running({ ...workflow, input: {} });
    await updating({ ...workflow, source: countingTheWaiting });

    const answered = await rendering({ ...workflow, run_id: runIdOf(first) });

    expect(answered).toMatchObject({ status: 'succeeded' });
    expect(answered).not.toHaveProperty('output.page.result');
    expect(JSON.stringify(answered)).not.toContain('has no field');
  });

  it('renders the latest run, when it ran an earlier version, as that version shows it', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow();
    await ready;
    await running({ ...workflow, input: {} });
    await updating({ ...workflow, source: countingTheWaiting });

    const answered = await rendering(workflow);

    expect(answered).not.toHaveProperty('output.page.result');
  });
});

describe('the result of a run on the page its version had', () => {
  it('renders a run on the page its version had, not on a later one', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: greetingOnly });
    const second = await running({ ...workflow, input: {} });
    await updating({ ...workflow, source: countingTheWaiting });

    expect(await rendering({ ...workflow, run_id: runIdOf(second) })).toMatchObject({
      output: { page: { result: 'Good morning from the first page' } },
    });
  });

  it('renders a run of the version that holds the page on that page', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: workflowWithItsPage("result: '{{ output.greeting }} now'") });
    const ran = await running({ ...workflow, input: {} });

    expect(await rendering({ ...workflow, run_id: runIdOf(ran) })).toMatchObject({
      output: { page: { result: 'Good morning now' } },
    });
  });

  it('keeps the version it ran even when the definition was saved again unchanged in its page', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: greetingOnly });
    const ran = await running({ ...workflow, input: {} });
    await updating({ ...workflow, source: `${greetingOnly}# again\n` });

    expect(await rendering({ ...workflow, run_id: runIdOf(ran) })).toMatchObject({
      output: { page: { result: 'Good morning from the first page' } },
    });
  });

  it('reads the output of a run whose own page names it, though the page now does not', async () => {
    const { updating, rendering, running, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: greetingOnly });
    await running({ ...workflow, input: {} });
    await updating({ ...workflow, source: workflowWithItsPage("result: 'Nothing to show'") });

    expect(await rendering(workflow)).toMatchObject({
      output: { page: { result: 'Good morning from the first page' } },
    });
  });
});
