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

export interface LinkChoices {
  readonly allowAt: string;
  readonly denyAt: string;
  readonly tryAgainAt: string;
}

export interface ServiceNamed {
  readonly service: string;
  readonly app: string;
}

export interface LinkAllowAsked extends Pick<LinkChoices, 'allowAt' | 'denyAt'> {
  readonly service: string;
  readonly memberName: string;
  readonly accountName: string;
}

export type LinkShown =
  | { readonly allow: LinkAllowAsked }
  | { readonly unnamed: { readonly service: string; readonly tryAgainAt: string } }
  | { readonly code: ServiceNamed & { readonly code: string } }
  | { readonly denied: ServiceNamed }
  | { readonly ended: true };

export interface AccountLinking {
  readonly opened: (value: string) => Promise<boolean>;
  readonly allowShown: (value: string, choices: LinkChoices) => Promise<LinkShown>;
  readonly allowed: (value: string, person: string) => Promise<LinkShown>;
  readonly denied: (value: string) => Promise<LinkShown>;
  readonly codeSealed: (code: string) => Promise<string>;
  readonly codeShownAgain: (sealed: string) => Promise<LinkShown>;
}

export type PageShown =
  | { readonly allow: AllowAsked }
  | { readonly signingOut: SigningOut }
  | { readonly notOpen: { readonly client: string | undefined } }
  | { readonly invitationEnded: true }
  | { readonly link: LinkShown }
  | { readonly refused: SignInRefusal; readonly tryAgainAt: string | undefined };

export interface SignInPage {
  readonly status: number;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type SignInPages = (shown: PageShown) => Promise<SignInPage>;
