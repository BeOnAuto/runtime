import type { ModuleAddress } from '../jobs/pool-contract.ts';
import { beginningSource, onReleaseSource } from './counting-workers.ts';
import { moduleOfSource } from './source-modules.ts';

function workerOf(lines: readonly string[]): ModuleAddress {
  return moduleOfSource(lines.join('\n'));
}

const answeringByThread = [
  "import { BroadcastChannel, parentPort, threadId } from 'node:worker_threads';",
  'const listen = () => {',
  "  parentPort.on('message', ({ job, request }) => {",
  '    const issues = request.expressions.map((each, at) => ({ at, line: threadId, detail: each.source }));',
  "    parentPort.postMessage({ job, answer: { ran: 'checked', issues }, keep: true });",
  '  });',
  '  parentPort.postMessage({ ready: true });',
  '};',
];

/** A checking worker that is ready only once the test calls `released`, and tells `begun` it is starting. */
export function checkingReadyWhenReleased(): ModuleAddress {
  return workerOf([...answeringByThread, onReleaseSource('listen();'), beginningSource('starting')]);
}

export const checking = workerOf([...answeringByThread, 'listen();']);

export const checkingForever = workerOf([
  "import { BroadcastChannel, parentPort, threadId } from 'node:worker_threads';",
  "parentPort.on('message', () => {",
  `  ${beginningSource('forever')}`,
  '  for (;;) {}',
  '});',
  'parentPort.postMessage({ ready: true });',
]);

export const brokenAtStart = workerOf(["throw new Error('broken on purpose');"]);

export function checkingWithTheFilesHanded(tag: string): ModuleAddress {
  return workerOf([
    "import { parentPort, workerData } from 'node:worker_threads';",
    `const tag = ${JSON.stringify(tag)};`,
    'const issues = Object.keys(workerData.handed).map((detail) => ({ at: 0, line: tag.length, detail }));',
    "parentPort.on('message', ({ job }) => {",
    "  parentPort.postMessage({ job, answer: { ran: 'checked', issues }, keep: true });",
    '});',
    'parentPort.postMessage({ ready: true });',
  ]);
}
