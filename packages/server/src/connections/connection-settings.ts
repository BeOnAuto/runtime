import { problem, type Environment, type FileUse, type SettingProblem } from '@on.auto/config';
import {
  connectionsSetting,
  ConnectionsSettingInvalid,
  namingNoOwnVariable,
  readConnectionsSetting,
  type ConnectionPolicy,
  type ConnectionsSetting,
} from '@on.auto/connections';
import { joinedProviders, operatorValuesIn, operatorVariablesIn, type ProviderList } from '@on.auto/providers';
import type { RegisteredClient } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';

import { problemsListed } from '../config-file/placed-problems.ts';
import { extensionSettingsIn, settingsPrefixOf, type ExtensionEntry } from '../extensions/extension-settings.ts';
import { releaseExtensions } from '../extensions/release-extensions.ts';
import type { FunctionSettings } from '../function-settings/function-settings.ts';
import { variablesTheRuntimeReads } from './variables-the-runtime-reads.ts';

export interface ConnectionSettings {
  readonly connections: ConnectionPolicy;
  readonly registeredClients: readonly RegisteredClient[];
  readonly autoClientsWritten: boolean | undefined;
  readonly connectionVariables: ReadonlyMap<string, Redacted.Redacted>;
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
  readonly extensionSettings: ReadonlyMap<string, Redacted.Redacted>;
}

export interface ConnectionsRead {
  readonly setting: ConnectionsSetting;
  readonly providers: ProviderList;
}

function isGiven(text: string | undefined): text is string {
  return text !== undefined && text !== '';
}

type ReadFunctions = Pick<FunctionSettings, 'models' | 'toolServers' | 'extensions'>;

function ownVariablesOf(
  { models, toolServers }: ReadFunctions,
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

function namingNoExtensionSetting(
  extensions: readonly ExtensionEntry[],
): (setting: ConnectionsSetting) => Effect.Effect<ConnectionsSetting, Problems> {
  return (setting) => {
    const problems = setting.policy.variables.flatMap((name, index) => {
      const extension = extensions.find((entry) => name.startsWith(settingsPrefixOf(entry.package)));
      return extension === undefined
        ? []
        : [
            problem(
              connectionsSetting,
              `/variables/${String(index)}`,
              `${name} is a setting of the extension ${extension.package}, which no connection may name`,
            ),
          ];
    });
    return problems.length === 0 ? Effect.succeed(setting) : Effect.fail({ problems });
  };
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
  functions: ReadFunctions,
  { setting, providers }: ConnectionsRead,
): ConnectionSettings {
  const extensions = [...functions.extensions, ...releaseExtensions];
  const extensionSettings = extensionSettingsIn(environment, extensions, variablesTheRuntimeReads);
  const checked = namingNoOwnVariable(setting, ownVariablesOf(functions, file, providers)).pipe(
    Effect.flatMap(namingNoExtensionSetting(extensions)),
  );
  const { policy: connections, registeredClients } = Effect.runSync(
    checked.pipe(Effect.mapError((invalid: Problems) => placed(invalid, file))),
  );
  return {
    connections,
    registeredClients,
    autoClientsWritten: setting.autoClients,
    connectionVariables: valuesOf(environment, connections),
    providers,
    providerValues: operatorValuesIn(providers, environment),
    extensionSettings,
  };
}
