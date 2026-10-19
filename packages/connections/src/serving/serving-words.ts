import { listed } from '@on.auto/operations';

const removeAndAdd = 'the person who added it removes it and adds it again';

export const servingWords = {
  pending: (name: string) =>
    `Nobody has approved the connection ${name} yet; the person who added it opens its link, or removes it and adds it again for a new link`,
  unreadable: (name: string, detail: string) =>
    `The credential of the connection ${name} cannot be read, so ${removeAndAdd}: ${detail}`,
  gone: (name: string) =>
    `The credential of the connection ${name} is no longer in the secret store, so ${removeAndAdd}`,
  unset: (name: string, variable: string) =>
    `The variable ${variable} that the connection ${name} sends is not set on this runtime; whoever runs it sets the variable and starts it again`,
  unrecorded: (name: string) =>
    `The runtime found the credential of the connection ${name} unreadable but could not record it broken; it reads the credential again, and records the break again, at the next use`,
  unserved: (name: string) =>
    `This runtime calls no tool through the connection ${name}, which was connected by signing in to its provider`,
  unchecked: (name: string, details: readonly string[]) =>
    `The entry of the connection ${name} is not one this runtime takes any more: ${listed(details)}`,
} as const;
