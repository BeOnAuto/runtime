import { renderClockOf } from '@on.auto/definitions/template';
import { InvalidInput } from '@on.auto/operations';
import { Effect, JsonPointer, Result, type Clock } from 'effect';

import type { CompiledTemplate, RenderedPrompt, RenderFailure, TemplateScope } from '../template/compiled-template.ts';

const inputPath = /^input\./u;

const exceeded = { memory: 'more memory', time: 'more time' } as const;

function pointerOf(variable: string): string {
  return inputPath.test(variable)
    ? variable
        .replace(inputPath, '')
        .split('.')
        .map((segment) => `/${JsonPointer.escapeToken(segment)}`)
        .join('')
    : '';
}

function rejection(detail: string, issue: string, pointer = ''): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail: issue }] });
}

function rejectionOf(failure: RenderFailure): InvalidInput {
  if (failure.reason === 'missing_variable') {
    return rejection(
      `The template reads ${failure.variable} on line ${failure.line}, which the input does not have`,
      `Line ${failure.line}: the template reads ${failure.variable}, which this input does not have`,
      pointerOf(failure.variable),
    );
  }
  if (failure.reason === 'too_long') {
    return rejection(
      `With this input the ${failure.part} of the prompt would be longer than the template may render`,
      `Line ${failure.line}: the ${failure.part} grows past 200000 characters here`,
    );
  }
  if (failure.reason === 'limit_exceeded') {
    return rejection(
      `Rendering the template with this input takes ${exceeded[failure.limit]} than a render may`,
      `Line ${failure.line}: the render stopped here`,
    );
  }
  return rejection('The template cannot be rendered with this input', `Line ${failure.line}: ${failure.detail}`);
}

const emptyMessage = rejection(
  'With this input the template renders an empty message',
  'The message the template renders from this input is empty',
);

export function renderedPrompt(
  template: CompiledTemplate,
  scope: TemplateScope,
  clock: Clock.Clock,
): Effect.Effect<RenderedPrompt, InvalidInput> {
  return Result.match(template.render(scope, renderClockOf(clock)), {
    onFailure: (failure) => Effect.fail(rejectionOf(failure)),
    onSuccess: (prompt) => (prompt.message.trim() === '' ? Effect.fail(emptyMessage) : Effect.succeed(prompt)),
  });
}
