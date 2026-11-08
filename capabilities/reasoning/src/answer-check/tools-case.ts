import { Effect, Option, Schema } from 'effect';

import type { LanguageModel } from '../model/language-model.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { askedIn, assistantMessages, type AskedCall } from '../steps/asked-calls.ts';
import { responseOf } from '../steps/step-messages.ts';
import {
  answeredFinding,
  checkFinding,
  failedFinding,
  refusedForTheSchema,
  type CaseFinding,
  type FailedCall,
} from './case-findings.ts';
import { cityPopulation, populations } from './check-cases.ts';

type Generate = LanguageModel['Service']['generate'];

type Costs = readonly (number | undefined)[];

const mostToolRounds = 3;

const answeredWithoutTheTool = `The model answered without calling ${cityPopulation.name}, which it was told to call`;

const keptCallingTools = `The model still called tools after ${mostToolRounds} requests, instead of answering`;

const unknownCity = 'No population is known for that city';

const cityOf = Schema.decodeUnknownOption(Schema.Struct({ city: Schema.String }));

function populationText(input: unknown): string {
  const millions = Option.flatMap(cityOf(input), ({ city }) => Option.fromNullishOr(populations.get(city)));
  return Option.match(millions, { onNone: () => unknownCity, onSome: (found) => `${found}` });
}

function resultsMessage(asked: readonly AskedCall[]): Schema.JsonObject {
  return {
    role: 'tool',
    content: asked.map(({ callId, tool, input }) => ({
      type: 'tool-result',
      toolCallId: callId,
      toolName: tool,
      output: { type: 'text', value: populationText(input) },
    })),
  };
}

function answeredFromTheTools(request: ModelRequest, { response }: ModelResult): ModelRequest {
  const messages = responseOf(response);
  const conversation = [
    ...(request.conversation ?? []),
    ...assistantMessages(messages),
    resultsMessage(askedIn(messages)),
  ];
  return { ...request, conversation };
}

function withCostOf(costs: Costs, finding: CaseFinding): CaseFinding {
  const known = costs.filter((cost) => cost !== undefined);
  return known.length === 0 ? finding : { ...finding, cost_usd: known.reduce((total, cost) => total + cost, 0) };
}

function roundEnded(
  generate: Generate,
  request: ModelRequest,
  result: ModelResult,
  spent: Costs,
): Effect.Effect<CaseFinding> {
  const costs = [...spent, result.cost_usd];
  const calledTools = result.finish_reason === 'tool_calls';
  if (refusedForTheSchema(result.schema_refusal) || (!calledTools && spent.length > 0)) {
    return Effect.succeed(withCostOf(costs, answeredFinding(result)));
  }
  if (!calledTools) {
    return Effect.succeed(withCostOf(costs, checkFinding('invalid', answeredWithoutTheTool, result)));
  }
  return costs.length === mostToolRounds
    ? Effect.succeed(withCostOf(costs, checkFinding('invalid', keptCallingTools, result)))
    : toolRound(generate, answeredFromTheTools(request, result), costs);
}

function toolRound(generate: Generate, request: ModelRequest, spent: Costs): Effect.Effect<CaseFinding> {
  return Effect.matchEffect(generate(request), {
    onFailure: (failure: FailedCall) => {
      const found = failedFinding(failure);
      return Effect.succeed(withCostOf([...spent, found.cost_usd], found));
    },
    onSuccess: (result) => roundEnded(generate, request, result, spent),
  });
}

export function toolsCaseFinding(generate: Generate, request: ModelRequest): Effect.Effect<CaseFinding> {
  return toolRound(generate, request, []);
}
