export { WayKindSchema, holdsAClientId, wayFields, type CredentialWay, type WayKind } from './entry/credential-ways.ts';
export { consentEndpoints, consentIssuesOf, type ConsentFields } from './entry/consent-fields.ts';
export {
  AccountTypeSchema,
  accountTypeIssueOf,
  accountTypeWhereNoneIsGiven,
  accountTypesOf,
  isTheWayAsked,
  permissionsOf,
  type AccountType,
} from './entry/account-types.ts';
export { PermissionsSchema, type Permissions } from './entry/gateway-ways.ts';
export { scopesIn, scopeWith, type ScopeGroup } from './entry/scope-groups.ts';
export { wayAddresses, type WayAddress } from './entry/templates.ts';
export { keyFieldNames, keyFields, type AppCredential, type KeyFieldName } from './keys/key-fields.ts';
export { matchesKeyPattern } from './keys/key-patterns.ts';
export { addressGivenWholeIn, clientIdPlaceholder, type Choice, type Placeholder } from './entry/placeholders.ts';
export {
  AddedProviderEntrySchema,
  ProviderEntrySchema,
  entryProse,
  type ProviderEntry,
} from './entry/provider-entry.ts';
export { isPinnableTemplate, pinnedTemplateShape } from './entry/entry-values.ts';
export { aliasesTakenIn, providerNamesOf, type AliasTaken } from './entry/provider-names.ts';
export { ConversationsSchema, conversationTemplates, type Conversations } from './entry/conversation-parts.ts';
export { arrivalReadingOf, type Arrival, type ArrivalReading } from './events/arrival-readings.ts';
export { chatMessageIn, type ChatMessage } from './events/chat-arrivals.ts';
export { millisecondsSinceTheEpochOf } from './events/event-times.ts';
export { typingShownBy, typingShownThrough } from './events/typing-calls.ts';
export { presentedProofOf, type PresentedProof } from './events/presented-proofs.ts';
export type { Destination as EventDestination } from './events/destination-fields.ts';
export {
  EventsByHandSchema,
  RecordedEventsSchema,
  toolsNamedIn,
  type EventsByHand,
  type RecordedEvents,
} from './events/events-by-hand.ts';
export { provesTheBody, provesTheBodyAndATime, provesWhatIsReadAt } from './events/event-proofs.ts';
export { openedAndClosed, receivingOverASocket, type SocketListening } from './sockets/socket-listening.ts';
export { socketKeyOf, socketStepsOf, stillRefused } from './sockets/socket-set.ts';
export { opensAsDeclared, type OpeningWays } from './sockets/socket-openings.ts';
export {
  SocketEnded,
  type Arrived,
  type ConstructsASocket,
  type OpenSocket,
  type OpensASocket,
  type SendsABearerRequest,
  type SocketArrival,
  type SocketEnd,
  type SocketFrame,
  type SocketOpening,
} from './sockets/socket-ports.ts';
export {
  asNamedIn,
  conversationsOf,
  eventDestinationOf,
  documentServerOf,
  joinedProviders,
  providerFoundBy,
  providerNamed,
  rendersOf,
  replacedNamesOf,
  replacementOf,
  type NamedAs,
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
export { requestOriginsOf } from './events/event-destinations.ts';
export { subscriptionCallsOf } from './subscriptions/subscription-calls.ts';
export { subscriptionLoopOf } from './subscriptions/subscription-loop.ts';
export {
  asksATool,
  identitiesReadAsTheConnection,
  identitiesReadOf,
  type OwedAsTheConnection,
} from './subscriptions/subscription-identities.ts';
export { placeNamesReadOf } from './subscriptions/subscription-place-names.ts';
export {
  requestsAskerOf,
  triggersAskerOf,
  triggerTopicsOf,
  type ConnectionTrigger,
  type WaitingRequest,
} from './subscriptions/subscription-topics.ts';
export {
  generationOf,
  holdsARead,
  isArranging,
  isHeldBy,
  isLasting,
  isPolled,
  isSubscribable,
  resyncedAfterMs,
  type Polled,
  type Subscribable,
} from './subscriptions/subscription-records.ts';
export { pollingIntervalSecondsOf } from './checks/check-pace.ts';
export { readOfATrigger } from './checks/trigger-reads.ts';
export {
  SubscriptionCallFailed,
  SubscriptionFailedBecauseSchema,
  SubscriptionFailureKindSchema,
  type SubscriptionFailedBecause,
  type SubscriptionFailureKind,
} from './subscriptions/subscription-failed.ts';
export type {
  AskedSubscription,
  Asker,
  Asking,
  Generation,
  HeldSubscription,
  KeptSecret,
  ListedArrival,
  LoopConnection,
  MadeByPolling,
  MadeSubscription,
  MadeThroughACall,
  Mark,
  Positions,
  Reconciled,
  RecordedFailure,
  RecordedSubscription,
  Renewed,
  Renewing,
  Subscribed,
  Subscribing,
  SubscriptionCalls,
  SubscriptionKey,
  SubscriptionLoopPorts,
  SubscriptionPlace,
  SubscriptionPorts,
  SubscriptionRecords,
  SubscriptionSecret,
  SubscriptionSecrets,
  TakeListed,
  TakenIn,
  ThroughTheConnection,
  Unsubscribing,
} from './subscriptions/subscription-ports.ts';
