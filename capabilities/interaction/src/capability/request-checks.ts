import type { InvalidInput, PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';
import { cardCheck } from './card-check.ts';
import { firstMessageCheck, tellCheck, type TellCheckPorts } from './tell-check.ts';

export type RequestCheckPorts = TellCheckPorts;

export function requestCheck(
  ports: RequestCheckPorts,
): (document: RequestDocument, place: PlaybookAddress) => Effect.Effect<void, InvalidInput> {
  const tells = tellCheck(ports);
  const cards = cardCheck(ports.tools);
  return (document, place) =>
    Effect.andThen(firstMessageCheck(document), Effect.andThen(tells(document, place), cards(document, place)));
}
