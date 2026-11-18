import { followedOrgsKnowingHolds, heldTriesOn } from '../holds/known-holds.ts';
import { failedRoundsOn } from '../loop/failed-rounds.ts';
import { reactingOn } from '../reactions/reacting.ts';
import type { ReactionUse } from '../reactions/reaction-consumers.ts';
import { orgSweepsOn } from '../sweeps/org-sweeps.ts';
import type { FollowerHost } from './follower-host.ts';
import type { FollowerWork } from './follower-wake-up.ts';
import { orgDiscoveryOn } from './org-discovery.ts';
import { passesOf, type PassParts } from './org-pass.ts';
import { passReportsOf } from './pass-reports.ts';

type FollowerConsumer = PassParts['registered'][number] | PassParts['calls'][number];

export interface FollowerAssembly extends ReactionUse {
  readonly records: PassParts['records'];
  readonly appended: FollowerWork['appended'];
  readonly consumers: readonly FollowerConsumer[];
  readonly calls: PassParts['calls'];
}

export function followerWorkOn(host: FollowerHost, assembly: FollowerAssembly): FollowerWork {
  const { database, clock, reports, sweepEveryMs } = host;
  const orgs = followedOrgsKnowingHolds(database);
  const reacting = reactingOn(host, assembly);
  const passReports = passReportsOf(host);
  const registered = assembly.consumers.filter((consumer) => 'batchOf' in consumer);
  const calls = assembly.consumers.filter((consumer) => 'read' in consumer);
  const passes = passesOf({
    ...passReports,
    database,
    records: assembly.records,
    orgs,
    names: database.store,
    consumers: reacting.consumers,
    registered,
    calls: [...assembly.calls, ...calls],
    definitionType: assembly.options.definitionType,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    factPayloadsOf: host.factPayloadsOf,
  });
  const discovery = orgDiscoveryOn({
    database,
    orgs,
    placeAtOpen: host.placeAtOpen,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    unreadable: passReports.unreadable,
    definitionType: assembly.options.definitionType,
  });
  return {
    passes,
    discovery,
    sweeps: orgSweepsOn(database.store, orgs),
    upkeep: reacting.upkeep,
    appended: assembly.appended,
    holds: heldTriesOn(orgs, passReports.holdNotes),
    rounds: failedRoundsOn(database, 'follower'),
    clock,
    sweepEveryMs,
    trouble: reports.trouble,
    context: host.context,
  };
}
