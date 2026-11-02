import { noStrippedForms, type StrippedForms } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { InvalidInput, type PlaybookAddress } from '@on.auto/operations';
import { capitalized } from '@on.auto/phrasing';
import { onlyReads, toolInWords, type ToolAccess, type ToolServer } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { CallDocument } from '../document/interaction-document.ts';

export type CallCheckPorts = Pick<ToolAccess, 'listServers'>;

function readsOnlyAmong({ call }: CallDocument, servers: readonly ToolServer[]): boolean {
  const named = servers.flatMap((server) =>
    server.name === call.server && 'tools' in server ? server.tools.filter((tool) => tool.name === call.tool) : [],
  );
  return named.length > 0 && named.every((tool) => onlyReads(tool));
}

function aLookupInWords({ call }: CallDocument): string {
  return `${capitalized(toolInWords(call))} is marked reads, and a function that only reads what a system holds is a lookup function: save this one with type lookup, with the same call, input.schema and output.schema, and keep interaction functions for tools that act`;
}

function refusalOf(document: CallDocument): InvalidInput {
  return new InvalidInput({
    detail: 'The interaction function definition has a problem',
    issues: [
      {
        pointer: '',
        detail: issueText({ line: document.callLine, pointer: '/call', detail: aLookupInWords(document) }),
      },
    ],
  });
}

export function callCheck(
  ports: CallCheckPorts,
): (document: CallDocument, place: PlaybookAddress) => Effect.Effect<StrippedForms, InvalidInput> {
  return (document, place) =>
    Effect.flatMap(ports.listServers(place, document.call.server), (servers) =>
      readsOnlyAmong(document, servers) ? Effect.fail(refusalOf(document)) : Effect.succeed(noStrippedForms),
    );
}
