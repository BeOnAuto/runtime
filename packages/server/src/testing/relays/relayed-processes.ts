import { expect } from 'vitest';

import { aPortNothingListensOn } from '../processes/free-port.ts';
import {
  homeOfTheTest,
  runtimeOnThePortEndedWithTheTest,
  type RuntimeCommandRun,
  type RuntimeOnThePort,
} from '../processes/runtime-command.ts';
import { until } from '../waiting/until.ts';

export const initializeLine = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent', version: '1.0.0' } },
};

export const initializedLine = { jsonrpc: '2.0', method: 'notifications/initialized' };

function answersIn(stdout: string): readonly unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

export function answerWithId(answers: readonly unknown[], id: number): unknown {
  return answers.find((answer) => typeof answer === 'object' && answer !== null && 'id' in answer && answer.id === id);
}

export function lineOf(message: object): string {
  return `${JSON.stringify(message)}\n`;
}

export async function answered(relay: Readonly<RuntimeCommandRun>, count: number): Promise<readonly unknown[]> {
  await until(() => {
    expect(answersIn(relay.stdout())).toHaveLength(count);
  });
  return answersIn(relay.stdout());
}

export function readiesIn(text: string): number {
  return text.split('Press Ctrl+C to stop.').length - 1;
}

export interface RelayPlace {
  readonly home: string;
  readonly port: number;
  readonly runtimes: RuntimeOnThePort;
}

export async function placeOfTheTest(prefix: string): Promise<RelayPlace> {
  const home = homeOfTheTest(prefix);
  const port = await aPortNothingListensOn();
  return { home, port, runtimes: runtimeOnThePortEndedWithTheTest(home, port) };
}
