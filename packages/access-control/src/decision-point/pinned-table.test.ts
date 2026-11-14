import { cedarModuleBundled } from '../engine/cedar-module-bundled.ts';
import { cedarOnDisk, filesOnDisk } from '../testing/access-testing.ts';
import { pinnedTableBehaviour } from '../testing/pinned-table-behaviour.ts';
import { cedarDecisionPoint } from './cedar-decision-point.ts';

const moduleOfABundle = cedarModuleBundled(async () => ({ default: await cedarOnDisk() }));

pinnedTableBehaviour('the engine Node loads', (parts) =>
  cedarDecisionPoint({ module: cedarOnDisk, files: filesOnDisk, ...parts }),
);

pinnedTableBehaviour('the engine a bundle hands over compiled, as a Worker loads it', (parts) =>
  cedarDecisionPoint({ module: moduleOfABundle, files: filesOnDisk, ...parts }),
);
