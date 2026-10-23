import { Layer } from 'effect';

import { serverOptionsComposing } from '../../server-options/composed-options.ts';
import { servedBy, type Composed, type ServerOptions } from '../../server-options/server-options.ts';

export function optionsComposing(services: Layer.Layer<never>, serve: Composed<never>['serve']): ServerOptions<never> {
  return serverOptionsComposing(() => ({ services, serve }));
}

export function optionsServing(serve: Composed<never>['serve']): ServerOptions<never> {
  return optionsComposing(Layer.empty, serve);
}

export const defaultServerOptions: ServerOptions<never> = optionsServing(() => servedBy([]));
