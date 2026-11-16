import { Array as Arr, SchemaAST, type Schema } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import { permissionFor, type Permission } from '../caller/permission.ts';
import {
  fieldOf,
  handlerMembersOf,
  holdsEmptyStruct,
  isClosedObject,
  isRequiredStringField,
  encodedMembersOf,
} from './encoded-shape.ts';
import { pathParametersOf } from './route.ts';

interface CheckableDefinition {
  readonly name: string;
  readonly route: { readonly path: string };
  readonly inputSchema: Schema.Constraint;
  readonly outputSchema?: Schema.Constraint;
  readonly permittedBy?: readonly Permission[];
  readonly permissionsManagement?: boolean;
  readonly enrolment?: boolean;
  readonly sameInEveryScope?: boolean;
}

interface CheckedDefinition {
  readonly pathParameters: readonly string[];
  readonly targetsPlaybook: boolean;
  readonly permissions: readonly Permission[];
}

const operationName = /^[a-z][a-z0-9_]{0,63}$/u;

const reservedFieldsByScope: Readonly<Record<OperationScope, readonly string[]>> = {
  org: ['org'],
  playbook: ['org', 'playbook'],
};

function closedObjectMembers(
  name: string,
  role: 'input' | 'output',
  schema: Schema.Constraint,
): readonly SchemaAST.Objects[] {
  const encodedMembers = encodedMembersOf(schema);
  const members = encodedMembers.filter((member) => isClosedObject(member));
  if (members.length !== encodedMembers.length) {
    throw new Error(`The ${role} of ${name} must be an object that declares its fields`);
  }
  if (members.some((member) => holdsEmptyStruct(member, []))) {
    throw new Error(`The ${role} of ${name} holds an empty struct, which accepts any value`);
  }
  return members;
}

function requireNoReservedField(name: string, scope: OperationScope, members: readonly SchemaAST.Objects[]): void {
  const reserved = reservedFieldsByScope[scope].find((field) =>
    members.some((member) => fieldOf(member, field) !== undefined),
  );
  if (reserved !== undefined) {
    throw new Error(`The input of ${name} may not have a field named ${reserved}`);
  }
}

function requireRouteParametersAsFields(
  name: string,
  pathParameters: readonly string[],
  members: readonly SchemaAST.Objects[],
): void {
  const missing = pathParameters.find(
    (parameter) => !members.every((member) => isRequiredStringField(fieldOf(member, parameter))),
  );
  if (missing !== undefined) {
    throw new Error(`The route parameter ${missing} of ${name} must be a required string field of every input`);
  }
}

function requirePlaybookFromPlaybookField(
  name: string,
  inputSchema: Schema.Constraint,
  members: readonly SchemaAST.Objects[],
): void {
  const renamed = Arr.zip(handlerMembersOf(inputSchema), members).some(
    ([handlerMember, encodedMember]: readonly [SchemaAST.AST, SchemaAST.Objects]) =>
      SchemaAST.isObjects(handlerMember) &&
      fieldOf(handlerMember, 'playbook') !== undefined &&
      fieldOf(encodedMember, 'playbook') === undefined,
  );
  if (renamed) {
    throw new Error(`The input of ${name} must take its playbook field from a field named playbook`);
  }
}

function requireACommandToManagePermissions(name: string, kind: OperationKind, permissionsManagement: boolean): void {
  if (kind === 'query' && permissionsManagement) {
    throw new Error(
      `The query ${name} declares permissions management, which only a command that grants or changes access does`,
    );
  }
}

function requireACommandOfTheOrgToEnrol(
  name: string,
  scope: OperationScope,
  kind: OperationKind,
  enrolment: boolean,
): void {
  if (enrolment && (scope !== 'org' || kind !== 'command')) {
    throw new Error(
      `The operation ${name} declares enrolment, which only a command of the org that makes its caller a member does`,
    );
  }
}

function requireNothingOfTheScopeAskedIn(
  name: string,
  targetsPlaybook: boolean,
  permittedBy: readonly Permission[] | undefined,
): void {
  if (targetsPlaybook) {
    throw new Error(`The operation ${name} declares it is the same in every scope, so it may not take a playbook`);
  }
  if (permittedBy !== undefined) {
    throw new Error(
      `The operation ${name} declares it is the same in every scope, so the permission to read the scope it is asked in permits it, and it may declare no other`,
    );
  }
}

function permissionsOf(name: string, permittedBy: readonly Permission[]): readonly Permission[] {
  if (permittedBy.length === 0) {
    throw new Error(`The operation ${name} is permitted by no permission`);
  }
  return permittedBy;
}

export function checkedDefinition(
  scope: OperationScope,
  kind: OperationKind,
  {
    name,
    route,
    inputSchema,
    outputSchema,
    permittedBy,
    permissionsManagement = false,
    enrolment = false,
    sameInEveryScope = false,
  }: CheckableDefinition,
): CheckedDefinition {
  if (!operationName.test(name)) {
    throw new Error(`The operation name ${name} is malformed`);
  }
  requireACommandToManagePermissions(name, kind, permissionsManagement);
  requireACommandOfTheOrgToEnrol(name, scope, kind, enrolment);
  const pathParameters = pathParametersOf(route.path);
  const inputMembers = closedObjectMembers(name, 'input', inputSchema);
  if (outputSchema !== undefined) {
    requireClosedOutput(name, outputSchema);
  }
  requireNoReservedField(name, scope, inputMembers);
  requireRouteParametersAsFields(name, pathParameters, inputMembers);
  requirePlaybookFromPlaybookField(name, inputSchema, inputMembers);
  const targetsPlaybook = inputMembers.some((member) => fieldOf(member, 'playbook') !== undefined);
  if (sameInEveryScope) {
    requireNothingOfTheScopeAskedIn(name, targetsPlaybook, permittedBy);
  }
  return {
    pathParameters,
    targetsPlaybook,
    permissions: permissionsOf(name, permittedBy ?? [permissionFor(kind, scope)]),
  };
}

export function requireClosedOutput(name: string, outputSchema: Schema.Constraint): void {
  closedObjectMembers(name, 'output', outputSchema);
}
