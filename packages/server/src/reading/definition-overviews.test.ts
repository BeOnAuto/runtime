import { withMcpSession } from '@on.auto/api/testing';
import { campaignPace } from '@on.auto/computation/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { weeklyOrders } from '@on.auto/prediction/testing';
import { campaignReviews, foldOf, recallDocument } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: ['alpha', 'beta'],
});

const beta = '/v1/orgs/acme/playbooks/beta';

const [reasoningExample] = blocksInOrderOf('reference/reasoning-format.md');

const [, , , readCampaignCosts] = blocksInOrderOf('reference/computation-format.md');

const [, , , sendBuildExample] = blocksInOrderOf('reference/prediction-format.md');

const greet =
  "document:\n  dsl: '1.0.3'\n  namespace: acme\n  name: greet\n  version: '1.0.0'\ndo:\n  - greet: { set: { greeting: hello } }\n";

interface Saved {
  readonly type: string;
  readonly name: string;
  readonly source: string;
}

const saved: readonly Saved[] = [
  { type: 'reasoning', name: 'review-brief', source: String(reasoningExample?.body) },
  { type: 'interaction', name: 'read-campaign-costs', source: String(readCampaignCosts?.body) },
  { type: 'prediction', name: 'weekly-orders', source: weeklyOrders },
  { type: 'recall', name: 'campaign-reviews', source: campaignReviews },
  { type: 'computation', name: 'campaign-pace', source: campaignPace },
  { type: 'workflow', name: 'greet', source: greet },
];

const sendBuild: Saved = { type: 'interaction', name: 'send-build', source: String(sendBuildExample?.body) };

const weeklyBuild: Saved = {
  type: 'workflow',
  name: 'weekly-build',
  source:
    "document:\n  dsl: '1.0.3'\n  namespace: acme\n  name: weekly-build\n  version: '1.0.0'\ndo:\n  - send:\n      call: run_definition\n      with: { type: interaction, name: send-build, input: { build: {} } }\n",
};

const namingSendBuild: readonly Saved[] = [
  {
    type: 'prediction',
    name: 'weekly-orders',
    source: weeklyOrders.replace('  expires: P7D', '  through: send-build\n  expires: P7D'),
  },
  {
    type: 'recall',
    name: 'build-answers',
    source: recallDocument(
      foldOf('return view + 1;'),
      'language: typescript\nsource:\n  events:\n    - type: run_succeeded\n      subject: interaction/send-build\nview:\n  initial: 0',
    ),
  },
  weeklyBuild,
];

const usedBySendBuild = [
  '## Used by',
  [
    '- The prediction function **Weekly orders** sends it builds to train.',
    '- The recall function **Build answers** remembers its runs.',
    '- The workflow **Weekly build** calls it in step 1, **Send**.',
  ].join('\n'),
].join('\n\n');

const namesUsingSendBuild = [
  '### Used by',
  [
    '- `weekly-orders`, a prediction function',
    '- `build-answers`, a recall function',
    '- `weekly-build`, a workflow\n',
  ].join('\n'),
].join('\n\n');

const callsOfWeeklyBuild = [
  '## What it calls',
  'It calls the interaction function **Send build**: Sends a build of a prediction function to its trainer and takes the candidates back.',
  '## Details',
  '### What it calls',
  '- `send-build`, an interaction function\n',
].join('\n\n');

function usersIn(overview: string): readonly string[] {
  const [story = '', details = ''] = overview.split('\n\n## Details\n\n');
  return [story.slice(story.indexOf('## Used by')), details.slice(details.indexOf('### Used by'))];
}

const decodeOverview = Schema.decodeUnknownSync(Schema.Struct({ overview: Schema.String }));

let server: ReasoningServer;

let createdStatuses: readonly number[];

function created(playbook: string, { type, name, source }: Saved): Promise<number> {
  return server
    .call('POST', `${playbook}/definitions/${type}`, { key: admin.key, body: { name, source } })
    .then(({ status }) => status);
}

