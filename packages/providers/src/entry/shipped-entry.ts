import { Schema } from 'effect';

import { EntryIconsSchema } from './entry-icons.ts';
import { providerEntryFields, providerEntryIssues } from './provider-entry.ts';

export const ShippedProviderEntrySchema = Schema.Struct({
  ...providerEntryFields,
  icons: Schema.optionalKey(EntryIconsSchema),
}).check(providerEntryIssues);

export type ShippedProviderEntry = typeof ShippedProviderEntrySchema.Type;
