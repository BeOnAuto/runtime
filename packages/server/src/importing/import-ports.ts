import type { ImportServers } from '@on.auto/definitions/importing';
import { parseModelReference, type OfferedModels } from '@on.auto/reasoning';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Array as Arr, Effect, Option } from 'effect';

export function serversPresentIn(listServers: ToolAccess['listServers']): ImportServers {
  return {
    present: (org, named) =>
      Effect.map(
        Effect.filter(named, (server) =>
          Effect.map(listServers({ org, playbook: undefined }, server), Arr.isReadonlyArrayNonEmpty),
        ),
        (found: readonly string[]) => new Set(found),
      ),
  };
}

export function modelOfferedBy({ providers, aliases }: OfferedModels): (model: string) => boolean {
  return (model) =>
    aliases.includes(model) ||
    Option.match(parseModelReference(model), {
      onNone: () => false,
      onSome: ({ provider }) => providers.includes(provider),
    });
}
