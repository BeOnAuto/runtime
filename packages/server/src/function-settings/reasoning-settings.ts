import { dirname } from 'node:path';

import type { Environment, FileUse } from '@on.auto/config';
import {
  defaultMostInputTokens,
  modelVariables,
  ModelSettingsInvalid,
  providerStatus,
  readModelSettings,
  type ModelSettings,
  type SettingProblem,
} from '@on.auto/reasoning';
import {
  ToolServerSettingsInvalid,
  readToolServerSettings,
  toolServersSetting,
  type ToolServerSettings,
} from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { problemsListed } from '../config-file/placed-problems.ts';
import { countsIn } from './counted-settings.ts';

interface ReasoningBounds {
  readonly mostInputTokens: number;
}

export interface ReasoningSettings {
  readonly models: ModelSettings;
  readonly modelProviders: readonly string[];
  readonly toolServers: ToolServerSettings;
  readonly reasoning: ReasoningBounds;
}

const bounds = {
  mostInputTokens: {
    setting: 'REASONING_MAX_INPUT_TOKENS',
    least: 10_000,
    most: 9_999_999,
    example: defaultMostInputTokens,
  },
};

export const reasoningVariables: readonly string[] = [
  ...Object.values(bounds).map(({ setting }: { readonly setting: string }) => setting),
  ...modelVariables,
  toolServersSetting,
];

interface Problems {
  readonly problems: readonly SettingProblem[];
}

function modelsPlaced(invalid: Problems, file: FileUse | undefined): ModelSettingsInvalid {
  const { problems } = invalid;
  return new ModelSettingsInvalid({
    message: `The model settings are invalid. ${problemsListed(problems, file)}`,
    problems,
  });
}

function serversPlaced(invalid: Problems, file: FileUse | undefined): ToolServerSettingsInvalid {
  const { problems } = invalid;
  return new ToolServerSettingsInvalid({
    message: `The tool server settings are invalid. ${problemsListed(problems, file)}`,
    problems,
  });
}

function modelProvidersOf(models: ModelSettings): readonly string[] {
  const { configured, unconfigured } = providerStatus(models, { entraId: false });
  return [...configured, ...unconfigured.map(({ provider }) => provider)];
}

export function readReasoningSettings(environment: Environment, file: FileUse | undefined): ReasoningSettings {
  const models = Effect.runSync(
    readModelSettings(environment).pipe(Effect.mapError((invalid: Problems) => modelsPlaced(invalid, file))),
  );
  const modelProviders = modelProvidersOf(models);
  const toolServers = Effect.runSync(
    readToolServerSettings(environment, {
      modelProviders,
      ...(file === undefined ? {} : { documentsDirectory: dirname(file.path) }),
    }).pipe(Effect.mapError((invalid: Problems) => serversPlaced(invalid, file))),
  );
  const reasoning = Effect.runSync(countsIn(environment, { settings: 'reasoning function settings', bounds }));
  return { models, modelProviders, toolServers, reasoning };
}
