import {
  isTextToWrite,
  outputText,
  renderedTemplate,
  templateLimits,
  type ParsedTemplate,
  type RenderClock,
} from '@on.auto/definitions/template';
import { holdsAnAsset } from '@on.auto/operations';
import { Result } from 'effect';
import { toValue, type Emitter } from 'liquidjs';

import type { PromptPart, RenderedPrompt, RenderFailure, TemplateScope } from './compiled-template.ts';
import { engine, instructionsBegin, instructionsEnd } from './liquid-engine.ts';
import { PromptTooLong } from './prompt-too-long.ts';
import { PromptWritesNotText } from './prompt-writes-not-text.ts';

interface PromptEmitter extends Emitter {
  readonly prompt: () => RenderedPrompt;
  readonly part: () => PromptPart;
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
      const value: unknown = toValue(html);
      if (!isTextToWrite(value)) {
        throw new PromptWritesNotText({ part, reason: holdsAnAsset(value) ? 'kept_file' : 'not_text' });
      }
      const text = outputText(value);
      if (texts[part].length + text.length > templateLimits.renderedCharacters) {
        throw new PromptTooLong({ part });
      }
      texts[part] += text;
    },
    prompt: () =>
      hasInstructions ? { instructions: texts.instructions, message: texts.message } : { message: texts.message },
    part: () => part,
  };
}

function refusalOf(cause: unknown, line: number): RenderFailure | undefined {
  if (cause instanceof PromptWritesNotText) {
    return { reason: cause.reason, part: cause.part, line };
  }
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
  const keptFileAsText = (line: number): RenderFailure => ({ reason: 'kept_file', part: emitter.part(), line });
  return Result.map(renderedTemplate(engine, parsed, { variables, emitter, refusalOf, clock, keptFileAsText }), () =>
    emitter.prompt(),
  );
}
