import { Context } from 'effect';

export class CallFetch extends Context.Service<CallFetch, typeof globalThis.fetch>()('@on.auto/operations/CallFetch') {}
