import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import type { Effect, Schema } from 'effect';

import { callRun } from '../call/call-run.ts';
import type { InteractionFunctionDefinitionDocument } from '../document/interaction-document.ts';
import { requestRun } from '../run/interaction-run.ts';
import type { InteractionPorts } from '../run/request-reach.ts';
import { signInRun } from '../sign-in/sign-in-run.ts';

type ShapeRun = (
  document: InteractionFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;

export function shapeRunOf(ports: InteractionPorts): ShapeRun {
  const asked = requestRun(ports);
  const called = callRun(ports);
  const signedIn = signInRun(ports);
  return (document, input, context) => {
    if (document.shape === 'sign_in') {
      return signedIn(document, input, context);
    }
    return document.shape === 'call' ? called(document, input, context) : asked(document, input, context);
  };
}
