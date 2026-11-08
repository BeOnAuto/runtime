import {
  answerCheck,
  languageModelLayer,
  type AnswerCheckReport,
  type Environment,
  type ModelAccessOptions,
} from '@on.auto/reasoning';
import { Effect } from 'effect';

const usage = 'Usage: pnpm answer-check <provider/model> [<provider/model> ...]';

export function everyModelPassed({ models }: AnswerCheckReport): boolean {
  return models.every(({ outcome }) => outcome === 'passed' || outcome === 'passed_after_repair');
}

export function runAnswerCheck(
  commandArguments: readonly string[],
  environment: Environment,
  options: ModelAccessOptions = {},
): Promise<AnswerCheckReport> {
  if (commandArguments.length === 0 || commandArguments.some((argument) => argument.startsWith('-'))) {
    return Promise.reject(new Error(usage));
  }
  return Effect.runPromise(
    answerCheck(commandArguments).pipe(Effect.provide(languageModelLayer(environment, options))),
  );
}

if (import.meta.main) {
  const report = await runAnswerCheck(process.argv.slice(2), process.env);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = everyModelPassed(report) ? 0 : 1;
}
