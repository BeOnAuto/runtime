import { describe, expect, it } from 'vitest';

import {
  foldingNothing,
  functionWithItsPage,
  greeting,
  runsOfTheDays,
  pageOfTheDays,
  playbookWithTheWorkflow,
  resultOfTheGreeting,
  workflowWithItsPage,
} from '../testing/page-playbooks.ts';

const workflow = { type: 'workflow', name: 'morning-social-content' };

const evening = { type: 'workflow', name: 'evening-posts' };

const review = { type: 'reasoning', name: 'review-brief' };

describe('saving a definition with its page', () => {
  it('keeps the page in its document, one version of the definition, and answers nothing of the page', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;
    const source = workflowWithItsPage(pageOfTheDays);

    const saved = await saving({ ...evening, source });

    expect(saved).toMatchObject({ status: 'succeeded', output: { name: 'evening-posts', version: 1, source } });
    expect(saved).not.toHaveProperty('output.page');
    expect(await reading(evening)).toMatchObject({ output: { version: 1, source } });
  });

  it("reads a function's page from its front matter, and no page from a document without the key", async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ ...review, source: functionWithItsPage(pageOfTheDays), diagram: 'none' });

    expect(await reading(review)).toMatchObject({
      output: { page: { runs: "Building this page's figures from the playbook's history…" } },
    });
    expect(await reading(workflow)).not.toHaveProperty('output.page');
  });

  it('saves neither where the page does not fit its format, whose problems are under /source with their lines', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;

    const refused = await saving({ ...evening, source: workflowWithItsPage(`${foldingNothing}\nmodel: fast`) });

    expect(refused).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/source' }] });
    expect(await reading(evening)).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});

describe('changing the page of a definition', () => {
  it('saves a new version of the definition, and the same document records nothing', async () => {
    const { updating, ready } = playbookWithTheWorkflow();
    await ready;
    const source = workflowWithItsPage(resultOfTheGreeting);

    expect(await updating({ ...workflow, source })).toMatchObject({ status: 'succeeded', output: { version: 2 } });
    expect(await updating({ ...workflow, source })).toMatchObject({ status: 'succeeded', output: { version: 2 } });
  });

  it('removes the page with a document without it, or with an empty page', async () => {
    const { updating, reading, rendering, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: workflowWithItsPage(pageOfTheDays) });

    await updating({ ...workflow, source: workflowWithItsPage('{}') });
    const emptied = await reading(workflow);
    await updating({ ...workflow, source: workflowWithItsPage(pageOfTheDays) });
    await updating({ ...workflow, source: greeting });

    expect(emptied).not.toHaveProperty('output.page');
    expect(await reading(workflow)).not.toHaveProperty('output.page');
    expect(await rendering(workflow)).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});

describe('retiring a definition with a page', () => {
  it('retires its page with it: the definition answers no page, and its preview is refused', async () => {
    const { saving, retiring, reading, rendering, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ ...evening, source: workflowWithItsPage(`${foldingNothing}\n${runsOfTheDays}`) });

    const retired = await retiring(evening);

    expect(retired).toMatchObject({ status: 'succeeded', output: { status: 'retired' } });
    expect(retired).not.toHaveProperty('output.page');
    expect(await reading(evening)).not.toHaveProperty('output.page');
    expect(await rendering(evening)).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'retired' });
  });
});
