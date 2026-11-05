import type { ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { CallBlock } from '@on.auto/definitions/tool-blocks';
import type { CompiledSchema } from '@on.auto/json-schema';

import type { ReplyRule } from '../replies/reply-rule.ts';
import type { WrittenRoute } from '../tool-blocks/compiled-tool-block.ts';

interface WrittenFunction {
  readonly description?: string;
  readonly input: ValueContract;
}

export interface CallDocument extends WrittenFunction {
  readonly shape: 'call';
  readonly call: CallBlock;
  readonly callLine: number;
  readonly output: { readonly schema: CompiledSchema };
}

interface HeldForAnAgent {
  readonly said: boolean;
  readonly line: number;
}

export interface RequestDocument extends WrittenFunction {
  readonly shape: 'request';
  readonly output: ValueContract;
  readonly to: ParsedTemplate;
  readonly from?: ParsedTemplate;
  readonly expires: string;
  readonly expiresMs: number;
  readonly message: ParsedTemplate;
  readonly route?: WrittenRoute;
  readonly heldForAnAgent?: HeldForAnAgent;
  readonly reply?: ReplyRule;
}

export interface SignInSite {
  readonly server: string;
  readonly site: string;
}

export interface AskingSignIn {
  readonly expires: string;
  readonly expiresMs: number;
  readonly message: ParsedTemplate;
  readonly route?: WrittenRoute;
}

export type SignInQuestion = 'if_signed_out' | 'deliver' | 'expires';

export type WhenSignedOut =
  | { readonly answer: 'ask'; readonly asking: AskingSignIn }
  | { readonly answer: 'fail' }
  | { readonly answer: 'unsaid'; readonly question: SignInQuestion; readonly line: number };

export interface SignInDocument extends WrittenFunction {
  readonly shape: 'sign_in';
  readonly signIn: SignInSite;
  readonly whenSignedOut: WhenSignedOut;
  readonly output: { readonly schema: CompiledSchema };
}

export type InteractionFunctionDefinitionDocument = CallDocument | RequestDocument | SignInDocument;
