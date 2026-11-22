import type { CallOptions } from '@on.auto/interaction/testing';
import type { FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { patientTiming } from '@on.auto/tool-servers/testing';
import { Function, Schema } from 'effect';
import { afterAll, expect } from 'vitest';

import type { TestResponse } from '../servers/http-client.ts';
import {
  askingASystem,
  type CallingType,
  type SystemOptions,
  type SystemServer,
  type ToldBounds,
} from './system-calls.ts';

export const quickCalls = { ...patientTiming, callMs: 300 };

export const quickOpening = { ...patientTiming, openMs: 300 };

type Timer = NonNullable<ReturnType<ToldBounds>['timer']>;

/** A timer whose waits of `ms` end once `due` settles, unless stopped first; it lets every other wait run on. */
export function endingWhen(ms: number, due: () => Promise<void>): Timer {
  return {
    after: (asked, expire) => {
      const waiting = { on: asked === ms };
      if (waiting.on) {
        void (async () => {
          await due();
          if (waiting.on) {
            expire();
          }
        })();
      }
      return () => {
        waiting.on = false;
      };
    },
  };
}

/**
 * The opening bound of quickOpening ends once the fake has seen the run ask for its tools: the second listing, the
 * first being the one its definition made when it was saved.
 */
export const openingEndsOnceListed: ToldBounds = (fake) => ({
  timer: endingWhen(quickOpening.openMs, () =>
    fake.once(() => fake.seen().filter(({ rpc }) => rpc === 'tools/list').length >= 2),
  ),
});

/** The deadline of a call ends once the fake's tool has begun to sleep: the call is sent and not yet answered. */
export const callEndsOnceItSleeps: ToldBounds = (fake) => ({
  deadlineAfter: () => {
    const ended = new AbortController();
    void (async () => {
      await fake.sleepers.waited(1);
      ended.abort(new DOMException('The call took longer than it may', 'TimeoutError'));
    })();
    return ended.signal;
  },
});

/** No bound of a call ends by itself, and the fake's tool sleeps until the test wakes it with `wokenOnceAsleep`. */
export const sleepsUntilWoken: ToldBounds = Function.constant({});

/** Ends the sleep of the fake's tool once it has begun: the call in flight is then answered. */
export async function wokenOnceAsleep(fake: FakeMcpServer): Promise<void> {
  await fake.sleepers.waited(1);
  fake.sleepers.fire();
}

export const someDetail: unknown = expect.any(String);

export const mayChange = { readOnlyHint: false };

export const reads = { readOnlyHint: true };

export const problems = 'https://on.auto/problems/';

export const mayHaveActed = '. The tool ran and may have changed something; a run again calls it again';

export const refusingTheArguments: unknown = expect.stringMatching(
  /^The strict tool of chat refused the arguments: .*limit must be a whole number/u,
);

const failedInChat = /^The tool server chat failed: .*, after the run called the (?<tool>\S+) tool of chat$/u;

export const failedAfterCalling = (tool: string): unknown =>
  expect.toSatisfy((detail: string) => failedInChat.exec(detail)?.groups?.['tool'] === tool);

export const notAnsweredInTime: unknown = expect.stringMatching(
  /^The tool server chat failed: .*did not answer within 300 ms.*, after the run called the sleep tool of chat$/u,
);

export interface Ending {
  readonly status: number;
  readonly type: string;
  readonly kind?: string;
  readonly because?: string;
  readonly detail: unknown;
  readonly retryAfter: string | null;
}

export interface Row {
  readonly server?: SystemOptions;
  readonly document?: CallOptions;
  readonly input?: unknown;
  readonly before?: (server: SystemServer) => Promise<void> | void;
  /** The row changes its server for every run after it (closes its tool server, marks a tool), so it runs alone. */
  readonly alone?: true;
}

export type Rows = ReadonlyArray<readonly [string, Row, Ending]>;

const decodeProblem = Schema.decodeUnknownSync(
  Schema.Struct({
    type: Schema.String,
    kind: Schema.optionalKey(Schema.String),
    because: Schema.optionalKey(Schema.String),
    detail: Schema.Unknown,
  }),
);

export function endingOf({ status, body, headers }: TestResponse): Ending {
  return { status, ...decodeProblem(body), retryAfter: headers.get('retry-after') };
}

async function endedAlone(type: CallingType, { server = {}, document = {}, input, before }: Row): Promise<Ending> {
  const asking = await askingASystem({ timing: patientTiming, ...server, type });
  await asking.define('asking', document);
  await before?.(asking);
  return endingOf(await asking.runCall('asking', input));
}

type Hints = NonNullable<SystemOptions['hints']>;

function sharedAs({ hints: _hints, ...options }: SystemOptions = {}): string {
  return JSON.stringify(options);
}

function sharing({ alone, server = {} }: Row): boolean {
  return (
    alone === undefined &&
    server.ledgerOver === undefined &&
    server.over === undefined &&
    server.toldBounds === undefined
  );
}

function hintsSharedAs(rows: readonly Row[], as: string): Hints {
  const shared = rows.filter((row) => sharing(row) && sharedAs(row.server) === as);
  return Object.fromEntries(shared.flatMap(({ server }) => Object.entries(server?.hints ?? {})));
}

function runIdNumbered(run: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${run.toString(16).padStart(12, '0')}`;
}

/**
 * Ends the rows of a file on one server for each set of server options the rows share, rather than one server a row.
 * Each row defines its own function and runs under its own id, and the shared fake tool server marks every tool
 * the rows mark, so a row sees what it would on a server of its own. A row that changes its server runs alone.
 * Call it at the top of a test file: it stops its servers after the file.
 */
export function endingsOn(type: CallingType, rows: readonly Row[]): (row: Row) => Promise<Ending> {
  const stops: (() => Promise<void>)[] = [];
  const finishing = (stop: () => Promise<void>) => {
    stops.push(stop);
  };
  afterAll(async () => {
    await Promise.all(stops.map((stop) => stop()));
  });
  const servers = new Map<string, Promise<SystemServer>>();
  const serverFor = ({ server = {} }: Row): Promise<SystemServer> => {
    const as = sharedAs(server);
    const started =
      servers.get(as) ??
      askingASystem({ timing: patientTiming, ...server, hints: hintsSharedAs(rows, as), type }, finishing);
    servers.set(as, started);
    return started;
  };
  let runs = 0;
  return async (row) => {
    if (!sharing(row)) {
      return endedAlone(type, row);
    }
    const asking = await serverFor(row);
    runs += 1;
    const name = `asking-${runs}`;
    await asking.define(name, row.document);
    await row.before?.(asking);
    return endingOf(await asking.runCall(name, row.input, runIdNumbered(runs)));
  };
}

export const sentNothing = (because: string, detail: unknown, kind = 'tool_not_offered'): Ending => ({
  status: 503,
  type: `${problems}unavailable`,
  kind,
  because,
  detail,
  retryAfter: kind === 'tool_not_offered' ? null : '5',
});

export const unworkable = (detail: unknown): Ending => ({
  status: 409,
  type: `${problems}conflict`,
  kind: 'unworkable',
  detail,
  retryAfter: null,
});

export const unfinished = (because: string, detail: unknown): Ending => ({
  status: 503,
  type: `${problems}tools_unfinished`,
  kind: 'tools_unfinished',
  because,
  detail,
  retryAfter: null,
});

export const unknown = (because: string, detail: unknown): Ending => ({
  status: 409,
  type: `${problems}effect_unknown`,
  kind: 'effect_unknown',
  because,
  detail,
  retryAfter: null,
});
