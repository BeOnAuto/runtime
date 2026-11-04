import { noStrippedForms, type StrippedForms } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { InvalidInput, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import type { ToolAccess, ToolServer } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { CallLookupDocument, LookupFunctionDefinitionDocument } from '../document/lookup-document.ts';
import { actingInWords, notOfferedInWords, notServedInWords, unreachableInWords } from './mark-words.ts';

export type MarkPorts = Pick<ToolAccess, 'listServers'>;

type MarkCheck = (
  document: LookupFunctionDefinitionDocument,
  source: string,
  place: PlaybookAddress,
) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;

function refusedAtTheCall({ callLine }: CallLookupDocument, detail: string): InvalidInput {
  return new InvalidInput({
    detail: 'The lookup function definition has a problem',
    issues: [{ pointer: '', detail: issueText({ line: callLine, pointer: '/call', detail }) }],
  });
}

function refusalOf(
  document: CallLookupDocument,
  servers: readonly ToolServer[],
): InvalidInput | Unavailable | undefined {
  const { call } = document;
  const server = servers.find(({ name }) => name === call.server);
  if (server === undefined) {
    return refusedAtTheCall(document, notServedInWords(call));
  }
  if ('unavailable' in server) {
    return new Unavailable({ detail: unreachableInWords(server) });
  }
  const named = server.tools.filter(({ name }) => name === call.tool);
  if (named.length === 0) {
    return refusedAtTheCall(document, notOfferedInWords(call, server));
  }
  const actingMark = named.map(({ mark }) => mark).find((mark) => mark !== 'reads');
  return actingMark === undefined ? undefined : refusedAtTheCall(document, actingInWords(call, actingMark, server));
}

function toolChecked(ports: MarkPorts, document: CallLookupDocument, place: PlaybookAddress) {
  return Effect.flatMap(ports.listServers(place, document.call.server), (servers) => {
    const refusal = refusalOf(document, servers);
    return refusal === undefined ? Effect.succeed(noStrippedForms) : Effect.fail(refusal);
  });
}

export function markCheck(ports: MarkPorts): MarkCheck {
  return (document, _source, place) =>
    document.kind === 'call' ? toolChecked(ports, document, place) : Effect.succeed(noStrippedForms);
}
