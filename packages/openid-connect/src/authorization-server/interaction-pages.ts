export type SignInRefusal = 'not_that_account' | 'no_access' | 'not_signed_in';

export type SignInOutcome =
  | { readonly admitted: string }
  | { readonly refused: SignInRefusal }
  | { readonly gaveUp: true };

export interface UpstreamSignInStarted {
  readonly location: string;
  readonly pending: string;
}

export interface SignInAskedOf {
  readonly selectAccount: boolean;
}

export interface NotStarted {
  readonly notStarted: true;
}

export type InvitationOpened = { readonly location: string } | { readonly ended: true };

export interface InteractionSignIn {
  readonly started: (asked: SignInAskedOf) => Promise<UpstreamSignInStarted | NotStarted>;
  readonly finished: (
    callbackQuery: string,
    pending: string | undefined,
    invitation?: string,
  ) => Promise<SignInOutcome>;
  readonly invitationOpened: (secret: string) => Promise<InvitationOpened>;
}

export interface AllowAsked {
  readonly client: string;
  readonly publishedAt: string | undefined;
  readonly deliveredTo: string;
  readonly allowAt: string;
  readonly denyAt: string;
}

interface SigningOut {
  readonly form: string;
  readonly script: string;
}

export type PageShown =
  | { readonly allow: AllowAsked }
  | { readonly signingOut: SigningOut }
  | { readonly notOpen: { readonly client: string | undefined } }
  | { readonly invitationEnded: true }
  | { readonly refused: SignInRefusal; readonly tryAgainAt: string | undefined };

export interface SignInPage {
  readonly status: number;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type SignInPages = (shown: PageShown) => Promise<SignInPage>;
