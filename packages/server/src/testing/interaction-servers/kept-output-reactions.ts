import { answers, jsonResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';

import { alpha, servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import { patientWorkerPool } from '../servers/worker-pools.ts';
import { workflowSource } from '../servers/workflow-server.ts';
import { until } from '../waiting/until.ts';
import type { InteractionServer } from './interaction-server.ts';
import type { OpenStore } from './kept-answer-servers.ts';

const onTheReview = `schedule:
  on: { one: { with: { type: run_succeeded, subject: interaction/review-notes } } }
do:
  - measured: { set: '\${ ({ length: $data[0].data.output.notes.length }) }' }
`;

const listeningForTheReview = `do:
  - heard:
      listen:
        to:
          one:
            with: { type: run_succeeded, subject: interaction/review-notes }
  - measured: { set: '\${ ({ length: $data[0].output.notes.length }) }' }
`;

const reactions = [
  ['on-review', onTheReview],
  ['listening', listeningForTheReview],
] as const;

export async function reactingToTheReview(server: InteractionServer): Promise<void> {
  await Promise.all(
    reactions.map(([name, steps]) =>
      server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: workflowSource(name, steps) } }),
    ),
  );
}

const RunsSchema = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String })),
});

export async function endedRunOf(server: InteractionServer, workflow: string): Promise<string> {
  const [run] = await until(
    async () =>
      Schema.decodeUnknownSync(RunsSchema)(
        (await server.call('GET', `${alpha}/runs?type=workflow&name=${workflow}`)).body,
      ).runs,
    (runs) => runs.some(({ status }) => status !== 'started'),
  );
  return String(run?.run_id);
}

const posts = Array.from({ length: 3 }, (_, index) => ({ channel: 'LinkedIn', body: 'p'.repeat(8000 + index) }));

const draftPosts = [
  '---',
  'description: Drafts the posts of the morning',
  'model: anthropic/claude-sonnet-4-5',
  'output:',
  '  format: json',
  '  schema: {type: object}',
  'page:',
  '  data:',
  '    language: typescript',
  '    source:',
  '      events:',
  '        - type: run_succeeded',
  '          subject: reasoning/draft-posts',
  '    views:',
  '      by_channel: categories',
  '    module: |',
  '      export function fold(view: View, event: Event): View {',
  "        const output = typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data) ? event.data['output'] : undefined;",
  "        const posts = typeof output === 'object' && output !== null && !Array.isArray(output) ? output['posts'] : undefined;",
  '        const count = Array.isArray(posts) ? posts.length : 0;',
  "        return { by_channel: { unit: 'posts', values: [...(view.by_channel?.values ?? []), { name: 'All', value: count }] } };",
  '      }',
  '  runs: \'Since it began, {{ views.by_channel.values | sum: "value" }} posts were drafted.\'',
  '---',
  'Draft the posts of the morning.',
].join('\n');

const draftPostsAt = `${alpha}/definitions/reasoning/draft-posts`;

const PageRuns = Schema.Struct({ page: Schema.Struct({ runs: Schema.String }) });

export async function postsDraftedOnThePage(store: OpenStore, keeping: boolean): Promise<string> {
  const server: ReasoningServer = await servingReasoning(
    [answers(jsonResult({ posts }))],
    store.environment,
    undefined,
    {
      programPoolOf: patientWorkerPool,
      ...store.served,
      ...(keeping ? { keptOutside: true } : {}),
    },
  );
  try {
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'draft-posts', source: draftPosts, diagram: 'none' },
    });
    await server.call('POST', `${draftPostsAt}/run`, { body: { input: {} } });
    return await until(
      async () => Schema.decodeUnknownSync(PageRuns)((await server.call('GET', draftPostsAt)).body).page.runs,
      (runs) => !runs.startsWith('Since it began, 0'),
    );
  } finally {
    await server.stop();
  }
}
