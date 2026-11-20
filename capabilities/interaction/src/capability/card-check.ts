import { issueText } from '@on.auto/definitions/document';
import { InvalidInput, type PlaybookAddress } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';

export type CardCheckPorts = Pick<ToolAccess, 'listServers'>;

function mustBeACardWords(server: string, target: string): string {
  return `Messages sent through ${quoted(server)} are shown as cards, so this one must be a card: write render: ${target} in the front matter and the card as the body, and read the guide render-${target} first`;
}

function refusalOf({ deliverLine }: RequestDocument, server: string, target: string): InvalidInput {
  return new InvalidInput({
    detail: 'The interaction function definition has a problem',
    issues: [
      {
        pointer: '',
        detail: issueText({ line: deliverLine, pointer: '/render', detail: mustBeACardWords(server, target) }),
      },
    ],
  });
}

export function cardCheck(
  ports: CardCheckPorts,
): (document: RequestDocument, place: PlaybookAddress) => Effect.Effect<void, InvalidInput> {
  return (document, place) => {
    const deliver = document.route?.deliver;
    if (deliver === undefined || document.render !== undefined) {
      return Effect.void;
    }
    return Effect.gen(function* () {
      const servers = yield* ports.listServers(place, deliver.server);
      const target = servers.find(({ name }) => name === deliver.server)?.renders;
      if (target !== undefined) {
        yield* Effect.fail(refusalOf(document, deliver.server, target));
      }
    });
  };
}
