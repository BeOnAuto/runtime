import type { AppRuntime, PageStyle } from '@on.auto/api';
import { studioClientOf, type AccessMode, type Authenticator, type IdentityService } from '@on.auto/identity';
import { Data, Function } from 'effect';

import type { Served } from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import type { SignInServing, SignInServingOf, SignInServingParts } from '../sign-in/company-sign-in.ts';

export type { SignInServing } from '../sign-in/company-sign-in.ts';

/** A server that signs people in answers sign-in on a listener of its own, beside its handler, so it has no fetch alone. */
export class SignInNeedsAListener extends Data.TaggedError('SignInNeedsAListener')<{
  readonly message: string;
}> {}

export interface SigningInAtStart {
  readonly settings: Settings;
  readonly pageStyle: PageStyle;
  readonly signInServing: SignInServingOf | undefined;
  readonly mode: AccessMode;
  readonly answering: (identityService: IdentityService | undefined) => Authenticator;
}

export function answeringBy({ answering }: SigningInAtStart, signIn: SignInServing | undefined): Authenticator {
  return answering(signIn?.identityService);
}

function signInPartsOf<R>(
  { settings, pageStyle }: SigningInAtStart,
  runtime: AppRuntime<R>,
  served: Served,
): SignInServingParts {
  const { studio, allowedOrigins } = settings;
  return {
    logged: (log) => {
      void runtime.run(log);
    },
    served,
    pages: { studio, allowedOrigins },
    pageStyle,
    studio: studioClientOf(studio.origin),
  };
}

export function signInServedOn<R>(
  starting: SigningInAtStart,
  runtime: AppRuntime<R>,
  served: Served,
): Promise<SignInServing | undefined> {
  const { signInServing } = starting;
  return signInServing === undefined
    ? Promise.resolve().then(Function.constUndefined)
    : signInServing(signInPartsOf(starting, runtime, served));
}