beforeEach(async () => {
  server = await servingReasoning([], { API_KEYS: JSON.stringify([admin.entry, reader.entry]) });
  await server.call('POST', '/v1/orgs/acme/playbooks', { key: admin.key, body: { playbook: 'alpha', name: 'Alpha' } });
  createdStatuses = await Promise.all(saved.map((definition) => created(alpha, definition)));
});

afterEach(async () => {
  await server.stop();
});

async function overviewOverHttp({ type, name }: Saved, playbook = alpha): Promise<string> {
  const { body } = await server.call('GET', `${playbook}/definitions/${type}/${name}`, { key: reader.key });
  return decodeOverview(body).overview;
}

function overviewsOverMcp(playbook: string, definitions: readonly Saved[]): Promise<readonly string[]> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/${playbook}/mcp`, headers: { authorization: `Bearer ${reader.key}` } },
    (session) =>
      Promise.all(
        definitions.map(
          async ({ type, name }) =>
            decodeOverview((await session.callTool('get_definition', { type, name })).structuredContent).overview,
        ),
      ),
  );
}

const predictionAndWorkflow: ReadonlySet<string> = new Set(['prediction', 'workflow']);

function headingsOf(overview: string): readonly string[] {
  return overview
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice('## '.length));
}

describe('the overview of every type of definition', () => {
  it('is answered over HTTP to a key that may read the playbook, opening with its name, and is not listed', async () => {
    const overviews = await Promise.all(saved.map((definition) => overviewOverHttp(definition)));
    const listed = await server.call('GET', `${alpha}/definitions/reasoning`, { key: reader.key });

    expect(createdStatuses).toEqual(saved.map(() => 201));
    expect(overviews.map((overview) => overview.slice(0, overview.indexOf('\n\n')))).toEqual(
      saved.map(({ name }) => `# ${name}`),
    );
    expect(overviews.every((overview) => overview.split('\n\n').length > 2)).toBe(true);
    expect(overviews[1]).toContain(
      '\n\nIt is given the month and asks **ads** with its tool `campaign-costs`, once per run.',
    );
    expect(overviews[3]).toContain('\n\n## What it remembers\n\n');
    expect(listed).toMatchObject({ status: 200, body: { definitions: [{ name: 'review-brief' }] } });
    expect(listed.body).not.toHaveProperty('definitions.0.overview');
  });

  it('shows a prediction function and a workflow in sections of their own types', async () => {
    const overviews = await Promise.all(
      saved.filter(({ type }) => predictionAndWorkflow.has(type)).map((definition) => overviewOverHttp(definition)),
    );

    expect(overviews.map((overview) => headingsOf(overview))).toEqual([
      ['What it predicts', 'What it learns from', 'Who trains it', 'How a version goes live', 'Rules'],
      ['What starts it', 'What it needs', 'What it produces', 'What it does'],
    ]);
  });

  it('is answered over MCP to the same key, as over HTTP', async () => {
    const overHttp = await Promise.all(saved.map((definition) => overviewOverHttp(definition)));

    expect(await overviewsOverMcp('alpha', saved)).toEqual(overHttp);
  });
});

describe('the overview of a definition that others of its playbook name', () => {
  it('ends with each of them, a workflow with its step, over HTTP and over MCP alike, and the workflow says what it calls', async () => {
    await server.call('POST', '/v1/orgs/acme/playbooks', { key: admin.key, body: { playbook: 'beta', name: 'Beta' } });
    const statuses = [
      await created(beta, sendBuild),
      ...(await Promise.all(namingSendBuild.map((definition) => created(beta, definition)))),
    ];
    const overHttp = [await overviewOverHttp(sendBuild, beta), await overviewOverHttp(weeklyBuild, beta)];
    const [named, unnamed] = overHttp;

    expect(statuses).toEqual([201, 201, 201, 201]);
    expect(named?.startsWith('# send-build\n\n')).toBe(true);
    expect(usersIn(String(named))).toEqual([usedBySendBuild, namesUsingSendBuild]);
    expect(unnamed).not.toContain('## Used by');
    expect(unnamed?.slice(unnamed.indexOf('## What it calls'))).toBe(callsOfWeeklyBuild);
    expect(await overviewsOverMcp('beta', [sendBuild, weeklyBuild])).toEqual(overHttp);
  });
});
