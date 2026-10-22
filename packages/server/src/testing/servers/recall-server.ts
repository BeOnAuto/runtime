import type { McpSession } from '@on.auto/api/testing';
import { answers, jsonResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { campaignReviews } from '@on.auto/recall/testing';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Option, Schema } from 'effect';
import { expect } from 'vitest';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import { until } from '../waiting/until.ts';
import { alpha, servingReasoning, type ReasoningServer } from './reasoning-server.ts';
import { patientWorkerPool } from './worker-pools.ts';

export const anyReview = [
  '---',
  'description: Reviews a campaign brief, answering whatever the model writes',
  'model: anthropic/claude-sonnet-4-5',
  'output:',
  '  format: json',
  '  schema: {type: [object, array, string]}',
  '---',
  'Review this campaign brief and give the campaign and your verdict: {{ input.brief }}',
].join('\n');

const StandingSchema = Schema.Struct({
  standing: Schema.Struct({ state: Schema.String, version: Schema.Number, folded: Schema.Number }),
});

export type Standing = typeof StandingSchema.Type.standing;

const decodeStanding = Schema.decodeUnknownOption(StandingSchema);

export function verdicts(...outputs: readonly Schema.Json[]): readonly ScriptedReply[] {
  return outputs.map((output) => answers(jsonResult(output)));
}

export interface Gate {
  readonly poolOf: ProgramPoolOf;
  readonly letThrough: (folds: number) => void;
  readonly open: () => void;
  readonly held: () => number;
}

export function foldsHeldUntilOpened(): Gate {
  const waiting: (() => void)[] = [];
  const allowed = { folds: 0 };
  const released = (): void => {
    const ready = waiting.splice(0, Math.min(allowed.folds, waiting.length));
    allowed.folds -= ready.length;
    for (const go of ready) {
      go();
    }
  };
  const held = (pool: ProgramPool): ProgramPool => ({
    ...pool,
    fold: async (request, signal) => {
      const turn = Promise.withResolvers<void>();
      waiting.push(turn.resolve);
      released();
      await turn.promise;
      return pool.fold(request, signal);
    },
  });
  return {
    poolOf: (settings, handed) => held(patientWorkerPool(settings, handed)),
    letThrough: (folds) => {
      allowed.folds += folds;
      released();
    },
    open: () => {
      allowed.folds = Number.POSITIVE_INFINITY;
      released();
    },
    held: () => waiting.length,
  };
}

export function foldsHeld(gate: Gate, folds: number): Promise<void> {
  return until(() => {
    expect(gate.held()).toBe(folds);
  });
}

export async function playbookWithReviews(server: ReasoningServer, briefsFirst = 0, playbook = 'alpha'): Promise<void> {
  const path = `/v1/orgs/acme/playbooks/${playbook}`;
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook, name: playbook } });
  await server.call('POST', `${path}/definitions/reasoning`, { body: { name: 'review-brief', source: anyReview } });
  await reviewed(server, briefsFirst, playbook);
  await server.call('POST', `${path}/definitions/recall`, { body: { name: 'reviews', source: campaignReviews } });
}

export function reviewed(server: ReasoningServer, briefs: number, playbook = 'alpha'): Promise<unknown> {
  return Array.from({ length: briefs }, (_, index) => index).reduce<Promise<unknown>>(
    (before, index) =>
      before.then(() =>
        server.call('POST', `/v1/orgs/acme/playbooks/${playbook}/definitions/reasoning/review-brief/run`, {
          body: { input: { brief: `brief ${index}` } },
        }),
      ),
    Promise.resolve(),
  );
}

export function recalled(server: ReasoningServer, name: string, input: Schema.Json) {
  return server.call('POST', `${alpha}/definitions/recall/${name}/run`, { body: { input } });
}

export function standingUntil(
  server: ReasoningServer,
  name: string,
  holds: (standing: Standing) => boolean,
): Promise<unknown> {
  return until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/recall/${name}`);
    const standing = Option.getOrUndefined(decodeStanding(body))?.standing;
    expect(standing !== undefined && holds(standing)).toBe(true);
    return body;
  });
}

interface RecallFunctionNamed {
  readonly name: string;
  readonly playbook?: string;
}

export function liveOverMcp(session: McpSession, named: RecallFunctionNamed, folded: number): Promise<unknown> {
  return until(async () => {
    const read = await session.callTool('get_definition', { ...named, type: 'recall' });
    expect(read.structuredContent).toMatchObject({ standing: { state: 'live', folded } });
    return read.structuredContent;
  });
}

export function liveWith(folded: number): (standing: Standing) => boolean {
  return (standing) => standing.state === 'live' && standing.folded === folded;
}

export function liveAt(version: number): (standing: Standing) => boolean {
  return (standing) => standing.state === 'live' && standing.version === version;
}

export function inState(state: string): (standing: Standing) => boolean {
  return (standing) => standing.state === state;
}

export function servingRecall(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = {},
  programPoolOf: ProgramPoolOf = patientWorkerPool,
): Promise<ReasoningServer> {
  return servingReasoning(replies, environment, undefined, { programPoolOf });
}
