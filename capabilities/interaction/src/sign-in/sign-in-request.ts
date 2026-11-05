import { unworkable } from '@on.auto/definitions/tool-blocks';
import type { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import type { AskingSignIn, SignInSite } from '../document/interaction-document.ts';
import type { RequestRecord } from '../run/request-record.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import { signInAnswerSchema } from './sign-in-schemas.ts';

export interface Asked {
  readonly person: string;
  readonly message: string;
  readonly at: number;
}

const utf8 = new TextEncoder();

export function requestOf(asking: AskingSignIn, { person, message, at }: Asked): RequestRecord {
  return {
    to: person,
    message,
    answer_schema: signInAnswerSchema,
    answerer: person,
    expires_at: new Date(at + asking.expiresMs).toISOString(),
    requested_at: new Date(at).toISOString(),
    ...(asking.route === undefined ? {} : { deliver: asking.route.deliver }),
  };
}

export function linkedRequest(
  request: RequestRecord,
  { server, site }: SignInSite,
  link: string,
): Effect.Effect<RequestRecord, Conflict> {
  const message = `${request.message}\n\n${link}`;
  const bytes = utf8.encode(message).byteLength;
  return bytes <= interactionBounds.messageBytes
    ? Effect.succeed({ ...request, message, sign_in: { server, site, link } })
    : Effect.fail(
        unworkable(
          '',
          `The message with the link where the person signs in takes ${bytes} bytes, more than the ${interactionBounds.messageBytes} a request may hold`,
        ),
      );
}
