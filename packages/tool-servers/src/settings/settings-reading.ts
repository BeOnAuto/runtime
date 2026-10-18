import {
  credentialProblems,
  decodedJsonSetting,
  placeholdersReplaced,
  pointerOf,
  problem,
  referencedVariablesOf,
  settingProblemText,
  substituted,
  type SettingProblem,
} from '@on.auto/config';
import { Data, Effect, Option, Result, Schema } from 'effect';

import { checkedEntry } from './entry-checks.ts';
import { misplacedReferences, secretsOfEntry, unreferencedSecurity } from './entry-references.ts';
import { ServerEntrySchema, ToolServersSchema, toolServersSetting, type ServerEntryFields } from './server-entries.ts';
import type { ServerSettings, ToolServerSettings } from './server-settings.ts';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface ToolServerSettingsContext {
  readonly modelProviders: readonly string[];
  readonly documentsDirectory?: string;
  readonly placedValues?: ReadonlyMap<string, string>;
}

export class ToolServerSettingsInvalid extends Data.TaggedError('tool_server_settings_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

const credentialAdvice =
  'Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}';

const decodeEntry = Schema.decodeUnknownSync(ServerEntrySchema);

type PlacedValues = ReadonlyMap<string, string>;

function valuesPlaced(values: Readonly<Record<string, string>>, placed: PlacedValues): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]: readonly [string, string]) => [
      key,
      placeholdersReplaced(value, (name) => placed.get(name) ?? `{${name}}`),
    ]),
  );
}

function withValuesPlaced(fields: ServerEntryFields, placed: PlacedValues): ServerEntryFields {
  const { headers, query_params: queryParams } = fields;
  return {
    ...fields,
    ...(headers === undefined ? {} : { headers: valuesPlaced(headers, placed) }),
    ...(queryParams === undefined ? {} : { query_params: valuesPlaced(queryParams, placed) }),
  };
}

export function readEntry(
  name: string,
  written: ServerEntryFields,
  environment: Environment,
  context: ToolServerSettingsContext,
): Result.Result<ServerSettings, readonly SettingProblem[]> {
  const pointer = pointerOf([name]);
  const resolved = substituted(written, pointer, environment);
  const flagged = credentialProblems(name, written, pointer).map(({ pointer: place }) => place);
  const writtenOut = unreferencedSecurity(name, written, resolved.references).filter(
    (place) => !flagged.includes(place),
  );
  const credentials = [...flagged, ...writtenOut].map((place) => problem(toolServersSetting, place, credentialAdvice));
  const unresolved = resolved.problems.map(({ pointer: place, detail }) => problem(toolServersSetting, place, detail));
  const problems = [...credentials, ...unresolved, ...misplacedReferences(name, resolved.references)];
  if (problems.length > 0) {
    return Result.fail(problems);
  }
  const fields = withValuesPlaced(decodeEntry(resolved.value), context.placedValues ?? new Map());
  return checkedEntry(name, fields, {
    modelProviders: context.modelProviders,
    directory: context.documentsDirectory ?? process.cwd(),
    secrets: secretsOfEntry(name, fields, resolved.references),
  });
}

function serversOf(
  text: string | undefined,
  environment: Environment,
  context: ToolServerSettingsContext,
): Result.Result<ToolServerSettings, readonly SettingProblem[]> {
  if (text === undefined) {
    return Result.succeed({ servers: [], referencedVariables: [] });
  }
  return Result.flatMap(decodedJsonSetting(toolServersSetting, text, ToolServersSchema), (entries) => {
    const read = Object.entries(entries).map(([name, written]: readonly [string, ServerEntryFields]) =>
      readEntry(name, written, environment, context),
    );
    const problems: SettingProblem[] = [];
    for (const entry of read) {
      problems.push(...Result.getFailure(entry).pipe(Option.getOrElse((): readonly SettingProblem[] => [])));
    }
    return problems.length > 0
      ? Result.fail(problems)
      : Result.map(Result.all(read), (servers: readonly ServerSettings[]) => ({
          servers,
          referencedVariables: referencedVariablesOf(entries),
        }));
  });
}

function invalid(problems: readonly SettingProblem[]): ToolServerSettingsInvalid {
  const listed = problems.map((refused) => settingProblemText(refused)).join('; ');
  return new ToolServerSettingsInvalid({ message: `The tool server settings are invalid. ${listed}`, problems });
}

export function readToolServerSettings(
  environment: Environment,
  context: ToolServerSettingsContext,
): Effect.Effect<ToolServerSettings, ToolServerSettingsInvalid> {
  return Result.match(serversOf(environment[toolServersSetting], environment, context), {
    onSuccess: (settings) => Effect.succeed(settings),
    onFailure: (problems) => Effect.fail(invalid(problems)),
  });
}
