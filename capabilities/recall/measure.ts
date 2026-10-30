import { cpus } from 'node:os';

import { foldsMeasured } from './measure/folds.ts';

const [cpu] = cpus();

const folded = await foldsMeasured(100_000);

const lines = [
  `Node ${process.version} on ${cpu?.model ?? 'an unknown processor'}, ${cpus().length} cores`,
  `the example's fold over ${folded.events.toLocaleString('en-US')} runs of 100 campaigns, in ${folded.pages} pages of up to 1,000 in a warm worker, the view checked after every fold: ${(folded.milliseconds / 1000).toFixed(1)} s, ${Math.round((folded.events * 1000) / folded.milliseconds).toLocaleString('en-US')} folds a second, ${folded.checkpoints} checkpoints in all, to a view of ${folded.viewBytes.toLocaleString('en-US')} bytes`,
  `the same view and the same checkpoints over 3,000 of them in pages of 7 and of 1,000: ${folded.sameAtEveryPageSize ? 'yes' : 'no'}`,
];

for (const line of lines) {
  process.stdout.write(`${line}\n`);
}
