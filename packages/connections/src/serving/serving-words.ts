import { listed } from '@on.auto/operations';

import { variableUnset } from '../registry/registry-decisions.ts';

const reconnects = 'the person who added it reconnects it';

export const servingWords = {
  pending: (name: string) =>
    `Nobody has approved the connection ${name} yet; the person who added it opens its link, or reconnects it for a new link`,
  unreadableNow: (name: string, detail: string) =>
    `The credential of the connection ${name} cannot be read now: ${detail}`,
  gone: (name: string) => `The credential of the connection ${name} is no longer in the secret store, so ${reconnects}`,
  unset: variableUnset,
  unrecorded: (name: string) =>
    `The runtime found the connection ${name} broken but could not record it broken; it finds the break again, and records it again, at the next use`,
  notTokens: (name: string) =>
    `The credential of the connection ${name} is not the tokens of a consent the runtime keeps, so ${reconnects}`,
  consentEnded: (name: string) => `The consent of the connection ${name} was revoked or has ended, so ${reconnects}`,
  clientGone: (name: string) =>
    `The client the connection ${name} was made with is no longer registered, so ${reconnects}`,
  keyUnknown: (name: string) =>
    `Auto's consent service does not know the key of the connection ${name}, so its tokens cannot be renewed, and ${reconnects}`,
  keyRefused: `The tool server answered HTTP 401: it refused the credential the connection holds, so ${reconnects}`,
  noneRefused:
    'The tool server answered HTTP 401: it asks for a credential the connection does not hold, so the person who added it removes it and adds it again with one',
  referenceRefused: (variable: string) =>
    `The tool server answered HTTP 401: it refused the value of the variable ${variable}, so whoever runs the runtime sets it right and starts it again, and the person who added the connection reconnects it`,
  unchecked: (name: string, details: readonly string[]) =>
    `The entry of the connection ${name} is not one this runtime takes any more: ${listed(details)}`,
} as const;
