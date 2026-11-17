import { Data } from 'effect';

import type { PromptPart } from './compiled-template.ts';

export class PromptWritesAFile extends Data.TaggedError('prompt_writes_a_file')<{ readonly part: PromptPart }> {}
