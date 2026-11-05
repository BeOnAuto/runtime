import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import { momentVariables } from '@on.auto/definitions/tool-blocks';
import { Clock, Effect, type Schema } from 'effect';

import type { AskingSignIn, SignInDocument } from '../document/interaction-document.ts';
import { checkedArguments, roomFor, type InteractionPorts } from '../run/request-reach.ts';
import { messagePart, renderedPart } from '../run/request-rendering.ts';
import { signInAsked } from './sign-in-call.ts';
import { signedInAtOnce } from './sign-in-endings.ts';
import { reachedPerson } from './sign-in-reach.ts';
import { linkedRequest, requestOf } from './sign-in-request.ts';

export interface SignInAsking {
  readonly ports: InteractionPorts;
  readonly document: SignInDocument;
  readonly asking: AskingSignIn;
}

export function askedOf(
  { ports, document, asking }: SignInAsking,
  input: Schema.Json,
  context: RunContext,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  return Effect.gen(function* () {
    const person = yield* reachedPerson(ports, context, document);
    yield* roomFor(ports, { org: context.org, playbook: context.playbook });
    const at = yield* Clock.currentTimeMillis;
    const message = yield* renderedPart(
      { ...messagePart, template: asking.message },
      momentVariables(input, new Date(at).toISOString()),
    );
    const request = requestOf(asking, { person, message, at });
    yield* checkedArguments(request, { input, runId: context.id, functionName: context.definition.name });
    const { site } = document.signIn;
    const answer = yield* signInAsked(
      ports.tools,
      document.signIn,
      { site, request: `${context.playbook}/${context.id}`, until: request.expires_at },
      context,
    );
    if (answer.signedIn) {
      return signedInAtOnce(document.signIn);
    }
    const linked = yield* linkedRequest(request, document.signIn, answer.link);
    return { finishesLater: true, record: linked };
  });
}
