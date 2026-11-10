import { runStartedOf } from '@on.auto/definitions';
import type { LedgerStreams } from '@on.auto/ledger';
import { Effect } from 'effect';

export type WorkflowOfRun = (playbookKey: string, runId: string) => Effect.Effect<string | undefined>;

const mostRunsRemembered = 4096;

const firstVersion = 1;

export function workflowsOfRuns(
  store: Pick<LedgerStreams, 'messageAt'>,
  type: string,
  mostRemembered = mostRunsRemembered,
): WorkflowOfRun {
  const remembered = new Map<string, string | undefined>();
  const workflowOf = (first: unknown): string | undefined => {
    const started = runStartedOf(first);
    return started?.definitionType === type ? started.definitionName : undefined;
  };
  return (playbookKey, runId) => {
    const stream = `${playbookKey}runs/${runId}`;
    if (remembered.has(stream)) {
      return Effect.succeed(remembered.get(stream));
    }
    return Effect.promise(() => store.messageAt(stream, firstVersion)).pipe(
      Effect.map((first) => {
        const workflow = workflowOf(first);
        if (remembered.size >= mostRemembered) {
          remembered.clear();
        }
        remembered.set(stream, workflow);
        return workflow;
      }),
    );
  };
}
