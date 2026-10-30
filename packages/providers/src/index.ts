export {
  WayKindSchema,
  consentEndpoints,
  consentIssuesOf,
  holdsAClientId,
  wayFields,
  type ConsentFields,
  type CredentialWay,
  type WayKind,
} from './entry/credential-ways.ts';
export { scopesIn, scopeWith, type ScopeGroup } from './entry/scope-groups.ts';
export { wayAddresses, type WayAddress } from './entry/templates.ts';
export { clientIdPlaceholder, type Choice, type Placeholder } from './entry/placeholders.ts';
export {
  AddedProviderEntrySchema,
  ProviderEntrySchema,
  entryProse,
  type ProviderEntry,
} from './entry/provider-entry.ts';
export { isPinnableTemplate, pinnedTemplateShape } from './entry/entry-values.ts';
export {
  documentServerOf,
  joinedProviders,
  providerNamed,
  type Provider,
  type ProviderList,
} from './reading/provider-list.ts';
export {
  hostAlternativesOf,
  operatorValuesIn,
  operatorVariablesIn,
  operatorVariablesOf,
} from './reading/provider-reach.ts';
export { ProvidersInvalid, providersShippedRoots, readProviders } from './reading/shipped-providers.ts';
export {
  additionOfProvider,
  type GivenToProvider,
  type ProviderAddition,
  type ProviderConnectionEntry,
  type ProviderCredential,
} from './resolution/provider-addition.ts';
