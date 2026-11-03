import { capitalized } from '@on.auto/phrasing';
import { Data } from 'effect';

import type { ToolReference } from '../names/tool-reference.ts';
import { toolInWords } from '../names/tool-words.ts';

export class ToolNotReads extends Data.TaggedError('tool_not_read_only')<{
  readonly detail: string;
}> {}

export function toolNotReads(reference: ToolReference): ToolNotReads {
  return new ToolNotReads({
    detail: `${capitalized(toolInWords(reference))} is not marked reads, so query_connection did not call it; execute_connection calls a tool that may change something`,
  });
}
