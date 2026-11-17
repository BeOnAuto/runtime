import type { Goal } from '@on.auto/definitions/goals';
import { askingThePerson, type GoalGap } from '@on.auto/playbooks';

type Milestone = NonNullable<Goal['milestones']>[number];

function namesInWords(names: readonly string[]): string {
  return names.length === 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')}`;
}

function milestonesQuestion(per: string): string {
  return `What has to happen to one ${per}, start to finish, and which of those are yours?`;
}

export function noMilestonesGap({ id }: Goal, per: string): GoalGap {
  const ask = milestonesQuestion(per);
  return {
    kind: 'no_milestones',
    goal: id,
    detail: `${askingThePerson(ask)} The goal ${id} is judged per ${per} and names no milestones; send them in the goals argument of update_playbook.`,
    fixed_by: 'person',
    ask,
  };
}

export function measureUnreportedGap({ id, success }: Goal): GoalGap {
  return {
    kind: 'measure_unreported',
    goal: id,
    detail: `No active workflow reports ${success.label} for the goal ${id}: give one a contribution to ${id} that measures it.`,
    fixed_by: 'agent',
  };
}

export function measurePausedGap({ id, success }: Goal, paused: readonly string[]): GoalGap {
  return {
    kind: 'measure_paused',
    goal: id,
    detail: `Only paused workflows report ${success.label} for the goal ${id} (${namesInWords(paused)}): resume one, or give an active workflow a contribution that measures it.`,
    fixed_by: 'agent',
  };
}

export function measureNeverFinalGap({ id, success }: Goal): GoalGap {
  return {
    kind: 'measure_never_final',
    goal: id,
    detail: `No workflow that reports ${success.label} for the goal ${id} says when it is final, so no window of it can be judged at its close: give one of them final.`,
    fixed_by: 'agent',
  };
}

export function milestoneUnmarkedGap({ id }: Goal, milestone: Milestone): GoalGap {
  return {
    kind: 'milestone_unmarked',
    goal: id,
    detail: `No active workflow marks the milestone ${milestone.id} (${milestone.label}) of the goal ${id}: give one a contribution to ${id} that marks it.`,
    fixed_by: 'agent',
  };
}

export function windowNeverStartsGap({ id }: Goal, after: string, label: string): GoalGap {
  return {
    kind: 'window_never_starts',
    goal: id,
    detail: `The window of the goal ${id} starts when ${after} (${label}) is first marked, and no active workflow marks it: give one a contribution to ${id} that marks it.`,
    fixed_by: 'agent',
  };
}

export function workflowWithoutContributionGap(workflow: string): GoalGap {
  return {
    kind: 'workflow_without_contribution',
    workflow,
    detail: `The workflow ${workflow} contributes to no goal: save it again with a contribution to the goal it serves.`,
    fixed_by: 'agent',
  };
}

export function goalOrphanedGap(goal: string, workflow: string, retired: boolean): GoalGap {
  const why = retired ? 'which is retired' : 'which the playbook no longer has';
  return {
    kind: 'contribution_orphaned',
    goal,
    workflow,
    detail: `The workflow ${workflow} contributes to the goal ${goal}, ${why}: save it again with a contribution to a goal that is kept.`,
    fixed_by: 'agent',
  };
}

export function milestoneOrphanedGap(goal: string, workflow: string, milestone: string): GoalGap {
  return {
    kind: 'contribution_orphaned',
    goal,
    workflow,
    detail: `The workflow ${workflow} marks ${milestone}, a milestone the goal ${goal} no longer has: save it again marking one it has.`,
    fixed_by: 'agent',
  };
}

export function noticeFunctionMissingGap({ id }: Goal, through: string): GoalGap {
  return {
    kind: 'notice_function_missing',
    goal: id,
    detail: `The goal ${id} is told through ${through}, and no notification function of that name is saved: create an interaction function ${through} that takes no answer, or name one that exists.`,
    fixed_by: 'agent',
  };
}

export function connectionMissingGap(goal: string, server: string, workflows: readonly string[]): GoalGap {
  const ask = `Connect ${server} in Studio`;
  const using = workflows.length === 1 ? 'uses' : 'use';
  return {
    kind: 'connection_missing',
    goal,
    detail: `Ask the person to connect ${server} in Studio. The workflow${workflows.length === 1 ? '' : 's'} ${namesInWords(workflows)} of the goal ${goal} ${using} ${server}, which is not connected, or not offered to this playbook. Only the person can connect it; nothing you save fixes it.`,
    fixed_by: 'person',
    ask,
  };
}
