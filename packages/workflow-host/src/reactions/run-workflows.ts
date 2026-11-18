import { runStartedOf } from '@on.auto/definitions';
import type { LedgerStreams } from '@on.auto/ledger';
import { Effect } from 'effect';

export type WorkflowOfRun = (playbookKey: string, runId: string) => Effect.Effect<string | undefined>;

const mostRunsRemembered = 4096;

const firstVersion = 1;

async function firstOf(store: Pick<LedgerStreams, 'messageAt' | 'holderOfStream'>, playbookKey: string, runId: string) {
  const definitionKey = await store.holderOfStream({ playbookKey, stream: `runs/${runId}` });
  return definitionKey === undefined ? undefined : store.messageAt(`${definitionKey}runs/${runId}`, firstVersion);
}

export function workflowsOfRuns(
  store: Pick<LedgerStreams, 'messageAt' | 'holderOfStream'>,
  type: string,
  mostRemembered = mostRunsRemembered,
): WorkflowOfRun {
  const remembered = new Map<string, string | undefined>();
  const workflowOf = (first: unknown): string | undefined => {
    const started = runStartedOf(first);
    return started?.definitionType === type ? started.definitionName : undefined;
  };
  return (playbookKey, runId) => {
    const run = JSON.stringify([playbookKey, runId]);
    if (remembered.has(run)) {
      return Effect.succeed(remembered.get(run));
    }
    return Effect.promise(() => firstOf(store, playbookKey, runId)).pipe(
      Effect.map((first) => {
        const workflow = workflowOf(first);
        if (remembered.size >= mostRemembered) {
          remembered.clear();
        }
        remembered.set(run, workflow);
        return workflow;
      }),
    );
  };
}
