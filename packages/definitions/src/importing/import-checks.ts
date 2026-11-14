import { PlaybookContext, type Issue } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { needsOf, type NeededConnection } from '../portable/portable-export.ts';
import {
  PORTABLE_FORMAT,
  packageCapIssues,
  packageDigest,
  portablePackageOf,
  type PortableDefinition,
  type PortablePackage,
} from '../portable/portable-package.ts';
import { definitionIssues, goalsOfThePackage, issuesOfEffect, under } from './import-definitions.ts';

export interface ImportServers {
  readonly present: (org: string, servers: readonly string[]) => Effect.Effect<ReadonlySet<string>>;
}

export interface ImportChecking {
  readonly capabilities: readonly Capability[];
  readonly pages: Pick<SubjectPages, 'check'>;
  readonly servers: ImportServers;
  readonly offers: (model: string) => boolean;
}

export interface ImportPlan {
  readonly digest: string;
  readonly definitions: readonly PortableDefinition[];
  readonly modelsNotOffered: readonly string[];
}

export interface ImportChecks {
  readonly issues: readonly Issue[];
  readonly plan: ImportPlan;
}

const packagePointer = '/package';

function formatIssues({ format }: PortablePackage): readonly Issue[] {
  return format === PORTABLE_FORMAT
    ? []
    : [{ pointer: `${packagePointer}/format`, detail: `This runtime imports packages of format ${PORTABLE_FORMAT}` }];
}

function duplicateIssues(definitions: readonly PortableDefinition[]): readonly Issue[] {
  return definitions.flatMap(({ type, name }, index) =>
    definitions.findIndex((other) => other.type === type && other.name === name) < index
      ? [
          {
            pointer: `${packagePointer}/definitions/${String(index)}/name`,
            detail: `The package holds the ${type} ${name} twice; a playbook holds one of each name`,
          },
        ]
      : [],
  );
}

function boundIssues(
  capabilities: readonly Capability[],
  definitions: readonly PortableDefinition[],
): readonly Issue[] {
  return capabilities.flatMap(({ type, mostActive }) => {
    const held = definitions.filter((definition) => definition.type === type).length;
    return held > mostActive
      ? [
          {
            pointer: `${packagePointer}/definitions`,
            detail: `The package holds ${String(held)} ${definitionResourceLabel(type)}s, and a playbook here may keep at most ${String(mostActive)}`,
          },
        ]
      : [];
  });
}

function connectionIssue({ server, used_by: usedBy }: NeededConnection): Issue {
  return {
    pointer: `${packagePointer}/definitions`,
    detail: `This org has no connection named ${server}, which ${usedBy.join(', ')} use; connect it under that name, then import again`,
  };
}

export function importChecked(checking: ImportChecking) {
  return Effect.fnUntraced(function* (written: PortablePackage) {
    const portable = portablePackageOf(written);
    const ofDefinition = definitionIssues(checking, packagePointer, goalsOfThePackage(portable.goals));
    const needs = needsOf(portable.definitions);
    const plan: ImportPlan = {
      digest: packageDigest(portable),
      definitions: portable.definitions,
      modelsNotOffered: needs.models.filter((model) => !checking.offers(model)),
    };
    const capIssues = under(packagePointer, packageCapIssues(portable));
    if (capIssues.length > 0) {
      return { issues: capIssues, plan };
    }
    const { org } = yield* PlaybookContext;
    const present = yield* checking.servers.present(
      org,
      needs.connections.map(({ server }) => server),
    );
    const pageIssues =
      portable.page === undefined
        ? []
        : yield* issuesOfEffect(
            packagePointer,
            checking.pages.check(portable.page, 'playbook'),
            `${packagePointer}/page`,
          );
    const definitionChecks = yield* Effect.forEach(portable.definitions, ofDefinition);
    const issues = [
      ...formatIssues(portable),
      ...pageIssues,
      ...duplicateIssues(portable.definitions),
      ...boundIssues(checking.capabilities, portable.definitions),
      ...definitionChecks.flat(),
      ...needs.connections.filter(({ server }) => !present.has(server)).map((needed) => connectionIssue(needed)),
    ];
    const checks: ImportChecks = { issues, plan };
    return checks;
  });
}
