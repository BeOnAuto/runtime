import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { largeModel, largeModelFloats, meanModelOfTheMeasures } from './measure/model-files.ts';

const capabilityMeasures = fileURLToPath(new URL('../../capabilities/prediction/measure-models.ts', import.meta.url));

const sessions = fileURLToPath(new URL('./src/sessions/model-sessions.ts', import.meta.url));

const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-onnx-models-'));
const mean = join(directory, 'mean.onnx');
const large = join(directory, 'large.onnx');
try {
  writeFileSync(mean, meanModelOfTheMeasures());
  writeFileSync(large, largeModel(largeModelFloats));
  execFileSync(process.execPath, [capabilityMeasures, sessions, mean, large], { stdio: 'inherit' });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
