import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import {
  allocatingModel,
  extraInputModel,
  hostileModel,
  lastValueModel,
  meanModel,
  runRateModel,
  sequenceModel,
  wholeNumbersModel,
} from './candidate-graphs.ts';
import type { Bytes } from './onnx-writer.ts';

const visits = { steps: 2, low: 1, high: 1 };

const mean = meanModel({ ...visits, low: 2, high: 2 });

const meanSha256 = createHash('sha256').update(mean).digest('hex');

const candidates: Readonly<Record<string, Bytes>> = {
  'visits-last': lastValueModel(visits),
  'visits-mean': mean,
  'visits-week': lastValueModel(visits, { length: 7 }),
  'visits-many-features': meanModel({ ...visits, low: 2, high: 2 }, { features: 40, given: 8 }),
  'visits-extra-input': extraInputModel(visits),
  'visits-opset-12': lastValueModel(visits, {}, 12),
  'visits-whole-numbers': wholeNumbersModel(2),
  'visits-allocating': allocatingModel(2),
  'visits-hostile': hostileModel(2, '../../../../../../etc/passwd'),
  'visits-sibling': hostileModel(2, `${meanSha256}.onnx`),
  'visits-cousin': hostileModel(2, `../${meanSha256}/model.onnx`),
  'visits-sequence': sequenceModel(2),
  'orders-last': lastValueModel({ steps: 4, low: 2, high: 2 }, { features: 2, given: 1 }),
  'totals-run-rate': runRateModel(),
};

const here = new URL('./', import.meta.url);

for (const [name, bytes] of Object.entries(candidates)) {
  writeFileSync(new URL(`${name}.onnx`, here), bytes);
}
writeFileSync(new URL('not-a-model.onnx', here), 'This is text that says it is a model, and it is not one.\n');
process.stdout.write(`Wrote ${Object.keys(candidates).length + 1} candidate files into ${here.pathname}\n`);
