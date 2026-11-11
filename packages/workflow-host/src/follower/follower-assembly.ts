import { followedPlaybooksKnowingHolds, heldTriesOn } from '../holds/known-holds.ts';
import { failedRoundsOn } from '../loop/failed-rounds.ts';
import { reactingOn } from '../reactions/reacting.ts';
import type { ReactionUse } from '../reactions/reaction-consumers.ts';
import { playbookSweepsOn } from '../sweeps/playbook-sweeps.ts';
import type { FollowerHost } from './follower-host.ts';
import type { FollowerWork } from './follower-wake-up.ts';
import { passReportsOf } from './pass-reports.ts';
import { playbookDiscoveryOn } from './playbook-discovery.ts';
import { passOf, type PassParts } from './playbook-pass.ts';

export interface FollowerAssembly extends ReactionUse {
  readonly records: PassParts['records'];
  readonly appended: FollowerWork['appended'];
  readonly consumers: PassParts['registered'];
  readonly calls: PassParts['calls'];
}

export function followerWorkOn(host: FollowerHost, assembly: FollowerAssembly): FollowerWork {
  const { database, clock, reports } = host;
  const playbooks = followedPlaybooksKnowingHolds(database);
  const reacting = reactingOn(host, assembly);
  const passReports = passReportsOf(host);
  const pass = passOf({
    ...passReports,
    database,
    records: assembly.records,
    playbooks,
    consumers: reacting.consumers,
    registered: assembly.consumers,
    calls: assembly.calls,
    definitionType: assembly.options.definitionType,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    factPayloadsOf: host.factPayloadsOf,
  });
  const discovery = playbookDiscoveryOn({
    database,
    playbooks,
    placeAtOpen: host.placeAtOpen,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    unreadable: passReports.unreadable,
    definitionType: assembly.options.definitionType,
  });
  return {
    pass,
    discovery,
    sweeps: playbookSweepsOn(database.store, playbooks),
    upkeep: reacting.upkeep,
    appended: assembly.appended,
    holds: heldTriesOn(playbooks, passReports.holdNotes),
    rounds: failedRoundsOn(database, 'follower'),
    clock,
    sweepEveryMs: host.sweepEveryMs,
    trouble: reports.trouble,
    context: host.context,
  };
}
