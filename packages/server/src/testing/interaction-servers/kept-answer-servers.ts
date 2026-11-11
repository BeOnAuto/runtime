import { createHash, randomUUID } from 'node:crypto';

import { approvalDocument, agentDelivery } from '@on.auto/interaction/testing';
import { Schema } from 'effect';

import type { TemporaryLedger } from '../records/temporary-ledger.ts';
import { alpha } from '../servers/reasoning-server.ts';
import { runIdIn, workflowSource } from '../servers/workflow-server.ts';
import { until } from '../waiting/until.ts';
import { interactionServerOn, type InteractionServer } from './interaction-server.ts';

export interface OpenStore {
  readonly environment: Readonly<Record<string, string>>;
  readonly served: { readonly ledger?: TemporaryLedger };
  readonly rows: (sql: string) => Promise<readonly unknown[]>;
}

const Counted = Schema.Tuple([Schema.Struct({ counted: Schema.Union([Schema.Finite, Schema.FiniteFromString]) })]);

async function countOf(store: OpenStore, sql: string): Promise<number> {
  const [{ counted }] = Schema.decodeUnknownSync(Counted)(await store.rows(sql));
  return counted;
}

const Logged = Schema.Array(Schema.Struct({ data: Schema.String }));

export async function formatsOf(store: OpenStore, runId: string): Promise<readonly number[]> {
  const logged = Schema.decodeUnknownSync(Logged)(
    await store.rows(
      `SELECT CAST(message_data AS TEXT) AS data FROM emt_messages WHERE stream_id LIKE '%run-logs/${runId}' ORDER BY stream_position`,
    ),
  );
  return logged.map(({ data }) => Number(data.replace(/^.*?format\\?":(\d+).*$/su, '$1')));
}

export const notes = 'n'.repeat(30_000);

const answer = { choice: 'approve', notes };

export const answerDigest = createHash('sha256').update(JSON.stringify(answer)).digest('hex');

const reviewing = approvalDocument(agentDelivery, 'P2D', [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '      notes: { type: string, maxLength: 60000 }',
]);

const waitingWithTheAnswer = `do:
  - ask:
      call: run_definition
      with: { type: interaction, name: review-notes, input: { campaign: Spring, owner: ada } }
      export: { as: '\${ ({ answer: $data }) }' }
  - go:
      listen:
        to:
          one:
            with: { type: com.acme.go }
  - done: { set: '\${ $context.answer }' }
`;

const callingTheReview = `do:
  - inner:
      call: run_definition
      with: { type: workflow, name: reviewed, input: {} }
  - measured: { set: '\${ ({ length: $data.notes.length, choice: $data.choice }) }' }
`;

const reviewed = `do:
  - ask:
      call: run_definition
      with: { type: interaction, name: review-notes, input: { campaign: Spring, owner: ada } }
`;

const workflows = [
  ['waiting', waitingWithTheAnswer],
  ['calling', callingTheReview],
  ['reviewed', reviewed],
] as const;

export function servedOn(store: OpenStore, keeping = true): Promise<InteractionServer> {
  return interactionServerOn(store.environment, { ...store.served, ...(keeping ? { keptOutside: true } : {}) });
}

export async function playbookOn(store: OpenStore, keeping = true): Promise<InteractionServer> {
  const server = await servedOn(store, keeping);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'review-notes', source: reviewing, diagram: 'none' },
  });
  await Promise.all(
    workflows.map(([name, steps]) =>
      server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: workflowSource(name, steps) } }),
    ),
  );
  return server;
}

export async function started(server: InteractionServer, name: string): Promise<string> {
  const response = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, {
    body: { input: {}, run_id: randomUUID() },
  });
  return runIdIn(response.body);
}

export async function answeredOnce(server: InteractionServer, count: number): Promise<void> {
  const open = await server.openRequests(count);
  await Promise.all(open.map((request) => server.answer(request, { answer })));
}

export function headsOfTheAnswer(store: OpenStore): Promise<number> {
  return countOf(store, `SELECT COUNT(*) AS counted FROM recorded_content_heads WHERE sha256 = '${answerDigest}'`);
}

export async function answeredAndHeld(store: OpenStore, server: InteractionServer, count: number): Promise<void> {
  await answeredOnce(server, count);
  await until(
    () =>
      countOf(
        store,
        `SELECT COUNT(*) AS counted FROM content_references_1 WHERE sha256 = '${answerDigest}' AND stream LIKE 'run-logs/%'`,
      ),
    (held) => held >= count,
  );
}

export async function waitingWithItsAnswerKept(
  store: OpenStore,
): Promise<{ server: InteractionServer; runId: string }> {
  const server = await playbookOn(store);
  const runId = await started(server, 'waiting');
  await answeredAndHeld(store, server, 1);
  return { server, runId };
}

export function eventSent(server: InteractionServer, runId: string) {
  return server.call('POST', `${alpha}/runs/${runId}/events`, { body: { event: { type: 'com.acme.go' } } });
}

export const succeededWithTheAnswer = { status: 'succeeded', output: answer };
