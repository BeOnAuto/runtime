import { Data } from 'effect';

import type { PromptPart } from './compiled-template.ts';

export class PromptTooLong extends Data.TaggedError('prompt_too_long')<{ readonly part: PromptPart }> {}
