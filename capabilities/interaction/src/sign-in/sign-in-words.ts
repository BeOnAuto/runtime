import type { RecordedCaller } from '@on.auto/operations';

import type { SignInQuestion, SignInSite } from '../document/interaction-document.ts';
import { signInTool } from './sign-in-schemas.ts';

export function noPersonWords({ site }: SignInSite, person?: string): string {
  return person === undefined
    ? `The run acts for no person who can sign in to ${site}, so nobody was asked: a key started it, or a trigger of a version a key saved or whose person has left the organization`
    : `${person}, whom the run acts for, has left the organization, so nobody was asked to sign in to ${site}`;
}

export function signedOutWords({ site }: SignInSite): string {
  return `The person the run acts for is not signed in to ${site}, and the function stops rather than asks them`;
}

export function noLinkWords({ site }: SignInSite): string {
  return `The person the run acts for is not signed in to ${site}, and ${signInTool} gave no link where they sign in`;
}

const fieldOfTheQuestion: Readonly<Record<SignInQuestion, string>> = {
  if_signed_out: 'sign_in.if_signed_out',
  deliver: 'deliver',
  expires: 'expires',
};

export function signInUnsaidWords(question: SignInQuestion): string {
  return `The sign-in function leaves out ${fieldOfTheQuestion[question]}, which a save asks the person for; save it again with their answer`;
}

export function declinedWords({ site }: Pick<SignInSite, 'site'>, by: RecordedCaller, reason?: string): string {
  const said = `${by.name} answered that they did not sign in to ${site}`;
  return reason === undefined ? said : `${said}: ${reason}`;
}

export function signedInWords({ site }: Pick<SignInSite, 'site'>): string {
  return `The person it acts for is signed in to ${site}.`;
}
