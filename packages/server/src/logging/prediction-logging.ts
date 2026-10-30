import { Effect } from 'effect';

export interface PredictionFunctionsReport {
  readonly mostFunctions: number;
  readonly processes: number;
  readonly memoryMebibytes: number;
  readonly buildsAtOnce: number;
  readonly buildsPerDay: number;
  readonly cacheDirectory: string;
  readonly limiter: string | undefined;
}

const counted = new Intl.NumberFormat('en');

function boundOf({ limiter }: PredictionFunctionsReport): string {
  return limiter === undefined ? 'which nothing bounds, since prlimit is not on the path' : 'which prlimit bounds';
}

export function logPredictionFunctions(report: PredictionFunctionsReport): Effect.Effect<void> {
  const { mostFunctions, processes, memoryMebibytes, buildsAtOnce, buildsPerDay, cacheDirectory, limiter } = report;
  return Effect.logInfo(
    `Prediction functions run in this server: a playbook keeps at most ${counted.format(mostFunctions)} active, each builds at most ${buildsPerDay} times a day, and model processes may run at most ${processes} at once, at most ${buildsAtOnce} of them for the builds being scored, with ${counted.format(memoryMebibytes)} MiB of data each, ${boundOf(report)}, reading the files of their models from ${cacheDirectory}`,
  ).pipe(
    Effect.annotateLogs({
      most_functions: mostFunctions,
      model_processes: processes,
      model_process_memory_mib: memoryMebibytes,
      model_process_builds: buildsAtOnce,
      builds_per_day: buildsPerDay,
      model_cache_directory: cacheDirectory,
      model_process_limiter: limiter ?? null,
    }),
  );
}
