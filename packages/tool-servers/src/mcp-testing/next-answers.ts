import type { FakeMcpServer } from './fake-mcp-answers.ts';

interface Programmed {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface NextAnswers {
  readonly programmed: (rpc: string | undefined) => Programmed | undefined;
  readonly noise: () => number;
  readonly answerWith: FakeMcpServer['answerNextWith'];
  readonly answerOf: FakeMcpServer['answerNextOf'];
  readonly answerAfterNoise: FakeMcpServer['answerNextCallAfterNoise'];
  readonly held: (rpc: string | undefined) => Promise<void> | undefined;
  readonly hold: FakeMcpServer['holdNextOf'];
}

function programmedAnswers(status: number, times: number, headers: Readonly<Record<string, string>>): Programmed[] {
  return Array.from({ length: times }, () => ({ status, headers }));
}

export function nextAnswers(): NextAnswers {
  const programmed: Programmed[] = [];
  const programmedOf = new Map<string, Programmed[]>();
  const holding = new Map<string, Promise<void>[]>();
  let noise = 0;
  return {
    held: (rpc) => holding.get(String(rpc))?.shift(),
    hold: (rpc) => {
      const held = Promise.withResolvers<void>();
      holding.set(rpc, [...(holding.get(rpc) ?? []), held.promise]);
      return held.resolve;
    },
    programmed: (rpc) => programmedOf.get(String(rpc))?.shift() ?? programmed.shift(),
    noise: () => {
      const messages = noise;
      noise = 0;
      return messages;
    },
    answerWith: (status, times = 1, headers = {}) => {
      programmed.push(...programmedAnswers(status, times, headers));
    },
    answerOf: (rpc, status, times = 1, headers = {}) => {
      programmedOf.set(rpc, [...(programmedOf.get(rpc) ?? []), ...programmedAnswers(status, times, headers)]);
    },
    answerAfterNoise: (messages) => {
      noise = messages;
    },
  };
}

interface WatchedChanges {
  readonly changed: () => void;
  readonly once: (holds: () => boolean) => Promise<void>;
}

export function watchedChanges(): WatchedChanges {
  const waiting = new Set<() => void>();
  return {
    changed: () => {
      for (const check of waiting) {
        check();
      }
    },
    once: (holds) => {
      const held = Promise.withResolvers<void>();
      const check = () => {
        if (holds()) {
          waiting.delete(check);
          held.resolve();
        }
      };
      waiting.add(check);
      check();
      return held.promise;
    },
  };
}
