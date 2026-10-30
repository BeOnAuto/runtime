import { Clock, Effect, Option } from 'effect';

import type { ListedSource } from '../listing/listing-request.ts';
import type { ModelSource } from '../listing/model-sources.ts';
import { aliasResolution } from '../model/model-alias.ts';
import { modelOffer } from '../model/model-offer.ts';
import { parseModelReference } from '../model/model-reference.ts';
import type { CachedListing, ListingCache } from './listing-cache.ts';
import { refreshOf, type ListingReports } from './listing-refresh.ts';
import { aliasEntryOf, anyModelOf, byId, entryOf, uniqueById } from './model-entries.ts';
import type { ModelEntry, ModelList } from './model-list.ts';

export interface ModelCatalog {
  readonly list: (provider?: string) => Effect.Effect<ModelList>;
  readonly contextWindowOf: (model: string) => Effect.Effect<number | undefined>;
}

export interface CatalogParts {
  readonly sources: readonly ModelSource[];
  readonly providers: readonly string[];
  readonly aliases: ReadonlyMap<string, string>;
  readonly allowed: readonly string[] | null;
  readonly cache: ListingCache;
  readonly reports: ListingReports;
}

interface Gathered {
  readonly entries: readonly ModelEntry[];
  readonly listedAt: number | null;
  readonly complete: boolean;
}

function gatheredFrom({ provider, fallback }: ListedSource, { listing, current }: CachedListing): Gathered {
  return {
    entries: (listing?.models ?? fallback).map((model) => entryOf(provider, model)),
    listedAt: listing?.listedAt ?? null,
    complete: current,
  };
}

function gathered({ cache, reports }: CatalogParts, source: ModelSource): Effect.Effect<Gathered> {
  if (source.kind === 'declared') {
    const { provider, models } = source;
    const entries = models.length === 0 ? [anyModelOf(provider)] : models.map((model) => entryOf(provider, model));
    return Effect.succeed({ entries, listedAt: null, complete: true });
  }
  return Effect.map(cache.read(source.provider, refreshOf(reports, source)), (cached) => gatheredFrom(source, cached));
}

function listedAtOf(all: readonly Gathered[], now: number): string {
  const times = all.flatMap(({ listedAt }) => (listedAt === null ? [] : [listedAt]));
  return new Date(times.length === 0 ? now : Math.min(...times)).toISOString();
}

function servedBy(provider: string | undefined): (served: string) => boolean {
  return (served) => provider === undefined || served === provider;
}

function windowIn(parts: CatalogParts, model: string): Effect.Effect<number | undefined> {
  return Option.match(parseModelReference(model), {
    onNone: () => Effect.undefined,
    onSome: ({ provider }) =>
      Effect.map(
        Effect.forEach(
          parts.sources.filter((source) => source.provider === provider),
          (source) => gathered(parts, source),
        ),
        (all: readonly Gathered[]) =>
          all.flatMap(({ entries }) => entries).find(({ id }) => id === model)?.context_window,
      ),
  });
}

export function catalogListing(parts: CatalogParts): ModelCatalog {
  const resolve = aliasResolution(parts.aliases);
  const offer = modelOffer(parts.allowed);
  const aliasEntries = [...parts.aliases]
    .filter(([alias, target]: readonly [string, string]) => offer.offers(alias) || offer.offers(target))
    .map((alias: readonly [string, string]) => aliasEntryOf(alias))
    .filter(({ owned_by: ownedBy }) => parts.providers.includes(ownedBy));
  return {
    list: (provider) =>
      Effect.gen(function* () {
        const chosen = parts.sources.filter((source) => servedBy(provider)(source.provider));
        const all = yield* Effect.forEach(chosen, (source) => gathered(parts, source), { concurrency: 'unbounded' });
        const now = yield* Clock.currentTimeMillis;
        const reachable = all
          .flatMap(({ entries }) => entries)
          .filter(({ id }) => resolve(id) === id && offer.offers(id));
        const aliases = aliasEntries.filter(({ owned_by: ownedBy }) => servedBy(provider)(ownedBy));
        const list: ModelList = {
          object: 'list',
          data: uniqueById([...aliases, ...reachable]).toSorted(byId),
          catalog_status: all.every(({ complete }) => complete) ? 'complete' : 'partial',
          narrowed: parts.allowed !== null,
          listed_at: listedAtOf(all, now),
        };
        return list;
      }),
    contextWindowOf: (model) => windowIn(parts, resolve(model)),
  };
}
