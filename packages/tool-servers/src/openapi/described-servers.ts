import { settingProblemText, type SettingProblem } from '@on.auto/config';
import { Data, Effect } from 'effect';

import type { ServerSettings, ToolServerSettings } from '../settings/server-settings.ts';
import type { Describing, LinkedServerSettings, ToolServers } from './described-api.ts';

export class ToolServerDocumentRefused extends Data.TaggedError('tool_server_document_refused')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

type Problems = readonly SettingProblem[];

function problemsOf({ problems }: { readonly problems: Problems }): Problems {
  return problems;
}

function linkedOf(server: ServerSettings, describing: Describing): Effect.Effect<LinkedServerSettings, Problems> {
  return server.type === 'openapi'
    ? Effect.mapError(
        Effect.flatMap(
          Effect.promise(async () => (await import('./api-description.ts')).describedApi(server, describing)),
          Effect.fromResult,
        ),
        problemsOf,
      )
    : Effect.succeed(server);
}

function refusedOrLinked([servers, refusals]: readonly [
  readonly LinkedServerSettings[],
  readonly Problems[],
]): Effect.Effect<ToolServers, ToolServerDocumentRefused> {
  const problems = refusals.flat();
  const listed = problems.map((problem) => settingProblemText(problem)).join('; ');
  return problems.length > 0
    ? Effect.fail(
        new ToolServerDocumentRefused({
          message: `The documents of the tool servers could not be read. ${listed}`,
          problems,
        }),
      )
    : Effect.succeed({ servers });
}

export function describedToolServers(
  settings: ToolServerSettings,
  describing: Describing,
): Effect.Effect<ToolServers, ToolServerDocumentRefused> {
  return Effect.flatMap(
    Effect.partition(settings.servers, (server) => linkedOf(server, describing), { concurrency: 'unbounded' }),
    refusedOrLinked,
  );
}
