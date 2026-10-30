import { Option, Order } from 'effect';

import type { ListedModel } from '../listing/listed-model.ts';
import { isWildcardAlias } from '../model/model-alias.ts';
import { namesAnArn, parseModelReference } from '../model/model-reference.ts';
import type { ModelEntry } from './model-list.ts';

export const byId = Order.mapInput(Order.String, ({ id }: ModelEntry) => id);

export function entryOf(provider: string, { id, ...details }: ListedModel): ModelEntry {
  return { id, object: 'model', owned_by: provider, ...details };
}

export function anyModelOf(provider: string): ModelEntry {
  return { id: `${provider}/*`, object: 'model', created: 0, owned_by: provider, pattern: true };
}

export function aliasEntryOf([alias, target]: readonly [string, string]): ModelEntry {
  return {
    id: alias,
    object: 'model',
    created: 0,
    owned_by: Option.getOrThrow(parseModelReference(target)).provider,
    alias: true,
    ...(namesAnArn(target) ? {} : { resolved_to: target }),
    ...(isWildcardAlias(alias) ? { pattern: true } : {}),
  };
}

export function uniqueById(entries: readonly ModelEntry[]): readonly ModelEntry[] {
  return [...new Map(entries.toReversed().map((entry) => [entry.id, entry])).values()];
}
