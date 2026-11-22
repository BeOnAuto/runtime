import { measuredPoolSettings } from '@on.auto/definitions/testing';
import {
  mostValueDepth,
  programPool,
  type ModuleAddress,
  type PoolSettings,
  type ProgramPool,
} from '@on.auto/workflow-engine/dsl';
import { moduleOfSource } from '@on.auto/workflow-engine/testing';
import { threadPool } from '@on.auto/workflow-engine/thread-pool';

export const breaksTheWorker = 'breaks the worker';

const jobLoop = import.meta.resolve('@on.auto/workflow-engine/job-loop');

const answerers = import.meta.resolve('@on.auto/workflow-engine/worker');

const schemaChecks = import.meta.resolve('@on.auto/json-schema');

interface Folding {
  readonly prelude: readonly string[];
  readonly whenFolding: string;
  readonly serving: string;
  readonly clock?: { readonly starting: string; readonly now: string };
}

const hostClock = { starting: '', now: 'host.now' };

export function foldingWorker({ prelude, whenFolding, serving, clock = hostClock }: Folding): ModuleAddress {
  const source = [
    `import { serveJobs } from '${jobLoop}';`,
    `import { foldAnswerOf } from '${answerers}';`,
    ...prelude,
    'const fold = (request, host) => {',
    '  const events = JSON.parse(request.events);',
    `  ${clock.starting}`,
    '  const folding = (event, view) => {',
    '    host.folding(event, view);',
    `    ${whenFolding}`,
    '  };',
    `  return foldAnswerOf(request, { ...host, folding, now: ${clock.now} });`,
    '};',
    serving,
  ];
  return moduleOfSource(source.join('\n'));
}

export const testFoldWorker = foldingWorker({
  prelude: [
    `import { issuesDetail, schemaCheckOf } from '${schemaChecks}';`,
    'const view = (schema) => {',
    `  const check = schemaCheckOf(schema, { what: 'view', nesting: ${mostValueDepth} });`,
    "  return (value) => { const issues = check(value); return issues.length === 0 ? undefined : { kind: 'schema', detail: issuesDetail(issues, 'view') }; };",
    '};',
  ],
  whenFolding: '',
  serving: 'serveJobs({ fold, checks: { output: () => () => [], view } });',
});

export const breakingFoldWorker = foldingWorker({
  prelude: [],
  whenFolding: `if (events[event]?.data?.output === '${breaksTheWorker}') throw new Error('broken on purpose');`,
  serving: 'serveJobs({ fold });',
});

function foldPoolSettingsOf(settings: Partial<PoolSettings>): PoolSettings {
  return { workers: 4, heapMegabytes: 64, ...measuredPoolSettings, ...settings };
}

export function testFoldPoolOf(settings: Partial<PoolSettings>): ProgramPool {
  return programPool(foldPoolSettingsOf(settings));
}

/** The pool of `testFoldPoolOf`, serving its folds on the thread of the test, for a rule that is not the worker itself. */
export function testFoldThreadPoolOf(settings: Partial<PoolSettings>): ProgramPool {
  return threadPool(foldPoolSettingsOf(settings));
}
