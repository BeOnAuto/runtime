import { readFileSync } from 'node:fs';

import { Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { answering, servingPages } from '../testing/servers/page-server.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const pageFormat = readFileSync(new URL('../../../../docs/reference/page-format.md', import.meta.url), 'utf8');

const documentedPage = String(pageFormat.split('\n````markdown\n')[1]?.split('\n````\n')[0]);

const draftsPage = `${documentedPage.replaceAll('workflow/morning-social-content', 'reasoning/draft-posts')}\n`;

const draftPosts = [
  '---',
  'description: Drafts the posts of the morning',
  'model: anthropic/claude-sonnet-4-5',
  'output:',
  '  format: json',
  '  schema: {type: object}',
  '---',
  'Draft the posts of the morning.',
].join('\n');

const morning = {
  date: '2026-11-01',
  posts: [
    { channel: 'LinkedIn', title: 'Three things our support team learned', url: 'https://example.com/drafts/1041' },
    { channel: 'X', title: 'October in one number', url: 'https://example.com/drafts/1042' },
  ],
};

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const decodeStanding = Schema.decodeUnknownOption(
  Schema.Struct({ standing: Schema.Struct({ state: Schema.String, folded: Schema.Number }) }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function playbookWithThePage(): Promise<string> {
  server = await servingPages(answering(morning));
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'draft-posts', source: draftPosts, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/page`, { body: { name: 'morning-posts', source: draftsPage } });
  const ran = await server.call('POST', `${alpha}/definitions/reasoning/draft-posts/run`, { body: { input: {} } });
  await until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/page/morning-posts`);
    expect(Option.getOrUndefined(decodeStanding(body))?.standing).toEqual({ state: 'live', folded: 1 });
  });
  return decodeRun(ran.body).run_id;
}

describe('a page over HTTP', () => {
  it('shows a run of its subject as page.result on the run, and its views as page.lately on the subject', async () => {
    const run = await playbookWithThePage();

    const read = await server.call('GET', `${alpha}/runs/${run}`);
    const subject = await server.call('GET', `${alpha}/definitions/reasoning/draft-posts`);

    expect(read.body).toMatchObject({
      page: {
        result: [
          '2 posts drafted for 2026-11-01.',
          '',
          '- [LinkedIn: Three things our support team learned](https://example.com/drafts/1041)',
          '- [X: October in one number](https://example.com/drafts/1042)',
        ].join('\n'),
      },
    });
    expect(JSON.stringify(subject.body)).toContain(
      JSON.stringify('Since it began, the workflow has drafted 2 posts across 2 channels.\n\n```chart line\n').slice(
        1,
        -1,
      ),
    );
  });

  it('renders the page at its own route, over a sample output, and refuses to run it', async () => {
    await playbookWithThePage();

    const rendered = await server.call('POST', `${alpha}/definitions/page/morning-posts/render`, {
      body: { sample_output: { date: '2026-11-02', posts: [] } },
    });
    const ran = await server.call('POST', `${alpha}/definitions/page/morning-posts/run`, { body: { input: {} } });

    expect(rendered).toMatchObject({
      status: 200,
      body: {
        type: 'page',
        details: { of: 'reasoning/draft-posts' },
        page: { result: '0 posts drafted for 2026-11-02.' },
      },
    });
    expect(ran).toMatchObject({
      status: 422,
      body: {
        errors: [{ pointer: '/type', detail: 'A page never runs: run its subject, and read the run with get_run' }],
      },
    });
  });
});
