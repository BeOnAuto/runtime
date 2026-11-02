import {
  outputText,
  renderClockOf,
  renderedTemplate,
  templateLimits,
  type ParsedTemplate,
  type RenderFailure,
} from '@on.auto/definitions/template';
import { InvalidInput } from '@on.auto/operations';
import { Effect, JsonPointer, Predicate, Result, type Schema } from 'effect';
import { toValue } from 'liquidjs';

import { generationEngine } from '../document/prompt-template.ts';

type RefusedBecause = 'not_text' | 'too_long';

class PromptRefused extends Error {
  readonly because: RefusedBecause;

  constructor(because: RefusedBecause) {
    super(because);
    this.because = because;
  }
}

interface PromptEmitter {
  buffer: string;
  readonly write: (html: unknown) => void;
}

function promptEmitter(): PromptEmitter {
  const emitter: PromptEmitter = {
    buffer: '',
    write: (html) => {
      const value: unknown = toValue(html);
      if (Predicate.isObjectOrArray(value)) {
        throw new PromptRefused('not_text');
      }
      emitter.buffer += outputText(value);
      if (emitter.buffer.length > templateLimits.renderedCharacters) {
        throw new PromptRefused('too_long');
      }
    },
  };
  return emitter;
}

type Refusal =
  | { readonly reason: 'not_text'; readonly line: number }
  | { readonly reason: 'too_long'; readonly line: number };

type PromptFailure = RenderFailure | Refusal;

function refusalOf(cause: unknown, line: number): Refusal | undefined {
  if (!(cause instanceof PromptRefused)) {
    return undefined;
  }
  return cause.because === 'not_text' ? { reason: 'not_text', line } : { reason: 'too_long', line };
}

const inputPath = /^input\./u;

function pointerOf(variable: string): string {
  return inputPath.test(variable)
    ? variable
        .replace(inputPath, '')
        .split('.')
        .map((segment) => `/${JsonPointer.escapeToken(segment)}`)
        .join('')
    : '';
}

function refused(detail: string, issue: string, pointer = ''): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail: issue }] });
}

function stoppedBy(failure: Extract<PromptFailure, { readonly reason: 'too_long' | 'limit_exceeded' }>): InvalidInput {
  const what = failure.reason === 'too_long' ? 'a longer prompt' : `more ${failure.limit}`;
  return refused(
    `Rendering the prompt with this input takes ${what} than a render may`,
    `Line ${failure.line}: the render stopped here`,
  );
}

function rejectionOf(failure: PromptFailure): InvalidInput {
  if (failure.reason === 'missing_variable') {
    return refused(
      `The prompt reads ${failure.variable} on line ${failure.line}, which the input does not have`,
      `Line ${failure.line}: the prompt reads ${failure.variable}, which this input does not have`,
      pointerOf(failure.variable),
    );
  }
  if (failure.reason === 'not_text') {
    return refused(
      'The prompt writes a list or an object where it writes text',
      `Line ${failure.line}: write one value of text here, such as a field of the list or the object`,
    );
  }
  if (failure.reason === 'failed') {
    return refused('The prompt cannot be rendered with this input', `Line ${failure.line}: ${failure.detail}`);
  }
  return stoppedBy(failure);
}

function promptWithin(text: string, mostCharacters: number): Effect.Effect<string, InvalidInput> {
  if (text === '') {
    return Effect.fail(refused('With this input the prompt renders empty', 'The prompt this input renders is empty'));
  }
  const characters = Array.from(text).length;
  return characters > mostCharacters
    ? Effect.fail(
        refused(
          `With this input the prompt takes ${characters} characters, more than the ${mostCharacters} the model takes`,
          `The prompt takes ${characters} characters`,
        ),
      )
    : Effect.succeed(text);
}

export function renderedPrompt(
  prompt: ParsedTemplate,
  scope: Readonly<Record<string, Schema.Json>>,
  mostCharacters: number,
): Effect.Effect<string, InvalidInput> {
  return Effect.clockWith((clock) => {
    const emitter = promptEmitter();
    const rendered = renderedTemplate(generationEngine, prompt, {
      variables: scope,
      emitter,
      refusalOf,
      clock: renderClockOf(clock),
    });
    return Result.isFailure(rendered)
      ? Effect.fail(rejectionOf(rendered.failure))
      : promptWithin(emitter.buffer.trim(), mostCharacters);
  });
}
