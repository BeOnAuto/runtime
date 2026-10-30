import { noStrippedForms, runnableAttributes, type StrippedForms } from '@on.auto/definitions';
import { Option, Schema } from 'effect';

import { digestOfData } from '../data/data-digest.ts';
import { aggregations } from '../document/front-matter.ts';
import { grains } from '../periods/grains.ts';

const FilterSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Json),
]);

const DatasetDataSchema = Schema.Struct({
  period: Schema.Literals(grains),
  events: Schema.Array(FilterSchema),
  time: Schema.String,
  series: Schema.String,
  target: Schema.Struct({ of: Schema.optionalKey(Schema.String), as: Schema.Literals(aggregations) }),
});

export type DatasetData = typeof DatasetDataSchema.Type;

const DatasetDetailsSchema = Schema.Struct({ data: DatasetDataSchema });

export interface KeptDataset {
  readonly dataSha256: string;
  readonly data: DatasetData;
}

const decodeDetails = Schema.decodeUnknownOption(DatasetDetailsSchema);

const decodeKept = Schema.decodeUnknownOption(Schema.Struct({ dataSha256: Schema.String, data: DatasetDataSchema }));

export function keptDatasetOf(details: unknown, stripped: StrippedForms = noStrippedForms): KeptDataset | undefined {
  return Option.getOrUndefined(
    Option.map(decodeDetails(details), ({ data }) => ({
      dataSha256: digestOfData(data),
      data: {
        ...data,
        events: data.events.map((filter) => ({ ...runnableAttributes(filter, stripped), type: filter.type })),
      },
    })),
  );
}

export function datasetOfKept(kept: unknown): KeptDataset | undefined {
  return Option.getOrUndefined(decodeKept(kept));
}

export const decodeStoredData = Schema.decodeUnknownSync(Schema.fromJsonString(DatasetDataSchema));
