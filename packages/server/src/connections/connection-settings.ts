import type { Environment, FileUse, SettingProblem } from '@on.auto/config';
import { ConnectionsSettingInvalid, readConnectionsSetting, type ConnectionPolicy } from '@on.auto/connections';
import { operatorValuesIn, operatorVariablesIn, type ProviderList } from '@on.auto/providers';
import { Effect, Redacted } from 'effect';

import { problemsListed } from '../config-file/placed-problems.ts';
import type { FunctionSettings } from '../function-settings/function-settings.ts';
import { variablesTheRuntimeReads } from './variables-the-runtime-reads.ts';

export interface ConnectionSettings {
  readonly connections: ConnectionPolicy;
  readonly connectionVariables: ReadonlyMap<string, Redacted.Redacted>;
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
}

function isGiven(text: string | undefined): text is string {
  return text !== undefined && text !== '';
}

function ownVariablesOf(
  { models, toolServers }: Pick<FunctionSettings, 'models' | 'toolServers'>,
  file: FileUse | undefined,
  providers: ProviderList,
): ReadonlySet<string> {
  return new Set([
    ...variablesTheRuntimeReads,
    ...models.gateways.flatMap(({ api_key_env: name }) => (name === null ? [] : [name])),
    ...toolServers.referencedVariables,
    ...(file?.referenced ?? []),
    ...operatorVariablesIn(providers),
  ]);
}

interface Problems {
  readonly problems: readonly SettingProblem[];
}

function placed({ problems }: Problems, file: FileUse | undefined): ConnectionsSettingInvalid {
  return new ConnectionsSettingInvalid({
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
  providers: ProviderList,
): ConnectionSettings {
  const setting = readConnectionsSetting(environment, ownVariablesOf(functions, file, providers));
  const { policy: connections } = Effect.runSync(
    setting.pipe(Effect.mapError((invalid: Problems) => placed(invalid, file))),
  );
  return {
    connections,
    connectionVariables: valuesOf(environment, connections),
    providers,
    providerValues: operatorValuesIn(providers, environment),
  };
}
