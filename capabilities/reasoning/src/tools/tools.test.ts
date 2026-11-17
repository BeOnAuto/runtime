import { Buffer } from 'node:buffer';

import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunImage } from '../steps/kept-content.ts';
import { runContext } from '../testing/reasoning-runs.ts';
import { inputSchemaWarnings } from './input-schema-warnings.ts';
import { imagesKeptOn } from './tool-images.ts';
import {
  leavesNoNextTurn,
  type Meter,
  noTurns,
  roomOfEachAnswer,
  toolAnswered,
  turnAnswered,
  type TurnLimits,
} from './turn-meter.ts';

describe('the images a run keeps', () => {
  it('are each kept for the run, by its caller, with what the call was, and answer the id of their asset', async () => {
    const run = runContext();
    const kept: RunImage[] = [];
    const call = { call_id: 'toolu_01', server: 'browser', tool: 'browser_take_screenshot' };
    const keep = imagesKeptOn(
      (image) =>
        Effect.sync(() => {
          kept.push(image);
          return `asset-${kept.length}`;
        }),
      run,
    );

    expect(await keep(Buffer.from('a screenshot'), call)).toBe('asset-1');
    expect(kept).toEqual([
      {
        playbook: { org: 'acme', playbook: 'alpha' },
        bytes: Buffer.from('a screenshot'),
        call,
        context: {
          by: 'acme-admin',
          runId: run.id,
          definitionType: 'reasoning',
          definitionName: 'summary',
          definitionVersion: 1,
        },
        lineage: { causationId: run.lineage.startId, correlationId: run.lineage.correlationId },
      },
    ]);
  });
});

const searchTool = 'graph__search';

const boundedQuery: Schema.JsonObject = {
  type: 'object',
  properties: { query: { type: 'string', maxLength: 80 } },
  required: ['query'],
};

function warningsFor(provider: string, inputSchema: Schema.JsonObject) {
  return inputSchemaWarnings([{ name: searchTool, description: 'Finds rows.', inputSchema }], provider);
}

describe('the warnings of a run whose tools have an input schema', () => {
  it("say where the provider of the run may not hold a tool's arguments to its input schema, and nothing for another provider", () => {
    expect([warningsFor('anthropic', boundedQuery), warningsFor('openai', boundedQuery)]).toEqual([
      [
        {
          type: 'compatibility',
          feature: `${searchTool} inputSchema#/properties/query/maxLength`,
          detail:
            "maxLength is not enforced while Anthropic models write a tool's arguments; arguments outside it reach the tool, which may refuse them",
        },
      ],
      [],
    ]);
  });

  it('say where the provider of the run may refuse the input schema itself', () => {
    expect(warningsFor('openai', { type: 'array', items: { type: 'string' } })).toEqual([
      {
        type: 'compatibility',
        feature: `${searchTool} inputSchema#/type`,
        detail: 'The root of the schema should be "type": "object"',
      },
    ]);
  });

  it('say nothing of an open object with optional properties, since tools are not sent as strict structured outputs', () => {
    const openQuery = { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } } };

    expect([warningsFor('anthropic', openQuery), warningsFor('openai', openQuery)]).toEqual([[], []]);
  });

  it('say nothing of an input schema too large to check', () => {
    const tooLarge = {
      type: 'object',
      description: 'x'.repeat(70_000),
      properties: { query: { type: 'string', maxLength: 80 } },
      required: ['query'],
    };

    expect(warningsFor('anthropic', tooLarge)).toEqual([]);
  });
});

const sentBytes = 600;

function answered(inputTokens: number | null, outputTokens: number | null, calls: number, meter = noTurns): Meter {
  return turnAnswered(meter, { sentBytes, inputTokens, outputTokens, calls });
}

function within(contextWindow: number | undefined, allowed: number): TurnLimits {
  return { contextWindow, budget: { allowed, asked: undefined, most: allowed } };
}

describe('the room of the answers of a turn', () => {
  it('is what the window holds past the input and output the provider reported, in bytes at the ratio the request measured', () => {
    expect(roomOfEachAnswer(answered(40, 10, 1), within(1000, 2_000_000))).toBe(
      Math.floor((1000 - 40 - 10) * (sentBytes / 40)),
    );
  });

  it('is shared equally by the calls of the turn', () => {
    const one = roomOfEachAnswer(answered(30, 0, 1), within(9000, 2_000_000));
    const three = roomOfEachAnswer(answered(30, 0, 3), within(9000, 2_000_000));

    expect(three).toBe(Math.floor(Number(one) / 3));
  });

  it('is bounded by what the budget of the run leaves, counting every turn made, and is none when nothing is left', () => {
    const second = answered(60, 10, 2, answered(40, 10, 1));

    expect(roomOfEachAnswer(second, within(1_000_000, 200))).toBe(
      Math.floor(((200 - 100 - 60 - 10) * (sentBytes / 60)) / 2),
    );
    expect(roomOfEachAnswer(answered(40, 10, 1), within(50, 200))).toBe(0);
  });

  it('counts no output tokens for a turn whose output the provider did not count', () => {
    expect(roomOfEachAnswer(answered(40, null, 1), within(1000, 2_000_000))).toBe(
      Math.floor((1000 - 40) * (sentBytes / 40)),
    );
  });

  it('is none for a turn the provider counted no input tokens of, or of a model whose window is unknown', () => {
    expect([
      roomOfEachAnswer(answered(null, null, 1), within(1000, 200)),
      roomOfEachAnswer(answered(0, 5, 1), within(1000, 200)),
      roomOfEachAnswer(answered(40, 5, 1), within(undefined, 200)),
      roomOfEachAnswer(noTurns, within(1000, 200)),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('the budget of the input tokens of a run, before a turn', () => {
  it('leaves no next turn when what it would leave after one is less than the turn it projects', () => {
    const turn = toolAnswered(answered(40, 10, 1), 'x'.repeat(sentBytes));

    expect([leavesNoNextTurn(turn, within(undefined, 1000)), leavesNoNextTurn(turn, within(undefined, 150))]).toEqual([
      false,
      true,
    ]);
  });

  it('projects nothing before the first turn, nor for a turn the provider counted no input tokens of', () => {
    const unreported = answered(null, 5, 1, answered(5, 5, 1));

    expect([leavesNoNextTurn(noTurns, within(1000, 10)), leavesNoNextTurn(unreported, within(1000, 10))]).toEqual([
      false,
      false,
    ]);
  });

  it('counts a turn the provider counted nothing of as no input when it sums the turns made', () => {
    expect(leavesNoNextTurn(answered(40, 0, 1, answered(null, 0, 1)), within(undefined, 130))).toBe(false);
  });
});

describe('the input tokens of the last turn the provider answered', () => {
  it('are none before a turn was counted, and the last count after', () => {
    expect([noTurns.lastInputTokens, answered(null, 10, 1, answered(40, 10, 1)).lastInputTokens]).toEqual([null, 40]);
  });
});
