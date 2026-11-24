import { issueText } from '@on.auto/definitions/document';
import { InvalidInput, type PlaybookAddress } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';
import { cardHoldsAButton } from '../rendering/button-issues.ts';
import type { ConversationsOf } from '../tellings/telling-routes.ts';

export interface CardCheckPorts {
  readonly tools: Pick<ToolAccess, 'listServers'>;
  readonly conversationsOf: ConversationsOf;
}

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

function refusedAs({ deliverLine }: RequestDocument, pointer: string, detail: string): InvalidInput {
  return new InvalidInput({
    detail: 'The interaction function definition has a problem',
    issues: [{ pointer: '', detail: issueText({ line: deliverLine, pointer, detail }) }],
  });
}

const noSentWords =
  'A card with buttons finds its message again from a click through deliver.sent, so write sent with the conversation and the id the sending tool answers, for example sent: { conversation: /channel, id: /ts }';

function noUpdateWords(server: string): string {
  return `Nothing says how a message sent through ${quoted(server)} is drawn again, so its buttons would stay as they were after a click: send it through a connection whose provider declares how, or remove the buttons`;
}

function noClickWords(server: string): string {
  return `Nothing says that a click on a message sent through ${quoted(server)} reaches Auto, so its buttons would do nothing: send it through a connection whose provider declares clicks, or remove the buttons`;
}

function buttonsRefusal(
  document: RequestDocument,
  server: string,
  part: { readonly update?: unknown; readonly clicks?: true } | undefined,
): InvalidInput | undefined {
  if (part?.update === undefined) {
    return refusedAs(document, '/deliver', noUpdateWords(server));
  }
  return part.clicks === true ? undefined : refusedAs(document, '/deliver', noClickWords(server));
}

export function cardCheck(
  ports: CardCheckPorts,
): (document: RequestDocument, place: PlaybookAddress) => Effect.Effect<void, InvalidInput> {
  return (document, place) => {
    const deliver = document.route?.deliver;
    if (deliver === undefined) {
      return Effect.void;
    }
    return Effect.gen(function* () {
      const servers = yield* ports.tools.listServers(place, deliver.server);
      const listed = servers.find(({ name }) => name === deliver.server);
      if (document.render === undefined) {
        if (listed?.renders !== undefined) {
          yield* Effect.fail(refusalOf(document, deliver.server, listed.renders));
        }
        return;
      }
      if (!cardHoldsAButton(document.render.card) || listed === undefined) {
        return;
      }
      if (deliver.sent === undefined) {
        yield* Effect.fail(refusedAs(document, '/deliver', noSentWords));
      }
      const part = yield* ports.conversationsOf(listed.provider);
      const refusal = buttonsRefusal(document, deliver.server, part);
      if (refusal !== undefined) {
        yield* Effect.fail(refusal);
      }
    });
  };
}
