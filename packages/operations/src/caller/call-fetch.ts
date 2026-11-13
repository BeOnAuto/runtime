import { Context } from 'effect';

export type CallMeta = Readonly<Record<string, string | boolean>>;

type SentBeside<Asked extends readonly unknown[]> = (
  ...asked: readonly [...Asked, meta?: CallMeta]
) => Promise<Response>;

export type FetchOfACall = SentBeside<Parameters<typeof globalThis.fetch>>;

export class CallFetch extends Context.Service<CallFetch, FetchOfACall>()('@on.auto/operations/CallFetch') {}
