import type { CallBlock } from '@on.auto/definitions/tool-blocks';
import { capitalized } from '@on.auto/phrasing';
import { toolInWords, unavailableInWords, type ServerTool, type ToolServer } from '@on.auto/tool-servers';

export type AvailableServer = Extract<ToolServer, { readonly tools: readonly ServerTool[] }>;

type UnavailableServer = Exclude<ToolServer, AvailableServer>;

export type ActingMark = Exclude<ServerTool['mark'], 'reads'>;

const markInWords: Readonly<Record<ActingMark, string>> = {
  acts: 'is marked acts',
  unmarked: 'carries no mark, which counts as acts',
};

const toInteraction = "use an interaction function, or ask the server's author to mark it read-only";

function serverInWords({ name, connection }: Pick<ToolServer, 'name' | 'connection'>): string {
  return connection === undefined ? `the tool server ${name}` : `the connection ${name}`;
}

function othersWhoMark({ provider, connection }: AvailableServer): string {
  if (provider !== null) {
    return `; the providers catalogue may also mark it reads, in its entry for ${provider}`;
  }
  return connection === undefined
    ? '; whoever runs this server may also mark it reads, in the marks of its entry in tool_servers'
    : '';
}

export function actingInWords(call: CallBlock, mark: ActingMark, server: AvailableServer): string {
  return `${capitalized(toolInWords(call))} ${markInWords[mark]}, and a lookup function calls only a tool marked reads: ${toInteraction}${othersWhoMark(server)}.`;
}

export function notServedInWords({ server }: CallBlock): string {
  return `No connection or tool server named ${server} serves this playbook; search lists those that do, and the mark of each of their tools.`;
}

export function notOfferedInWords({ tool }: CallBlock, server: AvailableServer): string {
  return `${capitalized(serverInWords(server))} offers this playbook no tool named ${tool}; search lists the tools it offers, and the mark of each.`;
}

export function unreachableInWords(server: UnavailableServer): string {
  return `${unavailableInWords(server, capitalized(serverInWords(server)))} A lookup function is saved once its tool is seen to be marked reads, so save it again once ${server.name} can be asked.`;
}
