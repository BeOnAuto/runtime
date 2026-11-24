import { Context } from 'effect';

export interface SubjectTokensOfACall {
  signedFor(asked: { readonly org: string; readonly audience: string }): Promise<string>;
}

export class CallSubjectTokens extends Context.Service<CallSubjectTokens, SubjectTokensOfACall>()(
  '@on.auto/operations/CallSubjectTokens',
) {}
