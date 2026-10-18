import type { Environment, FileUse, SettingProblem } from '@on.auto/config';
import { ConnectionPolicyInvalid, readConnectionPolicy, type ConnectionPolicy } from '@on.auto/connections';
import { Effect, Redacted } from 'effect';

import { problemsListed } from '../config-file/placed-problems.ts';
import type { FunctionSettings } from '../function-settings/function-settings.ts';
import { variablesTheRuntimeReads } from './variables-the-runtime-reads.ts';

export interface ConnectionSettings {
  readonly connections: ConnectionPolicy;
  readonly connectionVariables: ReadonlyMap<string, Redacted.Redacted>;
}

function isGiven(text: string | undefined): text is string {
  return text !== undefined && text !== '';
}

function ownVariablesOf(
  { models, toolServers }: Pick<FunctionSettings, 'models' | 'toolServers'>,
  file: FileUse | undefined,
): ReadonlySet<string> {
  return new Set([
    ...variablesTheRuntimeReads,
    ...models.gateways.flatMap(({ api_key_env: name }) => (name === null ? [] : [name])),
    ...toolServers.referencedVariables,
    ...(file?.referenced ?? []),
  ]);
}

interface Problems {
  readonly problems: readonly SettingProblem[];
}

function placed({ problems }: Problems, file: FileUse | undefined): ConnectionPolicyInvalid {
  return new ConnectionPolicyInvalid({
    message: `The connection settings are invalid. ${problemsListed(problems, file)}`,
    problems,
  });
}

function valuesOf(environment: Environment, { variables }: ConnectionPolicy): ReadonlyMap<string, Redacted.Redacted> {
  return new Map(
    variables.flatMap((name) => {
      const value = environment[name];
      return isGiven(value) ? [[name, Redacted.make(value)] as const] : [];
    }),
  );
}

export function readConnectionSettings(
  environment: Environment,
  file: FileUse | undefined,
  functions: Pick<FunctionSettings, 'models' | 'toolServers'>,
): ConnectionSettings {
  const policy = readConnectionPolicy(environment, ownVariablesOf(functions, file));
  const connections = Effect.runSync(policy.pipe(Effect.mapError((invalid: Problems) => placed(invalid, file))));
  return { connections, connectionVariables: valuesOf(environment, connections) };
}
