import { runStartedOf } from '@on.auto/definitions';
import { Effect } from 'effect';

export type WorkflowOfRun = (playbookKey: string, runId: string) => Effect.Effect<string | undefined>;

export type ReadStream = (stream: string) => Promise<{ readonly messages: readonly unknown[] }>;

const mostRunsRemembered = 4096;

export function workflowsOfRuns(read: ReadStream, type: string, mostRemembered = mostRunsRemembered): WorkflowOfRun {
  const remembered = new Map<string, string | undefined>();
  const workflowOf = (messages: readonly unknown[]): string | undefined => {
    const started = runStartedOf(messages[0]);
    return started?.definitionType === type ? started.definitionName : undefined;
  };
  return (playbookKey, runId) => {
    const stream = `${playbookKey}runs/${runId}`;
    if (remembered.has(stream)) {
      return Effect.succeed(remembered.get(stream));
    }
    return Effect.promise(() => read(stream)).pipe(
      Effect.map(({ messages }) => {
        const workflow = workflowOf(messages);
        if (remembered.size >= mostRemembered) {
          remembered.clear();
        }
        remembered.set(stream, workflow);
        return workflow;
      }),
    );
  };
}
