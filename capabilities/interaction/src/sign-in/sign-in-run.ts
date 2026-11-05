import {
  checkedInput,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { unworkable } from '@on.auto/definitions/tool-blocks';
import { Effect, type Schema } from 'effect';

import type { SignInDocument } from '../document/interaction-document.ts';
import type { InteractionPorts } from '../run/request-reach.ts';
import { askedOf } from './sign-in-asking.ts';
import { failingOf } from './sign-in-failing.ts';
import { signInUnsaidWords } from './sign-in-words.ts';

export function signInRun(ports: InteractionPorts) {
  return (
    document: SignInDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<CapabilityAnswer, CapabilityRejection> =>
    Effect.gen(function* () {
      const admitted: Schema.Json = yield* checkedInput(
        input,
        document.input.schema,
        functionResourceLabels.interaction.singular,
      );
      const { whenSignedOut } = document;
      if (whenSignedOut.answer === 'unsaid') {
        return yield* unworkable('/sign_in', signInUnsaidWords(whenSignedOut.question));
      }
      return yield* whenSignedOut.answer === 'fail'
        ? failingOf(ports, document, context)
        : askedOf({ ports, document, asking: whenSignedOut.asking }, admitted, context);
    });
}
