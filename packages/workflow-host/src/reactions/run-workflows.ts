import type { LedgerStreams } from '@on.auto/ledger';
import { Effect } from 'effect';

export type DefinitionOfRun = (playbookKey: string, runId: string) => Effect.Effect<string | undefined>;

const mostRunsRemembered = 4096;

export function definitionsOfRuns(
  store: Pick<LedgerStreams, 'holderOfStream'>,
  mostRemembered = mostRunsRemembered,
): DefinitionOfRun {
  const remembered = new Map<string, string | undefined>();
  return (playbookKey, runId) => {
    const run = JSON.stringify([playbookKey, runId]);
    if (remembered.has(run)) {
      return Effect.succeed(remembered.get(run));
    }
    return Effect.promise(() => store.holderOfStream({ playbookKey, stream: `runs/${runId}` })).pipe(
      Effect.map((definitionKey) => {
        if (remembered.size >= mostRemembered) {
          remembered.clear();
        }
        remembered.set(run, definitionKey);
        return definitionKey;
      }),
    );
  };
}
