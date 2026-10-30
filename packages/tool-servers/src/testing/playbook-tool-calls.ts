import {
  Ledger,
  makeDispatcher,
  settle,
  type CallerIdentity,
  type RecordedEvent,
  type RouteRegistration,
  type Settled,
} from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  memoryLedger,
  recordingReporter,
  type ReportedIncident,
} from '@on.auto/operations/testing';
import { Effect, Layer, type Tracer } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { defineExecute } from '../execute/execute.ts';
import { defineSearch } from '../search/search.ts';
import { defineDryRun } from '../tool-reads/dry-run.ts';
import { defineIntrospect } from '../tool-reads/introspect.ts';
import { defineValidate } from '../tool-reads/validate.ts';

export const toolCaller: CallerIdentity = {
  id: 'acme-builder',
  name: 'acme-builder',
  org: 'acme',
  permissions: ['playbook:read', 'playbook:write'],
  playbooks: '*',
};

export const toolReader: CallerIdentity = { ...toolCaller, id: 'acme-reader', permissions: ['playbook:read'] };

export type PlaybookTool = 'search' | 'introspect' | 'validate' | 'dry_run' | 'execute';

export interface Asking {
  readonly caller?: CallerIdentity;
  readonly playbook?: string;
  readonly signal?: AbortSignal;
  readonly tracer?: Tracer.Tracer;
}

export interface PlaybookToolCalls {
  readonly registrations: Readonly<Record<PlaybookTool, RouteRegistration<'playbook'>>>;
  readonly call: (tool: PlaybookTool, input: unknown, asking?: Asking) => Promise<Settled>;
  readonly recorded: () => Promise<readonly RecordedEvent[]>;
  readonly incidents: () => readonly ReportedIncident[];
  readonly writesAttempted: () => number;
}

export interface WritesOptions {
  readonly writesRefused?: boolean;
  readonly writesHeldUntil?: Promise<void>;
}

interface Refusing {
  readonly held: Promise<void>;
  readonly attempted: () => void;
}

function refusingWrites(ledger: Ledger['Service'], { held, attempted }: Refusing): Layer.Layer<Ledger> {
  const refused = Effect.sync(attempted).pipe(
    Effect.andThen(Effect.promise(() => held)),
    Effect.andThen(Effect.die(new Error('The ledger refused the write'))),
  );
  return Layer.succeed(Ledger, Ledger.of({ ...ledger, execute: () => refused }));
}

function registrationsOf(access: ToolAccess): PlaybookToolCalls['registrations'] {
  return {
    search: defineSearch(access).registration,
    introspect: defineIntrospect(access).registration,
    validate: defineValidate(access).registration,
    dry_run: defineDryRun(access).registration,
    execute: defineExecute(access).registration,
  };
}

export function playbookToolCalls(
  access: ToolAccess,
  { writesRefused = false, writesHeldUntil = Promise.resolve() }: WritesOptions = {},
): PlaybookToolCalls {
  const ledger = memoryLedger();
  const reporter = recordingReporter();
  const writes = { attempted: 0 };
  const refusing = {
    held: writesHeldUntil,
    attempted: () => {
      writes.attempted += 1;
    },
  };
  const services = Layer.mergeAll(
    writesRefused ? refusingWrites(ledger.service, refusing) : ledger.layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }], [{ org: 'acme', playbook: 'old' }]),
    reporter.layer,
  );
  const registrations = registrationsOf(access);
  const dispatcher = makeDispatcher([]);
  return {
    registrations,
    call: (tool, input, { caller = toolCaller, playbook = 'alpha', signal, tracer } = {}) => {
      const settled = settle(
        dispatcher.dispatchToPlaybook(registrations[tool], {
          caller,
          org: 'acme',
          playbook,
          input,
          encoding: 'json',
        }),
        signal,
      ).pipe(Effect.provide(services));
      return Effect.runPromise(tracer === undefined ? settled : Effect.withTracer(settled, tracer));
    },
    recorded: async () => {
      const page = await Effect.runPromise(
        ledger.service.readRecorded(
          { org: 'acme', playbook: 'alpha' },
          { kind: 'everything' },
          { order: 'asc', limit: 50 },
        ),
      );
      return page.records;
    },
    incidents: reporter.reported,
    writesAttempted: () => writes.attempted,
  };
}
