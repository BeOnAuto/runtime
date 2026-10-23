import { MessagePort, workerData } from 'node:worker_threads';

import { Option, Schema } from 'effect';

import { instanceStock, type InstanceSource } from '../instances/instance-source.ts';
import {
  answeredFlag,
  EvaluationRequestSchema,
  readyFlag,
  type AnsweredRequest,
  type PrepareRequest,
} from '../jobs/evaluation-messages.ts';
import { expressionUnitOf, type OpenedUnit } from '../programs/expression-units.ts';
import { filterContextOf, type FilterContext, type FilterTest } from '../programs/kept-contexts.ts';
import type { ProgramRun } from '../programs/program-run.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxSettings } from '../programs/sandbox-session.ts';
import { handedSandboxOf } from './handed-files.ts';

interface PreparedFilters {
  readonly context: FilterContext;
  readonly tests: readonly FilterTest[];
}

interface Held {
  readonly instances: InstanceSource;
  readonly units: Map<number, OpenedUnit>;
  readonly filters: Map<number, PreparedFilters>;
}

const EvaluationDataSchema = Schema.Struct({
  port: Schema.instanceOf(MessagePort),
  flags: Schema.instanceOf(SharedArrayBuffer),
});

const decodeData = Schema.decodeUnknownOption(EvaluationDataSchema);

const decodeRequest = Schema.decodeUnknownOption(EvaluationRequestSchema);

const settings: SandboxSettings = {
  stackBytes: threadStackBytes,
  mostAnswerBytes: unitMemoryBytes,
  clock: () => performance.timeOrigin + performance.now(),
};

function unheld(detail: string): ProgramRun {
  return { ran: 'raised', issue: { detail, line: null }, work: 0 };
}

async function unitOf(id: number, held: Held): Promise<OpenedUnit> {
  const known = held.units.get(id);
  if (known !== undefined) {
    return known;
  }
  const instance = await held.instances(unitMemoryBytes);
  const unit = expressionUnitOf(() => instance, settings);
  held.units.set(id, unit);
  return unit;
}

async function prepared({ unit, sources, evaluation }: PrepareRequest, held: Held): Promise<ProgramRun> {
  const context = filterContextOf(await held.instances(unitMemoryBytes), settings, evaluation);
  const tests = sources.map((source) => context.define(source));
  held.filters.set(unit, { context, tests });
  return context.freeze() ?? { ran: 'answered', text: 'null', work: 0 };
}

async function answerTo(request: AnsweredRequest, held: Held): Promise<ProgramRun> {
  if (request.kind === 'evaluate') {
    return (await unitOf(request.unit, held)).evaluateNamed(request.source, request, request.evaluation);
  }
  if (request.kind === 'prepare') {
    return prepared(request, held);
  }
  const test = held.filters.get(request.unit)?.tests[request.test];
  return test === undefined
    ? unheld(`The evaluation worker holds no test ${request.test} of unit ${request.unit}`)
    : test(request.value, request.evaluation);
}

function released(unit: number, held: Held): void {
  held.units.get(unit)?.close();
  held.units.delete(unit);
  held.filters.get(unit)?.context.close();
  held.filters.delete(unit);
}

function served(port: MessagePort, answer: (run: ProgramRun) => ProgramRun, held: Held): void {
  port.on('message', (message: unknown) => {
    const request = decodeRequest(message);
    if (Option.isNone(request)) {
      answer(unheld('The evaluation worker could not read the request'));
    } else if (request.value.kind === 'close') {
      released(request.value.unit, held);
    } else {
      void answerTo(request.value, held).then(answer);
    }
  });
}

export function serveEvaluations(data: unknown = workerData): void {
  const decoded = decodeData(data);
  if (Option.isNone(decoded)) {
    return;
  }
  const { port } = decoded.value;
  const flags = new Int32Array(decoded.value.flags);
  const answer = (run: ProgramRun): ProgramRun => {
    port.postMessage(run, []);
    Atomics.store(flags, answeredFlag, 1);
    Atomics.notify(flags, answeredFlag);
    return run;
  };
  const sandbox = handedSandboxOf(data);
  served(port, answer, { instances: instanceStock(sandbox), units: new Map(), filters: new Map() });
  void sandbox(unitMemoryBytes).then((instance) => {
    instance.release(true);
    Atomics.store(flags, readyFlag, 1);
    Atomics.notify(flags, readyFlag);
    return instance;
  });
}
