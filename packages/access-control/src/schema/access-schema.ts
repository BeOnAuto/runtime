import type { ActionReference, OperationScope } from '@on.auto/operations';

export interface DeclaredAction {
  readonly scope: OperationScope;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly targetsPlaybook: boolean;
}

const principalTypes = '[Person, Key, LocalDeveloper, Playbook]';

export function actionIdOf({ scope, name }: ActionReference): string {
  return `${scope}/${name}`;
}

function resourcesOf({ scope, targetsPlaybook }: DeclaredAction): string {
  return scope === 'playbook' || targetsPlaybook ? '[Org, Playbook, Definition]' : '[Org]';
}

function quoted(text: string): string {
  return JSON.stringify(text);
}

function permissionGroupOf(permission: string): string {
  return `action ${quoted(permission)};`;
}

function actionOf(operation: DeclaredAction): string {
  return [
    `action ${quoted(actionIdOf(operation))} in [${operation.permissions.map((permission) => quoted(permission)).join(', ')}] appliesTo {`,
    `  principal: ${principalTypes},`,
    `  resource: ${resourcesOf(operation)},`,
    '  context: RequestContext,',
    '};',
  ].join('\n');
}

function declarationOf({ permissions, targetsPlaybook }: DeclaredAction): string {
  return JSON.stringify({ permissions: permissions.toSorted(), targetsPlaybook });
}

function declaredOnce(operations: readonly DeclaredAction[]): readonly DeclaredAction[] {
  const byAction = new Map<string, DeclaredAction>();
  for (const operation of operations) {
    const action = actionIdOf(operation);
    const declared = byAction.get(action) ?? operation;
    if (declarationOf(declared) !== declarationOf(operation)) {
      throw new Error(
        `The operation ${action} is handed over twice, declaring ${declarationOf(declared)} and ${declarationOf(operation)}`,
      );
    }
    byAction.set(action, declared);
  }
  return [...byAction.values()];
}

export function accessSchemaOf(
  declared: string,
  permissions: readonly string[],
  operations: readonly DeclaredAction[],
): string {
  return [
    declared.trimEnd(),
    ...permissions.map((permission) => permissionGroupOf(permission)),
    ...declaredOnce(operations).map((operation) => actionOf(operation)),
  ].join('\n');
}
