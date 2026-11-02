import type { SchemaIssue } from '@on.auto/json-schema';

import { shapeOf, type OutputShape } from './output-shape.ts';

function noFurtherIssues(): readonly SchemaIssue[] {
  return [];
}

const addressedUntilNull = { type: ['string', 'null'], format: 'date-time' };

export const assetShape: OutputShape = shapeOf({
  name: 'asset',
  properties: {
    id: { type: 'string', format: 'uuid', description: "The asset's id, which another function takes as a reference" },
    media_type: { type: 'string', description: 'The media type of its bytes, such as image/png or audio/mpeg' },
    bytes: { type: 'integer', minimum: 0, description: 'Its size in bytes' },
    sha256: { type: 'string', minLength: 64, maxLength: 64, description: 'The SHA-256 of its bytes, in lowercase hex' },
    address: {
      type: ['string', 'null'],
      format: 'uri',
      description:
        'A signed address its bytes are read at without a key until address_until, or null where the runtime signs none',
    },
    address_until: { ...addressedUntilNull, description: 'When the address stops being answered, or null' },
  },
  required: ['id', 'media_type', 'bytes', 'sha256', 'address', 'address_until'],
  further: noFurtherIssues,
});
