import type { RenderClock } from '@on.auto/definitions/template';
import { templatesIssues, type TemplateSet } from '@on.auto/definitions/tool-blocks';
import { isToolName, toolNameShape } from '@on.auto/tool-servers/policy';
import { JsonPointer, Schema } from 'effect';

export const ArgumentsSchema = Schema.Record(Schema.String, Schema.Json);

type Arguments = typeof ArgumentsSchema.Type;

export interface Placed {
  readonly pointer: string;
  readonly detail: string;
}

export const noLines: ReadonlyMap<string, number> = new Map();

const checkedOn: RenderClock = () => performance.now();

function pathOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

export function issuesOf(placed: readonly Placed[]): readonly Schema.FilterIssue[] {
  return placed.map(({ pointer, detail }) => ({ path: pathOf(pointer), issue: detail }));
}

export function toolIssues(pointer: string, tool: string): readonly Placed[] {
  return isToolName(tool) ? [] : [{ pointer, detail: `Expected ${toolNameShape}` }];
}

export function argumentIssuesOver(set: TemplateSet, pointer: string, written: Arguments): readonly Placed[] {
  return templatesIssues(set, written, { lines: noLines, pointer, inputSchema: undefined, clock: checkedOn });
}
