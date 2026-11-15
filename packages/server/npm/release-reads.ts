import { deepStrictEqual } from 'node:assert/strict';

import {
  accessControlShippedRoots,
  cedarDecisionPoint,
  cedarModuleIn,
  cedarNoticeFiles,
  editorRoleForEveryPerson,
} from '@on.auto/access-control';
import { apiShippedRoots, guideShelfFrom } from '@on.auto/api';
import { checkShippedRoots, handedWorkersWithChecks } from '@on.auto/definitions/check';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { freshInstances, sandboxAnswers, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

function sizesOf(files: Readonly<Record<string, Readonly<Uint8Array>>>): readonly number[] {
  return Object.values(files).map(({ byteLength }) => byteLength);
}

const sandboxModule = await sandboxModuleIn(shippedFilesOnDisk(sandboxShippedRoots()));
deepStrictEqual(await sandboxAnswers(freshInstances(sandboxModule), ['1 + 2']), ['3']);

const handed = await handedWorkersWithChecks(shippedFilesOnDisk(checkShippedRoots()));
const keptLib = Object.values(handed.modules ?? {}).flatMap((files) => sizesOf(files));
deepStrictEqual(
  [sizesOf(handed.sandbox).length, keptLib.length, [...sizesOf(handed.sandbox), ...keptLib].every((size) => size > 0)],
  [1, 2, true],
);

const workflows = { type: 'workflow', noun: { one: 'workflow', other: 'workflows' }, guide: { name: 'workflow' } };
const guideFiles = shippedFilesOnDisk(apiShippedRoots());
const shelf = await guideShelfFrom(guideFiles, [workflows], { pages: true });
const pages = [...shelf.guides, ...shelf.recipes].map(({ name, text }) => [name, text.length > 0]);
deepStrictEqual(pages, [
  ['start', true],
  ['terminology', true],
  ['workflow', true],
  ['templates', true],
  ['triggers', true],
  ['events', true],
  ['page', true],
  ['glance', true],
  ['connect-a-service', true],
  ['schedule', true],
]);

const keptGoals = await guideShelfFrom(guideFiles, [workflows], { pages: true, goals: true });
deepStrictEqual(
  [keptGoals.guides.length, keptGoals.named('goals')?.text.startsWith('# Goals\n')],
  [shelf.guides.length + 1, true],
);

const accessFiles = shippedFilesOnDisk(accessControlShippedRoots());
const decisionPoint = cedarDecisionPoint({
  module: cedarModuleIn(accessFiles),
  files: accessFiles,
  operations: [{ scope: 'org', name: 'list_playbooks', permissions: ['org:read'], targetsPlaybook: false }],
  roles: editorRoleForEveryPerson,
});
const decided = await Effect.runPromise(
  decisionPoint.decide({
    principal: { type: 'person', id: 'release' },
    action: { scope: 'org', name: 'list_playbooks' },
    resource: { type: 'org', id: 'acme' },
    context: {
      via: 'studio',
      granted: { org: 'acme', permissions: ['org:read'], playbooks: '*' },
      operation: {
        kind: 'query',
        targetsPlaybook: false,
        readsOnly: false,
        reachesOutside: false,
        mayChangeOutside: false,
        irreversible: false,
        permissionsManagement: false,
      },
    },
  }),
);
deepStrictEqual([decided.decision, decided.determiningPolicies], ['allow', ['editor']]);
const [license = '', notice = '', crateNotices = ''] = await Promise.all(
  cedarNoticeFiles.map((file) => accessFiles.text(file)),
);
deepStrictEqual(
  [license.includes('Apache License'), notice, crateNotices.startsWith("Third-party notices of Cedar's WebAssembly\n")],
  [true, 'Copyright Cedar Contributors\n', true],
);

process.stdout.write(
  `Read, in a release of the package, the module of the sandbox, which answered 1 + 2 with 3, the kept lib of the check, ${keptLib.join(' and ')} bytes, the guide shelf of a server of workflows and pages, ${shelf.everyGuide.map(({ name }) => name).join(', ')}, the goals guide where goals are kept, the policies and the engine of the policy decision point, which decided a call, and Cedar's LICENSE, NOTICE and the notices of the crates compiled into its WebAssembly\n`,
);
