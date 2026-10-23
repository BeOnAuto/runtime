import { reactingOn } from '../reactions/reacting.ts';
import type { ReactionUse } from '../reactions/reaction-consumers.ts';
import { playbookSweepsOn } from '../sweeps/playbook-sweeps.ts';
import { followedPlaybooksOn } from './followed-playbooks.ts';
import type { FollowerHost } from './follower-host.ts';
import { startFollower, type Follower, type FollowerParts } from './follower-loop.ts';
import { playbookDiscoveryOn } from './playbook-discovery.ts';
import { passOf, type PassParts } from './playbook-pass.ts';
import type { PlaybookRecords } from './playbook-records.ts';
import { playbookOfKey, type StepParts } from './record-steps.ts';

export interface FollowerAssembly extends ReactionUse {
  readonly records: PlaybookRecords;
  readonly appended: FollowerParts['appended'];
  readonly pace: FollowerParts['pace'];
  readonly consumers: PassParts['registered'];
  readonly calls: PassParts['calls'];
}

export function followerOn(host: FollowerHost, assembly: FollowerAssembly): Follower {
  const { database, clock, reports } = host;
  const playbooks = followedPlaybooksOn(database);
  const reacting = reactingOn(host, assembly);
  const unreadable: StepParts['unreadable'] = (playbookKey, { id, type }) =>
    reports.note({ kind: 'record_unreadable', ...playbookOfKey(playbookKey), recordId: id, type });
  const pass = passOf({
    database,
    records: assembly.records,
    playbooks,
    consumers: reacting.consumers,
    registered: assembly.consumers,
    calls: assembly.calls,
    definitionType: assembly.options.definitionType,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    unreadable,
    passedEarly: (playbookKey, { stream, version }, sweeps) =>
      reports.note({
        kind: 'run_record_passed',
        run: { ...playbookOfKey(playbookKey), runId: stream.slice(stream.lastIndexOf('/') + 1) },
        version,
        sweeps,
      }),
  });
  const discovery = playbookDiscoveryOn({
    database,
    playbooks,
    placeAtOpen: host.placeAtOpen,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    unreadable,
    definitionType: assembly.options.definitionType,
  });
  return startFollower({
    pass,
    discovery,
    sweeps: playbookSweepsOn(database.store, playbooks),
    upkeep: reacting.upkeep,
    appended: assembly.appended,
    clock,
    pace: assembly.pace,
    sweepEveryMs: host.sweepEveryMs,
    trouble: reports.trouble,
    context: host.context,
  });
}
