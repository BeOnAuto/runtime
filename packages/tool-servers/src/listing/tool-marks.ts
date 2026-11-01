import { toolMarkOf, type GivenMark, type ListedTool, type MarkedBy, type ServedTool } from '../bounds/tool-results.ts';
import type { ServerSettings } from '../settings/server-settings.ts';

type Marking = Pick<ServerSettings, 'type' | 'provider' | 'marks'>;

function givenMarkOf({ marks }: Marking, tool: string): GivenMark | undefined {
  if (marks.reads.includes(tool)) {
    return 'reads';
  }
  return marks.acts.includes(tool) ? 'acts' : undefined;
}

function givenBy({ type, provider }: Marking, given: GivenMark | undefined): MarkedBy {
  if (given !== undefined) {
    return provider === null ? 'settings' : 'catalogue';
  }
  return type === 'openapi' ? 'method' : 'server';
}

export function unlistedMarksOf(tools: readonly ServedTool[], { marks }: Marking): readonly string[] {
  const listed = new Set(tools.map(({ name }) => name));
  return [...marks.reads, ...marks.acts].filter((tool) => !listed.has(tool));
}

export function markedTool(tool: ServedTool, marking: Marking): ListedTool {
  const given = givenMarkOf(marking, tool.name);
  return { ...tool, mark: toolMarkOf(tool.annotations, given), marked_by: givenBy(marking, given) };
}
