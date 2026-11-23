import type { PlaybookAddress } from '@on.auto/operations';
import { capitalized } from '@on.auto/phrasing';
import { unavailableInWords, type ToolServer } from '@on.auto/tool-servers';
import { Effect, type Schema } from 'effect';

interface OfferedTool {
  readonly name: string;
  readonly mark: 'reads' | 'acts' | 'unmarked';
  readonly input_schema: Schema.JsonObject;
}

export type ToolsOffered =
  | { readonly kind: 'listed'; readonly tools: readonly OfferedTool[] }
  | { readonly kind: 'unavailable'; readonly detail: string };

export type ListServers = (playbook: PlaybookAddress, named?: string) => Effect.Effect<readonly ToolServer[]>;

function toolsListedBy(server: ToolServer | undefined, name: string): ToolsOffered {
  const named = capitalized(`the connection ${name}`);
  if (server === undefined) {
    return { kind: 'unavailable', detail: `${named} cannot be asked for its tools here.` };
  }
  if ('unavailable' in server) {
    return { kind: 'unavailable', detail: unavailableInWords(server, named) };
  }
  return {
    kind: 'listed',
    tools: server.tools.map(({ name: tool, mark, input_schema: inputSchema }) => ({
      name: tool,
      mark,
      input_schema: inputSchema,
    })),
  };
}

export function toolsOf(
  listServers: ListServers | undefined,
  playbook: PlaybookAddress,
  name: string,
): Effect.Effect<ToolsOffered> {
  return listServers === undefined
    ? Effect.succeed(toolsListedBy(undefined, name))
    : Effect.map(listServers(playbook, name), (servers) =>
        toolsListedBy(
          servers.find((server) => server.name === name),
          name,
        ),
      );
}
