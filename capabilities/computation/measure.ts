import { cpus, totalmem } from 'node:os';

import { burstMeasured } from './measure/burst.ts';
import { constructsMeasured } from './measure/constructs.ts';
import { exampleMeasured } from './measure/example.ts';
import { idleMeasured, runsMeasured } from './measure/runs.ts';
import { workersMeasured } from './measure/workers.ts';

const [cpu] = cpus();

const measured = [
  `Node ${process.version} on ${cpu?.model ?? 'an unknown processor'}, ${cpus().length} cores, ${Math.round(totalmem() / 1_073_741_824)} GiB`,
  ...(await exampleMeasured()),
  ...(await constructsMeasured()),
  ...(await runsMeasured()),
  await burstMeasured(),
  await idleMeasured(),
  ...(await workersMeasured()),
];

for (const line of measured) {
  process.stdout.write(`${line}\n`);
}
