import { Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { answering, servingPages } from '../testing/servers/page-server.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const pageData = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '        subject: reasoning/draft-posts',
  '  views:',
  '    by_channel: categories',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  "      const output = typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data) ? event.data['output'] : undefined;",
  "      const posts = typeof output === 'object' && output !== null && !Array.isArray(output) ? output['posts'] : undefined;",
  '      const count = Array.isArray(posts) ? posts.length : 0;',
  "      return { by_channel: { unit: 'posts', values: [...(view.by_channel?.values ?? []), { name: 'All', value: count }] } };",
  '    }',
];

const runs = 'runs: \'Since it began, {{ views.by_channel.values | sum: "value" }} posts were drafted.\'';

const result = [
  'result: |',
  '  {{ output.posts | size }} posts drafted for {{ output.date }}.',
  '',
  '  {% for post in output.posts -%}',
  '  - [{{ post.channel }}: {{ post.title }}]({{ post.url }})',
  '  {% endfor %}',
];

function indented(lines: readonly string[]): readonly string[] {
  return lines.map((line) => (line === '' ? line : `  ${line}`));
}

function draftPostsWith(page: readonly string[]): string {
  return [
    '---',
    'description: Drafts the posts of the morning',
    'model: anthropic/claude-sonnet-4-5',
    'output:',
    '  format: json',
    '  schema: {type: object}',
    ...(page.length === 0 ? [] : ['page:', ...indented(page)]),
    '---',
    'Draft the posts of the morning.',
  ].join('\n');
}

const draftPosts = draftPostsWith([...pageData, ...result, runs]);

const playbookPage = [...pageData, runs].join('\n');

const morning = {
  date: '2026-11-01',
  posts: [
    { channel: 'LinkedIn', title: 'Three things our support team learned', url: 'https://example.com/drafts/1041' },
    { channel: 'X', title: 'October in one number', url: 'https://example.com/drafts/1042' },
  ],
};

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const decodeStanding = Schema.decodeUnknownOption(
  Schema.Struct({ page: Schema.Struct({ standing: Schema.Struct({ state: Schema.String, folded: Schema.Number }) }) }),
);

const draftPostsAt = `${alpha}/definitions/reasoning/draft-posts`;

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
  const ran = await server.call('POST', `${draftPostsAt}/run`, { body: { input: {} } });
  await until(async () => {
    const { body } = await server.call('GET', draftPostsAt);
    expect(Option.getOrUndefined(decodeStanding(body))?.page.standing).toEqual({ state: 'live', folded: 1 });
  });
  return decodeRun(ran.body).run_id;
}

const drafted = [
  '2 posts drafted for 2026-11-01.',
  '',
  '- [LinkedIn: Three things our support team learned](https://example.com/drafts/1041)',
  '- [X: October in one number](https://example.com/drafts/1042)',
].join('\n');

describe('the page of a definition over HTTP', () => {
  it('shows a run as page.result on the run, and its views as page.runs on the definition', async () => {
    const run = await playbookWithThePage();

    const read = await server.call('GET', `${alpha}/runs/${run}`);
    const definition = await server.call('GET', draftPostsAt);

    expect(read.body).toMatchObject({
      page: { result: drafted },
    });
    expect(definition.body).toMatchObject({
      version: 1,
      source: draftPosts,
      page: { runs: 'Since it began, 2 posts were drafted.' },
    });
    expect(definition.body).not.toHaveProperty('page.source');
  });
});

describe('the preview of the page of a definition over HTTP', () => {
  it('renders the page at the route of the definition, over a sample output or over the latest run', async () => {
    await playbookWithThePage();

    const rendered = await server.call('POST', `${draftPostsAt}/render`, {
      body: { sample_output: { date: '2026-11-02', posts: [] } },
    });
    const latest = await server.call('POST', `${draftPostsAt}/render`);

    expect(rendered).toMatchObject({
      status: 200,
      body: { type: 'reasoning', name: 'draft-posts', page: { result: '0 posts drafted for 2026-11-02.' } },
    });
    expect(latest).toMatchObject({
      status: 200,
      body: { page: { result: drafted } },
    });
  });

  it('is changed and removed as the document is, each save a version of the definition', async () => {
    await playbookWithThePage();

    const changed = await server.call('PUT', draftPostsAt, {
      body: { source: draftPostsWith([...pageData, 'result: Drafted.', runs]), diagram: 'none' },
    });
    const removed = await server.call('PUT', draftPostsAt, { body: { source: draftPostsWith([]), diagram: 'none' } });

    expect(changed).toMatchObject({ status: 200, body: { version: 2 } });
    expect(removed).toMatchObject({ status: 200, body: { version: 3 } });
    expect(removed.body).not.toHaveProperty('page');
    expect(await server.call('POST', `${draftPostsAt}/render`)).toMatchObject({
      status: 404,
      body: { detail: 'The reasoning function draft-posts has no page; save one with update_definition' },
    });
  });
});

describe('the page of the playbook over HTTP', () => {
  it('is saved by update_playbook, read by get_playbook and rendered at the route of the playbook', async () => {
    await playbookWithThePage();

    const updated = await server.call('PUT', '/v1/orgs/acme/playbooks/alpha', { body: { page: playbookPage } });
    const read = await server.call('GET', '/v1/orgs/acme/playbooks/alpha');

    expect(updated).toMatchObject({
      status: 200,
      body: { id: 'alpha', name: 'Alpha', page: { source: playbookPage } },
    });
    expect(read).toMatchObject({ status: 200, body: { page: { source: playbookPage } } });
    await until(async () => {
      expect(await server.call('POST', `${alpha}/render`)).toMatchObject({
        status: 200,
        body: {
          page: {
            runs: 'Since it began, 2 posts were drafted.',
            standing: { state: 'live', folded: 1 },
          },
        },
      });
    });
  });
});

describe('the page of the playbook over HTTP, removed', () => {
  it('is removed by update_playbook with null, or with an empty page', async () => {
    await playbookWithThePage();
    const playbookAt = '/v1/orgs/acme/playbooks/alpha';
    await server.call('PUT', playbookAt, { body: { page: playbookPage } });

    const emptied = await server.call('PUT', playbookAt, { body: { page: '{}' } });
    await server.call('PUT', playbookAt, { body: { page: playbookPage } });
    const removed = await server.call('PUT', playbookAt, { body: { page: null } });

    expect([emptied.status, removed.status]).toEqual([200, 200]);
    expect(emptied.body).not.toHaveProperty('page');
    expect(removed.body).not.toHaveProperty('page');
    expect(await server.call('POST', `${alpha}/render`)).toMatchObject({ status: 404 });
  });

  it('refuses a page with result under /page, and renders none where there is none', async () => {
    await playbookWithThePage();

    expect(await server.call('POST', `${alpha}/render`)).toMatchObject({
      status: 404,
      body: { detail: 'The playbook has no page; save one with update_playbook' },
    });
    expect(await server.call('POST', `${alpha}/render`, { body: {} })).toMatchObject({ status: 404 });
    expect(await server.call('POST', `${alpha}/render`, { body: { version: 2 } })).toMatchObject({
      status: 422,
      body: {
        errors: [
          { pointer: '/version', detail: 'render_playbook_page takes no input; send no body, or an empty object' },
        ],
      },
    });
    expect(
      await server.call('PUT', '/v1/orgs/acme/playbooks/alpha', {
        body: { page: [...pageData, 'result: Ran.', runs].join('\n') },
      }),
    ).toMatchObject({ status: 422, body: { errors: [{ pointer: '/page' }] } });
  });
});
