import { counted, quoted } from '@on.auto/operations';
import type { KeptView, StallCause, ViewStall } from '@on.auto/workflow-host';

import { recallBounds } from './recall-bounds.ts';

const second = 1000;

const units = [
  { per: 86_400_000, noun: { one: 'day', other: 'days' } },
  { per: 3_600_000, noun: { one: 'hour', other: 'hours' } },
  { per: 60_000, noun: { one: 'minute', other: 'minutes' } },
  { per: second, noun: { one: 'second', other: 'seconds' } },
] as const;

const tryAgain = 'try again in a little while';

const wordsOfStall: Readonly<Record<StallCause, string>> = {
  raised: 'its fold raised an error',
  work: `its fold did more than the ${recallBounds.budget} checkpoints of work one fold may do`,
  time: `its fold ran past the ${recallBounds.foldDeadlineMs} ms one fold may take, every time it was tried`,
  memory: 'its fold used more memory than a fold may',
  crash: 'its fold broke the worker that ran it, every time it was tried',
  size: `the view it folded took more than the ${recallBounds.mostViewBytes} bytes a view may`,
  schema: "the view it folded did not match the view's schema",
  unfit: 'its fold answered a view that is not JSON, or one nested deeper than 512 levels',
  refused: 'its module does not load on this server',
};

export function lagOf(newestAt: string | undefined, checkpointAt: string | null): number | undefined {
  if (newestAt === undefined || checkpointAt === null) {
    return undefined;
  }
  return Math.max(0, Date.parse(newestAt) - Date.parse(checkpointAt));
}

export function lagInWords(lag: number | undefined): string {
  const unit = units.find(({ per }) => lag !== undefined && lag >= per);
  return lag === undefined || unit === undefined
    ? 'less than a second'
    : counted(Math.floor(lag / unit.per), unit.noun);
}

export function rebuildingDetail(
  name: string,
  version: number,
  kept: KeptView | undefined,
  newestAt: string | undefined,
): string {
  const named = `The recall function ${quoted(name)}`;
  if (kept === undefined || kept.version !== version) {
    return `${named} has not begun to build its view of version ${version} from the playbook's history yet; ${tryAgain}`;
  }
  if (kept.phase === 'waiting') {
    return `${named} waits to build its view of version ${version}, behind other recall functions of this playbook being built; ${tryAgain}`;
  }
  const behind = lagInWords(lagOf(newestAt, kept.checkpointAt));
  return `${named} is building its view of version ${version} from the playbook's history: it has folded ${counted(kept.folded, { one: 'event', other: 'events' })} so far, and is ${behind} behind the playbook's newest record; ${tryAgain}`;
}

export function stalledDetail(name: string, { event, kind, line }: ViewStall): string {
  const where = line === null ? '' : ` on line ${line}`;
  return `The view of the recall function ${quoted(name)} stopped at the ${event.type} event of ${event.time}: ${wordsOfStall[kind]}${where}. Save a corrected version to build the view again from the playbook's history`;
}
