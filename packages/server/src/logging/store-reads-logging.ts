import { mcpCallsNotedIn, type ApiEnv, type McpCallNoted } from '@on.auto/api';
import {
  heaviestReads,
  mostReadsNamed,
  storeReadsTally,
  type ReadClock,
  type StoreReads,
} from '@on.auto/ledger/store-reads';
import { trace } from '@opentelemetry/api';
import { Effect } from 'effect';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';

import type { LogLevelSetting } from './log-formats.ts';

export interface RequestReads {
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly reads: StoreReads;
  readonly mcp?: McpCallNoted;
}

export interface StoreReadsReporting {
  readonly report: (reads: RequestReads) => void;
  readonly clock?: ReadClock;
  readonly most?: number;
}

export function storeReadsOfRequests({
  report,
  clock = () => performance.now(),
  most = mostReadsNamed,
}: StoreReadsReporting): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const tally = storeReadsTally(clock);
    const calls: Promise<McpCallNoted>[] = [];
    await tally.run(() =>
      mcpCallsNotedIn(next, (noted) => {
        calls.push(noted);
      }),
    );
    const request = { method: c.req.method, route: routePath(c, -1), status: c.res.status };
    const [call] = calls;
    if (call !== undefined) {
      void call.then((mcp) => {
        report({ ...request, reads: heaviestReads(tally.taken(), most), mcp });
        return mcp;
      });
      return;
    }
    const reads = tally.taken();
    if (Object.keys(reads).length > 0) {
      report({ ...request, reads: heaviestReads(reads, most) });
    }
  };
}

export function logStoreReads(reads: RequestReads): Effect.Effect<void> {
  return Effect.logDebug('The reads of the ledger a request made').pipe(Effect.annotateLogs({ store_reads: reads }));
}

export interface StoreReadsWatching {
  readonly logLevel: LogLevelSetting;
  readonly traced: boolean;
  readonly run: (log: Effect.Effect<void>) => unknown;
}

export function storeReadsWatched({
  logLevel,
  traced,
  run,
}: StoreReadsWatching): MiddlewareHandler<ApiEnv> | undefined {
  const logged = logLevel === 'debug';
  if (!logged && !traced) {
    return undefined;
  }
  return storeReadsOfRequests({
    report: (reads) => {
      trace.getActiveSpan()?.setAttribute('auto.on.store_reads', JSON.stringify(reads.reads));
      if (logged) {
        void run(logStoreReads(reads));
      }
    },
  });
}
