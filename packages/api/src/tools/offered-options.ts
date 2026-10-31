import {
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type ElicitRequestFormParams,
  type InputRequiredResult,
} from '@modelcontextprotocol/server';
import type { Options, Outcome } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import type { OrgCall } from '../hand-off/caller-hand-off.ts';
import { callbackFor, type CalledTool, type CallServing, type ToolContext } from './tool-callback.ts';

type OfferingOptions = (input: unknown, context: ToolContext) => Promise<CallToolResult | InputRequiredResult>;

type Answered =
  | { readonly kind: 'unasked' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'chosen'; readonly value: string };

const theChoice = 'choice';

const FormsDeclaredSchema = Schema.Struct({ form: Schema.Record(Schema.String, Schema.Unknown) });

const NoModeDeclaredSchema = Schema.Struct({
  form: Schema.optionalKey(Schema.Never),
  url: Schema.optionalKey(Schema.Never),
});

const AnswersFormsSchema = Schema.Struct({
  [CLIENT_CAPABILITIES_META_KEY]: Schema.Struct({
    elicitation: Schema.Union([FormsDeclaredSchema, NoModeDeclaredSchema]),
  }),
});

const answersForms = Schema.is(AnswersFormsSchema);

const chosenValueOf = Schema.decodeUnknownOption(Schema.Struct({ [theChoice]: Schema.String }));

function answeredIn({ mcpReq }: ToolContext): Answered {
  const response = inputResponse(mcpReq.inputResponses, theChoice);
  if (response.kind !== 'elicit') {
    return { kind: 'unasked' };
  }
  const chosen = response.action === 'accept' ? chosenValueOf(response.content) : Option.none();
  return Option.match(chosen, {
    onNone: () => ({ kind: 'declined' }),
    onSome: ({ choice }) => ({ kind: 'chosen', value: choice }),
  });
}

function refusalAfter(outcome: Outcome, answered: Answered): Outcome {
  if (outcome.status !== 'rejected' || answered.kind !== 'chosen') {
    return outcome;
  }
  const choice = outcome.options?.choices.find(({ value }) => value === answered.value);
  return choice === undefined ? outcome : { ...outcome, issues: choice.issues };
}

function formOf({ choices }: Options): ElicitRequestFormParams['requestedSchema'] {
  return {
    type: 'object',
    properties: {
      [theChoice]: {
        type: 'string',
        title: 'Choose one',
        oneOf: choices.map(({ value, title }) => ({ const: value, title })),
      },
    },
    required: [theChoice],
  };
}

function askingOf(options: Options): InputRequiredResult {
  const asked = inputRequired.elicit({ message: options.question, requestedSchema: formOf(options) });
  return inputRequired({ inputRequests: { [theChoice]: asked } });
}

export function offeringOptions(serving: CallServing, call: OrgCall, tool: CalledTool): OfferingOptions {
  return async (input, context) => {
    const answered = answeredIn(context);
    const offered: Options[] = [];
    const watched: CalledTool = {
      ...tool,
      dispatch: (given) =>
        Effect.map(tool.dispatch(given), (outcome) => {
          offered.push(...(outcome.status === 'rejected' && outcome.options !== undefined ? [outcome.options] : []));
          return refusalAfter(outcome, answered);
        }),
    };
    const answer = await callbackFor(serving, call, watched)(input, context);
    const [options] = offered;
    return options === undefined || answered.kind !== 'unasked' || !answersForms(context.mcpReq.envelope)
      ? answer
      : askingOf(options);
  };
}
