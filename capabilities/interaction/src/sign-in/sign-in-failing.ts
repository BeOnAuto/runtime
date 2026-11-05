import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import { RunUnanswered } from '@on.auto/operations';
import { Effect } from 'effect';

import type { SignInDocument } from '../document/interaction-document.ts';
import type { InteractionPorts } from '../run/request-reach.ts';
import { signedInNow } from './sign-in-call.ts';
import { signedInAtOnce } from './sign-in-endings.ts';
import { reachedPerson } from './sign-in-reach.ts';
import { signedOutWords } from './sign-in-words.ts';

export function failingOf(
  ports: InteractionPorts,
  document: SignInDocument,
  context: RunContext,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  return Effect.gen(function* () {
    yield* reachedPerson(ports, context, document);
    const signedIn = yield* signedInNow(ports.tools, document.signIn, context);
    return signedIn
      ? signedInAtOnce(document.signIn)
      : yield* new RunUnanswered({ detail: signedOutWords(document.signIn), kind: 'signed_out' });
  });
}
