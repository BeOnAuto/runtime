import { capitalized } from '@on.auto/phrasing';

import type { ToolReference } from '../names/tool-reference.ts';
import { toolInWords } from '../names/tool-words.ts';
import type { ActingMark, NotReadOnlyOnce } from './called-once.ts';

const markInWords: Readonly<Record<ActingMark, string>> = {
  acts: 'is marked acts',
  unmarked: 'carries no mark, which counts as acts',
};

export function notReadOnlyOnce(reference: ToolReference, mark: ActingMark): NotReadOnlyOnce {
  return {
    kind: 'unopened',
    refused: 'tool_not_read_only',
    mark,
    detail: `${capitalized(toolInWords(reference))} ${markInWords[mark]}, and the call needs one marked reads, so it was not sent`,
  };
}
