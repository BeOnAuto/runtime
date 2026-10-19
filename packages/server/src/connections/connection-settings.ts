import type { Environment, FileUse, SettingProblem } from '@on.auto/config';
import {
  ConnectionsSettingInvalid,
  namingNoOwnVariable,
  readConnectionsSetting,
  type ConnectionPolicy,
  type ConnectionsSetting,
  type RegisteredClient,
} from '@on.auto/connections';
import { joinedProviders, operatorValuesIn, operatorVariablesIn, type ProviderList } from '@on.auto/providers';
import { Effect, Redacted } from 'effect';

import { problemsListed } from '../config-file/placed-problems.ts';
import type { FunctionSettings } from '../function-settings/function-settings.ts';
import { variablesTheRuntimeReads } from './variables-the-runtime-reads.ts';

export interface ConnectionSettings {
  readonly connections: ConnectionPolicy;
  readonly registeredClients: readonly RegisteredClient[];
  readonly connectionVariables: ReadonlyMap<string, Redacted.Redacted>;
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
}

export interface ConnectionsRead {
  readonly setting: ConnectionsSetting;
  readonly providers: ProviderList;
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

export function readConnections(
  environment: Environment,
  file: FileUse | undefined,
  shipped: ProviderList,
): ConnectionsRead {
  const reading = readConnectionsSetting(environment).pipe(
    Effect.mapError((invalid: Problems) => placed(invalid, file)),
  );
  const setting = Effect.runSync(reading);
  return { setting, providers: joinedProviders(shipped, setting.providers) };
}

export function readConnectionSettings(
  environment: Environment,
  file: FileUse | undefined,
  functions: Pick<FunctionSettings, 'models' | 'toolServers'>,
  { setting, providers }: ConnectionsRead,
): ConnectionSettings {
  const checked = namingNoOwnVariable(setting, ownVariablesOf(functions, file, providers));
  const { policy: connections, registeredClients } = Effect.runSync(
    checked.pipe(Effect.mapError((invalid: Problems) => placed(invalid, file))),
  );
  return {
    connections,
    registeredClients,
    connectionVariables: valuesOf(environment, connections),
    providers,
    providerValues: operatorValuesIn(providers, environment),
  };
}
