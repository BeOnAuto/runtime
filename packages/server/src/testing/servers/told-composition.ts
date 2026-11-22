import type { ApiEnv } from '@on.auto/api';
import type { AppendObserver } from '@on.auto/ledger';
import type { MiddlewareHandler } from 'hono';

import type { ComposedServerOptions } from '../../server-options/composed-options.ts';
import type { Telemetry } from '../../telemetry/telemetry.ts';
import { inAWaitsRead, readByAWaitHeader, somethingHappened } from '../waiting/happenings.ts';
import type { WorkInHand } from '../waiting/work-in-hand.ts';

/** A request the server answered, as its first middleware saw the answer leave. */
interface AnsweredRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

export interface ToldComposition {
  readonly composed: ComposedServerOptions;
  /** The requests that reached the server, in order, answered or not. */
  readonly arrived: () => readonly Omit<AnsweredRequest, 'status'>[];
  /** The requests the server answered, in order, 499 where the client had gone before the answer. */
  readonly answered: () => readonly AnsweredRequest[];
}

function appendsTold({ appended: traced }: Telemetry): AppendObserver {
  return {
    appended: (stream, events, place) => {
      traced?.appended(stream, events, place);
      somethingHappened();
    },
  };
}

interface Recording {
  readonly arrived: (request: Omit<AnsweredRequest, 'status'>) => void;
  readonly answered: (request: AnsweredRequest) => void;
}

/**
 * Tells the waits of a request arriving and of its answer, unless a wait's read made it: a read changes nothing. The
 * request is in hand until it is answered.
 */
function requestsTold(recorded: Recording, inHand: WorkInHand): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const told = inAWaitsRead() || context.req.header(readByAWaitHeader) !== undefined ? () => {} : somethingHappened;
    const ended = inHand.begun();
    recorded.arrived({ method: context.req.method, path: context.req.path });
    told();
    try {
      await next();
    } finally {
      ended();
    }
    recorded.answered({ method: context.req.method, path: context.req.path, status: context.res.status });
    told();
  };
}

/**
 * The server composed as given, telling the tests of the process of each append it commits and each request it
 * answers, so that a test waiting on what the server recorded, or on the server seeing its client go, reads it again
 * then, and not on an interval.
 */
export function toldOf(options: ComposedServerOptions, inHand: WorkInHand): ToldComposition {
  const answered: AnsweredRequest[] = [];
  const arrived: Omit<AnsweredRequest, 'status'>[] = [];
  const recording: Recording = {
    arrived: (request) => {
      arrived.push(request);
    },
    answered: (request) => {
      answered.push(request);
    },
  };
  return {
    arrived: () => [...arrived],
    answered: () => [...answered],
    composed: {
      ...options,
      composed: async (settings, telemetry, shippedFiles) => {
        const composed = await options.composed(
          settings,
          { ...telemetry, appended: appendsTold(telemetry) },
          shippedFiles,
        );
        return {
          ...composed,
          serve: async (runtime, ownOrigin) => ({
            ...(await composed.serve(runtime, ownOrigin)),
            observedRequests: requestsTold(recording, inHand),
          }),
        };
      },
    },
  };
}
