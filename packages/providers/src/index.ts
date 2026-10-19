export { WayKindSchema, wayFields, type CredentialWay, type WayKind } from './entry/credential-ways.ts';
export { clientIdPlaceholder, type Choice, type Placeholder } from './entry/placeholders.ts';
export { ProviderEntrySchema, type ProviderEntry } from './entry/provider-entry.ts';
export { isPinnableTemplate, pinnedTemplateShape } from './entry/entry-values.ts';
export { documentServerOf, providerNamed, type Provider, type ProviderList } from './reading/provider-list.ts';
export {
  hostAlternativesOf,
  operatorValuesIn,
  operatorVariablesIn,
  operatorVariablesOf,
} from './reading/provider-reach.ts';
export { ProvidersInvalid, readProviders } from './reading/shipped-providers.ts';
export {
  additionOfProvider,
  type GivenToProvider,
  type ProviderAddition,
  type ProviderConnectionEntry,
  type ProviderCredential,
} from './resolution/provider-addition.ts';
