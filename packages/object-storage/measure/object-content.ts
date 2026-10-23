import { contentTableHead, measuredContent } from '@on.auto/ledger/content-measurement';

import { objectContentOn } from '../src/content/object-content.ts';
import { bucketOnS3 } from '../src/s3/s3-bucket.ts';
import { bucketReady, emptied, testObjectStoreOf } from '../src/testing/test-object-store.ts';

const { bucket } = testObjectStoreOf(
  process.env['CONTENT_MEASURE_OBJECT_STORE_URL'] ?? 'http://access:secret@127.0.0.1:9000/measure',
);

const location = { bucket: bucket.name, prefix: `content-measure/${String(Date.now())}` };

await bucketReady(bucket);
contentTableHead();
const held = await measuredContent('Object storage', objectContentOn(bucketOnS3(bucket), location).content);
process.stdout.write(`\n${held}\n`);
await emptied(bucket, location.prefix);
