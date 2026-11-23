import { listed, quoted } from '@on.auto/phrasing';

import type { EventTypeReported } from './connection-ports.ts';

export function notServingWords(connection: string): string {
  return `No connection named ${connection} serves this playbook. Give source as /connections/ followed by the name of one that does; list_connections lists the connections and the playbooks that may use each. Where the connection exists but this playbook may not use it, ask the person to change that in Studio (Settings, Connections, open the connection, then Change beside "Available to")`;
}

export function pendingWords(connection: string): string {
  return `The connection ${connection} is not connected yet, so no workflow can start from it. Ask the person to finish connecting it; \`reconnect_connection\` gives a new link. Save this workflow again once they have`;
}

export function notReportedWords(connection: string, type: string, types: readonly EventTypeReported[]): string {
  return types.length === 0
    ? `The connection ${connection} lists no events. To start this workflow from what one of its tools lists, add \`read\` to this filter, as the events guide shows under Filters. If none of its tools can list what is new, tell the person that, and ask whether the workflow should start at a set time each day instead, or only when someone runs it`
    : `The connection ${connection} has no event named ${type}. It has ${listed(types.map((reported) => `${reported.type} (${reported.title})`))}`;
}

export function lackingWords(connection: string, type: string, label: string): string {
  return `The connection ${connection} can report ${type} events here only once it holds its ${label}. \`reconnect_connection\` gives a link where the person gives it; save this workflow again once they have`;
}

export function notHeardWords(connection: string, type: string): string {
  return `This runtime does not receive ${type} events from the connection ${connection}, so no workflow here can start from one. Tell the person, and ask whether the workflow should start on a schedule instead, or only when someone runs it`;
}

export function brokenWords(connection: string): string {
  return `The connection ${connection} is broken, so no workflow can start from it until it is reconnected. reconnect_connection gives a link for the person to open; save this workflow again once it has been used`;
}

export function subjectWords(type: string, title: string): string {
  return `Add subject to this filter, naming the ${quoted(title)} to listen in: ${type} needs one`;
}

export function tooManyPlacesWords(connection: string, count: number, most: number): string {
  return `With this filter, the playbook's triggers would listen in ${count} places through ${connection}, and a playbook listens in at most ${most} through one connection. Listen in fewer places, or in places its other workflows already listen in`;
}

export const listenedForWords =
  "A step cannot wait for an event of a connection. Start a workflow from it instead: name the connection's `source` in a trigger under `schedule.on`, as the triggers guide shows";
