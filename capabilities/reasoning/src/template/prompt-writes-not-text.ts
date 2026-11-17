import { Data } from 'effect';

import type { NotTextReason, PromptPart } from './compiled-template.ts';

export class PromptWritesNotText extends Data.TaggedError('prompt_writes_not_text')<{
  readonly part: PromptPart;
  readonly reason: NotTextReason;
}> {}
