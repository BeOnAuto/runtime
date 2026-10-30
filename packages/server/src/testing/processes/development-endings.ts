import {
  developmentFiles,
  runnerLines,
  startDevelopment,
  untilListening,
  type Development,
} from './development-process.ts';

export interface Stopped {
  readonly exitCode: unknown;
  readonly said: readonly string[];
}

export async function runningDevelopment(): Promise<Development> {
  const development = startDevelopment(developmentFiles());
  await untilListening(development);
  return development;
}

export async function stoppedWith(development: Development, signal: NodeJS.Signals): Promise<Stopped> {
  development.signal(signal);
  return { exitCode: await development.exited, said: runnerLines(development) };
}

export async function endingOf(development: Development): Promise<Stopped> {
  const exitCode = await development.exited;
  await development.outputClosed;
  return { exitCode, said: runnerLines(development) };
}
