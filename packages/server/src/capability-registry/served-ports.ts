import type { AppRuntime } from '@on.auto/api';
import { LicensedFeatures, type LicensedFeaturesPorts } from '@on.auto/meter';
import type { CapabilityDatabase, ProvidedCapability } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import type { FilledPoint, PortsOfTheServer } from '../extensions/capability-points.ts';
import { inRuntime } from '../workflows/in-runtime.ts';

type ProvidedInFull = Required<ProvidedCapability>;

export interface ProvidedOnceServed {
  readonly provided: ProvidedInFull;
  readonly servedIn: (runtime: AppRuntime<LicensedFeatures>, database: CapabilityDatabase) => Promise<void>;
}

type GivenAtStart = Omit<PortsOfTheServer, 'database' | 'features'>;

function onceServed<Port>(port: Promise<Port>): Effect.Effect<Port> {
  return Effect.promise(() => port);
}

function databaseOnceServed(opened: Effect.Effect<CapabilityDatabase>): CapabilityDatabase {
  return {
    read: (statement) => Effect.flatMap(opened, (database) => database.read(statement)),
    write: (statement) => Effect.flatMap(opened, (database) => database.write(statement)),
    transaction: (statements) => Effect.flatMap(opened, (database) => database.transaction(statements)),
    readConsistently: (reads) => Effect.flatMap(opened, (database) => database.readConsistently(reads)),
  };
}

function featuresOnceServed(held: Effect.Effect<LicensedFeaturesPorts>): LicensedFeaturesPorts {
  return {
    includes: (asked) => Effect.flatMap(held, (features) => features.includes(asked)),
    refusal: (use) => Effect.flatMap(held, (features) => features.refusal(use)),
  };
}

function inFull({ capability, folders = [], operations = [], dueWork = [] }: ProvidedCapability): ProvidedInFull {
  return { capability, folders, operations, dueWork };
}

export function providedOnceServed(make: FilledPoint, given: GivenAtStart): ProvidedOnceServed {
  const database = Promise.withResolvers<CapabilityDatabase>();
  const features = Promise.withResolvers<LicensedFeaturesPorts>();
  const provided = make({
    ...given,
    database: databaseOnceServed(onceServed(database.promise)),
    features: featuresOnceServed(onceServed(features.promise)),
  });
  return {
    provided: inFull(provided),
    servedIn: async (runtime, opened) => {
      features.resolve(await Effect.runPromise(inRuntime(runtime, Effect.service(LicensedFeatures))));
      database.resolve(opened);
    },
  };
}
