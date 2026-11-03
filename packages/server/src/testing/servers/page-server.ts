import { answers, jsonResult, type ScriptedReplies } from '@on.auto/reasoning/testing';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Option, Schema } from 'effect';
import { expect } from 'vitest';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import { until } from '../waiting/until.ts';
import { alpha, servingReasoning, type ReasoningServer } from './reasoning-server.ts';
import { patientWorkerPool } from './worker-pools.ts';

export function answering(...outputs: readonly Schema.Json[]): readonly ScriptedReplies[] {
  return outputs.map((output) => answers(jsonResult(output)));
}

export function servingPages(
  replies: readonly ScriptedReplies[],
  environment: Readonly<Record<string, string>> = {},
  programPoolOf: ProgramPoolOf = patientWorkerPool,
): Promise<ReasoningServer> {
  return servingReasoning(replies, environment, undefined, { programPoolOf });
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

const StandingSchema = Schema.Struct({ page: Schema.Struct({ standing: Schema.Struct({ state: Schema.String }) }) });

const decodeStanding = Schema.decodeUnknownOption(StandingSchema);

export function pageInState(server: ReasoningServer, definition: string, state: string): Promise<unknown> {
  return until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/${definition}`);
    expect(Option.getOrUndefined(decodeStanding(body))?.page.standing.state).toBe(state);
    return body;
  });
}
