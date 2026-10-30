import { Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { runnerLog, type RunnerLog } from './runner-log.ts';

interface Entry {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
}

function described({ level, message, annotations }: Entry): string {
  return `${level} ${String(message)} ${JSON.stringify(annotations)}`;
}

function capturing(): { readonly log: RunnerLog; readonly lines: readonly string[] } {
  const lines: string[] = [];
  const capture = Logger.map(Logger.map(Logger.formatStructured, described), (line: string) => {
    lines.push(line);
  });
  return { log: runnerLog(Logger.layer([capture])), lines };
}

describe('the dev runner log', () => {
  it('marks its own lines as coming from dev, at their level', () => {
    const { log, lines } = capturing();

    log.info('The server restarts');
    log.warn('The server stopped');

    expect(lines).toEqual(['INFO The server restarts {"source":"dev"}', 'WARN The server stopped {"source":"dev"}']);
  });
});
