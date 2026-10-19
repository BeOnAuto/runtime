import {
  outputText,
  renderedTemplate,
  templateLimits,
  type ParsedTemplate,
  type RenderClock,
} from '@on.auto/definitions/template';
import { Result } from 'effect';
import { toValue, type Emitter } from 'liquidjs';

import type { PromptPart, RenderedPrompt, RenderFailure, TemplateScope } from './compiled-template.ts';
import { engine, instructionsBegin, instructionsEnd } from './liquid-engine.ts';
import { PromptTooLong } from './prompt-too-long.ts';

interface PromptEmitter extends Emitter {
  readonly prompt: () => RenderedPrompt;
}

function promptEmitter(hasInstructions: boolean): PromptEmitter {
  const texts: Record<PromptPart, string> = { instructions: '', message: '' };
  let part: PromptPart = 'message';
  return {
    buffer: '',
    write(html: unknown) {
      if (html === instructionsBegin || html === instructionsEnd) {
        part = html === instructionsBegin ? 'instructions' : 'message';
        return;
      }
      const text = outputText(toValue(html));
      if (texts[part].length + text.length > templateLimits.renderedCharacters) {
        throw new PromptTooLong({ part });
      }
      texts[part] += text;
    },
    prompt: () =>
      hasInstructions ? { instructions: texts.instructions, message: texts.message } : { message: texts.message },
  };
}

function tooLongOf(cause: unknown, line: number): RenderFailure | undefined {
  return cause instanceof PromptTooLong ? { reason: 'too_long', part: cause.part, line } : undefined;
}

export function renderTemplate(
  parsed: ParsedTemplate,
  hasInstructions: boolean,
  scope: TemplateScope,
  clock: RenderClock,
): Result.Result<RenderedPrompt, RenderFailure> {
  const emitter = promptEmitter(hasInstructions);
  const variables = { input: scope.input, today: scope.today, now: scope.now };
  return Result.map(renderedTemplate(engine, parsed, { variables, emitter, refusalOf: tooLongOf, clock }), () =>
    emitter.prompt(),
  );
}
