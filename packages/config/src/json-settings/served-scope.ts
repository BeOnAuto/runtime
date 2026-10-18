import { PlaybookIdSchema, OrgIdSchema } from '@on.auto/operations';
import { JsonPointer, Result, Schema } from 'effect';

import { problem, type SettingProblem } from './json-setting.ts';

const isOrgId = Schema.is(OrgIdSchema);

const isPlaybookId = Schema.is(PlaybookIdSchema);

export const everyOrg = '*';

export interface ServedScope {
  readonly orgs: readonly string[] | null;
  readonly playbooks: readonly string[] | null;
}

export interface ServedAddress {
  readonly org: string;
  readonly playbook: string;
}

export interface WrittenScope {
  readonly org?: string | readonly string[] | undefined;
  readonly playbooks?: readonly string[] | undefined;
}

interface Placing {
  readonly setting: string;
  readonly entry: string;
}

function entryPointer({ entry }: Placing, ...path: readonly string[]): string {
  return [entry, ...path].map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

export function servesOrg({ orgs }: ServedScope, org: string): boolean {
  return orgs === null || orgs.includes(org);
}

export function servesPlaybook(scope: ServedScope, address: ServedAddress): boolean {
  return servesOrg(scope, address.org) && (scope.playbooks === null || scope.playbooks.includes(address.playbook));
}

function listedOrgProblems(placing: Placing, orgs: readonly string[]): readonly SettingProblem[] {
  if (orgs.length === 0) {
    return [problem(placing.setting, entryPointer(placing, 'org'), 'Expected at least one org id')];
  }
  return orgs.flatMap((org, index) => {
    if (isOrgId(org)) {
      return [];
    }
    const detail = org === everyOrg ? 'Expected an org id; * stands alone, for every org' : 'Expected an org id';
    return [problem(placing.setting, entryPointer(placing, 'org', String(index)), detail)];
  });
}

function orgProblems(placing: Placing, { org, playbooks }: WrittenScope, served: string): readonly SettingProblem[] {
  if (org === undefined) {
    return [problem(placing.setting, entryPointer(placing), `Expected the org this ${served} serves`)];
  }
  if (org === everyOrg) {
    return playbooks === undefined
      ? []
      : [
          problem(
            placing.setting,
            entryPointer(placing, 'playbooks'),
            'Expected no playbooks beside every org, since a playbook id belongs to one org',
          ),
        ];
  }
  if (typeof org !== 'string') {
    return listedOrgProblems(placing, org);
  }
  return isOrgId(org)
    ? []
    : [problem(placing.setting, entryPointer(placing, 'org'), 'Expected an org id, a list of them, or *')];
}

function playbookProblems(placing: Placing, playbooks: readonly string[]): readonly SettingProblem[] {
  return playbooks.flatMap((playbook, index) =>
    isPlaybookId(playbook)
      ? []
      : [problem(placing.setting, entryPointer(placing, 'playbooks', String(index)), 'Expected a playbook id')],
  );
}

function orgsOf(org: string | readonly string[]): readonly string[] | null {
  if (org === everyOrg) {
    return null;
  }
  return typeof org === 'string' ? [org] : org;
}

export function servedScopeOf(
  setting: string,
  entry: string,
  written: WrittenScope,
  served: string,
): Result.Result<Pick<ServedScope, 'orgs'>, readonly SettingProblem[]> {
  const placing = { setting, entry };
  const problems = [...orgProblems(placing, written, served), ...playbookProblems(placing, written.playbooks ?? [])];
  return written.org === undefined || problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({ orgs: orgsOf(written.org) });
}
