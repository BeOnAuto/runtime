import { writeFileSync } from 'node:fs';

import { largeModel, largeModelFloats } from './model-files.ts';

const [path = ''] = process.argv.slice(2);
writeFileSync(path, largeModel(largeModelFloats));
