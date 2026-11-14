import type { DeclaredAction } from '@on.auto/access-control';
import type { DocumentedOperation } from '@on.auto/api/testing';
import { echo } from '@on.auto/definitions/testing';
import { Predicate } from 'effect';

import { hostOperationsOf, hostRegistrationsOf } from '../../workflows/host-operations.ts';

const playbookParameter = '#/components/parameters/playbook';

const inOrgSuffix = '_in_org';

export function permissionsOf({ operation }: DocumentedOperation): readonly string[] {
  return operation.security.flatMap((requirement) => requirement['openIdConnect'] ?? []);
}

function isInAPlaybook({ operation }: DocumentedOperation): boolean {
  return operation.parameters.some((parameter) => parameter['$ref'] === playbookParameter);
}

function fieldsOfEveryMember(schema: unknown): readonly string[] {
  if (!Predicate.isObject(schema)) {
    return [];
  }
  const properties: unknown = Reflect.get(schema, 'properties');
  const members: unknown = Reflect.get(schema, 'anyOf');
  return [
    ...(Predicate.isObject(properties) ? Object.keys(properties) : []),
    ...(Array.isArray(members) ? members.flatMap((member: unknown) => fieldsOfEveryMember(member)) : []),
  ];
}

function bodyOf({ operation }: DocumentedOperation): unknown {
  const content: unknown = operation.requestBody?.['content'];
  const json: unknown = Predicate.isObject(content) ? Reflect.get(content, 'application/json') : undefined;
  return Predicate.isObject(json) ? Reflect.get(json, 'schema') : undefined;
}

function namesAPlaybook(described: DocumentedOperation): boolean {
  const named = [
    ...described.operation.parameters.map((parameter) => parameter['name']),
    ...fieldsOfEveryMember(bodyOf(described)),
  ];
  return named.includes('playbook');
}

function declaredBy(described: DocumentedOperation, inPlaybooks: ReadonlySet<string>): DeclaredAction {
  const { operationId } = described.operation;
  if (isInAPlaybook(described)) {
    return { scope: 'playbook', name: operationId, permissions: permissionsOf(described), targetsPlaybook: false };
  }
  const name = operationId.endsWith(inOrgSuffix) ? operationId.slice(0, -inOrgSuffix.length) : operationId;
  return {
    scope: 'org',
    name: inPlaybooks.has(name) ? name : operationId,
    permissions: permissionsOf(described),
    targetsPlaybook: namesAPlaybook(described),
  };
}

export function actionOf({ scope, name }: Pick<DeclaredAction, 'scope' | 'name'>): string {
  return `${scope}/${name}`;
}

export function declarationLineOf(operation: DeclaredAction): string {
  const named = operation.targetsPlaybook ? ' (names a playbook)' : '';
  return `${actionOf(operation)}: ${operation.permissions.join(',')}${named}`;
}

export function declaredIn(documented: readonly DocumentedOperation[]): readonly DeclaredAction[] {
  const asked = documented.filter((described) => permissionsOf(described).length > 0);
  const inPlaybooks = new Set(
    asked.filter((described) => isInAPlaybook(described)).map(({ operation }) => operation.operationId),
  );
  const served = asked.map((described) => declaredBy(described, inPlaybooks));
  const servedActions = new Set(served.map((operation) => actionOf(operation)));
  const hostsOwn = hostRegistrationsOf(hostOperationsOf([echo])).filter(
    (registration) => !servedActions.has(actionOf(registration)),
  );
  return [...served, ...hostsOwn].toSorted((one, other) => actionOf(one).localeCompare(actionOf(other)));
}
