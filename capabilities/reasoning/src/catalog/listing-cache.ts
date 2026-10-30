import { Clock, Effect } from 'effect';

import type { ListedModel } from '../listing/listed-model.ts';

const freshForMs = 300_000;

const failureKeptForMs = 60_000;

interface Listing {
  readonly models: readonly ListedModel[];
  readonly listedAt: number;
}

export interface CachedListing {
  readonly listing: Listing | null;
  readonly current: boolean;
}

export interface ListingCache {
  readonly read: (key: string, refresh: Effect.Effect<readonly ListedModel[] | null>) => Effect.Effect<CachedListing>;
}

export function listingCache(): ListingCache {
  const listings = new Map<string, Listing>();
  const failures = new Map<string, number>();
  const refreshing = new Map<string, Promise<Listing | null>>();
  const lastKnown = (key: string): CachedListing => ({ listing: listings.get(key) ?? null, current: false });
  const kept = (key: string, refresh: Effect.Effect<readonly ListedModel[] | null>): Effect.Effect<Listing | null> =>
    Effect.flatMap(refresh, (models) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        if (models === null) {
          failures.set(key, now);
          return null;
        }
        const listing: Listing = { models, listedAt: now };
        listings.set(key, listing);
        failures.delete(key);
        return listing;
      }),
    );
  const started = (key: string, refreshed: Promise<Listing | null>): Promise<Listing | null> => {
    const forget = (): void => {
      refreshing.delete(key);
    };
    refreshing.set(key, refreshed);
    void refreshed.then(forget, forget);
    return refreshed;
  };
  return {
    read: (key, refresh) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const cached = listings.get(key);
        if (cached !== undefined && now - cached.listedAt < freshForMs) {
          return { listing: cached, current: true };
        }
        const failedAt = failures.get(key);
        if (failedAt !== undefined && now - failedAt < failureKeptForMs) {
          return lastKnown(key);
        }
        const context = yield* Effect.context();
        const refreshed = yield* Effect.sync(
          () => refreshing.get(key) ?? started(key, Effect.runPromiseWith(context)(kept(key, refresh))),
        );
        const listing = yield* Effect.promise(() => refreshed);
        return listing === null ? lastKnown(key) : { listing, current: true };
      }),
  };
}
