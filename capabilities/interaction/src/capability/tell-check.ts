import { issueText } from '@on.auto/definitions/document';
import { InvalidInput, type PlaybookAddress } from '@on.auto/operations';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';
import type { ConversationsOf } from '../tellings/telling-routes.ts';

export interface TellCheckPorts {
  readonly tools: Pick<ToolAccess, 'listServers'>;
  readonly conversationsOf: ConversationsOf;
}

function nobodyToldWords(server: string, tool: string): string {
  return `Nothing says how a reply is answered through ${server}, so nobody could be told what became of theirs; write tell.with, the arguments of ${tool} that post under the message, or tell: none to stay silent`;
}

function refusalOf({ repliesLine }: RequestDocument, server: string, tool: string): InvalidInput {
  return new InvalidInput({
    detail: 'The interaction function definition has a problem',
    issues: [
      {
        pointer: '',
        detail: issueText({ line: repliesLine, pointer: '/replies/tell', detail: nobodyToldWords(server, tool) }),
      },
    ],
  });
}

function tellsThroughTheProvider({ route }: RequestDocument): boolean {
  const tell = route?.replies?.tell;
  return route?.replies !== undefined && (tell === undefined || tell === 'all' || tell === 'refusals');
}

export function tellCheck(
  ports: TellCheckPorts,
): (document: RequestDocument, place: PlaybookAddress) => Effect.Effect<void, InvalidInput> {
  return (document, place) => {
    const deliver = document.route?.deliver;
    if (deliver === undefined || !tellsThroughTheProvider(document)) {
      return Effect.void;
    }
    return Effect.gen(function* () {
      const servers = yield* ports.tools.listServers(place, deliver.server);
      const listed = servers.find(({ name }) => name === deliver.server);
      const part = listed === undefined ? undefined : yield* ports.conversationsOf(listed.provider);
      if (listed !== undefined && part === undefined) {
        yield* Effect.fail(refusalOf(document, deliver.server, deliver.tool));
      }
    });
  };
}
