import { createApiHandler, type ApiHandler, type ApiOptions, type CallContext } from '@on.auto/api';
import type { SendToDirectory } from '@on.auto/chat';
import type { Principal } from '@on.auto/identity';
import { Context } from 'effect';

export interface InProcessDirectory {
  readonly asking: <A>(
    caller: Principal,
    context: Context.Context<never>,
    use: (send: SendToDirectory) => Promise<A>,
  ) => Promise<A>;
}

interface DirectoryOptions extends Omit<ApiOptions, 'authenticator' | 'callContext'> {
  readonly callContext: CallContext;
}

export interface ComposedLater extends InProcessDirectory {
  readonly composed: (options: DirectoryOptions) => ApiHandler;
}

const NOT_A_TURN = 'This credential is held for the turn of a conversation alone';

export function inProcessDirectory(): ComposedLater {
  const callers = new Map<string, Principal>();
  const contexts = new WeakMap<Request, Context.Context<never>>();
  const { promise: handler, resolve } = Promise.withResolvers<ApiHandler>();
  return {
    composed: (options) => {
      const composed = createApiHandler({
        ...options,
        authenticator: {
          mode: 'credentials',
          resource: undefined,
          authenticate: (presented) => Promise.resolve(callers.get(presented ?? '') ?? { because: NOT_A_TURN }),
        },
        callContext: (request) => Context.merge(options.callContext(request), contexts.get(request) ?? Context.empty()),
      });
      resolve(composed);
      return composed;
    },
    asking: async (caller, context, use) => {
      const handle = crypto.randomUUID();
      callers.set(handle, caller);
      const send: SendToDirectory = async (request) => {
        const headers = new Headers(request.headers);
        headers.set('authorization', `Bearer ${handle}`);
        const handed = new Request(request, { headers });
        contexts.set(handed, context);
        return (await handler).fetch(handed);
      };
      try {
        return await use(send);
      } finally {
        callers.delete(handle);
      }
    },
  };
}
