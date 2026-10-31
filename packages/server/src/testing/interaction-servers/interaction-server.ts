import { agentDelivery, approvalDocument, notificationDocument } from '@on.auto/interaction/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import type { ServedParts } from '../servers/served-parts.ts';
import { runIdIn, settledRun, workflowSource } from '../servers/workflow-server.ts';
import { until } from '../waiting/until.ts';

export const brief = { campaign: 'Spring', owner: 'ada' };

const unansweredType = 'https://on.auto/problems/unanswered';

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({ interactions: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.String,
        metadata: Schema.Struct({ causation_id: Schema.NullOr(Schema.String) }),
      }),
    ),
  }),
);

function causesIn(history: unknown): readonly (readonly [string, string | null | undefined])[] {
  const { events } = decodeHistory(history);
  const typeOf = new Map(events.map(({ id, type }) => [id, type]));
  return events.map(({ type, metadata: { causation_id: cause } }) => [type, cause === null ? null : typeOf.get(cause)]);
}

export interface InteractionServer extends ReasoningServer {
  readonly ask: (name: string) => Promise<string>;
  readonly answer: (runId: string, body: unknown) => ReturnType<ReasoningServer['call']>;
  readonly settled: (runId: string) => Promise<unknown>;
  readonly workflow: (name: string, steps: string) => Promise<string>;
  readonly openRequests: (count: number) => Promise<readonly string[]>;
  readonly causes: (runId: string) => Promise<readonly (readonly [string, string | null | undefined])[]>;
}

function once(stop: () => Promise<void>): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => {
    stopping ??= stop();
    return stopping;
  };
}

export async function interactionServerOn(
  environment: Readonly<Record<string, string>>,
  parts: ServedParts = {},
): Promise<InteractionServer> {
  const server = await servingReasoning([], environment, noNetwork, parts);
  const stop = once(server.stop);
  onTestFinished(stop);
  return {
    ...server,
    stop,
    ask: async (name) => {
      const started = await server.call('POST', `${alpha}/definitions/interaction/${name}/run`, {
        body: { input: brief },
      });
      return runIdIn(started.body);
    },
    answer: (runId, body) => server.call('POST', `${alpha}/runs/${runId}/answer`, { body }),
    settled: async (runId) => (await settledRun(server, `${alpha}/runs/${runId}`)).body,
    workflow: async (name, steps) => {
      await server.call('POST', `${alpha}/definitions/workflow`, {
        body: { name, source: workflowSource(name, steps) },
      });
      const started = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, {
        body: { input: {} },
      });
      return runIdIn(started.body);
    },
    openRequests: async (count) => {
      const listed = await until(
        async () => decodeListed((await server.call('GET', `${alpha}/interactions`)).body).interactions,
        (interactions) => interactions.length >= count,
      );
      return listed.map(({ run_id: runId }) => runId);
    },
    causes: async (runId) => causesIn((await server.call('GET', `${alpha}/runs/${runId}/history`)).body),
  };
}

export async function servingInteractions(
  delivery: readonly string[] = agentDelivery,
  environment: Readonly<Record<string, string>> = {},
  parts: ServedParts = {},
): Promise<InteractionServer> {
  const server = await interactionServerOn(environment, parts);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'approve-brief', source: approvalDocument(delivery) },
  });
  await server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'brief-out', source: notificationDocument(delivery) },
  });
  return server;
}

export function asking(name: string, task: string, indent = '  '): string {
  return `${indent}- ${task}: { call: run_definition, with: { type: interaction, name: ${name}, input: { campaign: Spring, owner: ada } } }\n`;
}

export function guarded(name: string, kind: string): string {
  return `do:
  - guard:
      try:
${asking(name, 'ask', '        ')}      catch:
        errors: { with: { type: ${unansweredType}, kind: ${kind} } }
        do:
          - note: { set: { caught: '\${ $error.kind }' } }
`;
}
