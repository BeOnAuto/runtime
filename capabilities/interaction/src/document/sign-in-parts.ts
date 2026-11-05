import { issueAt, type DocumentIssue, type DocumentParts, type SourceLines } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import { nameIssues, placeOf, type DocumentReading } from '@on.auto/definitions/tool-blocks';
import { isServerName, serverNameShape } from '@on.auto/tool-servers/policy';
import { Predicate, Result, Struct, type Schema } from 'effect';

import { compiledSignedIn } from '../sign-in/sign-in-schemas.ts';
import type { InteractionFrontMatter, WrittenSignIn } from './front-matter.ts';
import type { SignInDocument, SignInQuestion, WhenSignedOut } from './interaction-document.ts';
import { routeIn, wayOf, type WrittenWay } from './route-parts.ts';
import { contractOf, expiresOf, issuesOf, messageOf, type Checked } from './written-parts.ts';

const writesASignIn = /^sign_in:/mu;

export function asksToSignIn(root: unknown): boolean {
  return Predicate.hasProperty(root, 'sign_in');
}

export function seemsToAskToSignIn({ frontMatter }: Pick<DocumentParts, 'frontMatter'>): boolean {
  return writesASignIn.test(frontMatter);
}

const mostSiteBytes = 253;

const hostName = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;

const siteWords = `sign_in.site is the host name of the site, such as portal.supplier.example, written as text and never as a template: lower case, without a scheme, a path or a port, at most ${mostSiteBytes} bytes`;

const refusedBesideSignIn: readonly (readonly [keyof InteractionFrontMatter, string])[] = [
  ['call', 'A sign-in function calls the sign-in tool of its server itself, so it takes no call'],
  ['to', 'A sign-in function asks the person the run acts for, so to would name someone else'],
  ['from', 'A sign-in function asks the person the run acts for, so from would name someone else'],
  ['replies', 'A sign-in is answered by the person signing in, never by a reply, so replies has nothing to read'],
  ['reply', 'A sign-in is answered by the person signing in, never by a reply, so reply has nothing to read'],
];

const outputIsFixed =
  'A sign-in function answers { "signed_in": true } once the person is signed in, so it takes no output.schema of its own';

const failingAsksNobody = 'A sign-in function with if_signed_out: fail asks nobody';

const failingSendsNothing = `${failingAsksNobody} and sends no message: leave the body after the front matter empty`;

type Reading = DocumentReading & { readonly parts: DocumentParts; readonly inputSchema: Schema.JsonObject | undefined };

function isSite(site: string): boolean {
  return site.length <= mostSiteBytes && hostName.test(site);
}

function siteIssues({ server, site }: WrittenSignIn, lines: SourceLines): readonly DocumentIssue[] {
  return [
    ...nameIssues(lines, [[placeOf('sign_in', 'server'), server]], isServerName, serverNameShape),
    ...(isSite(site) ? [] : [issueAt(lines, placeOf('sign_in', 'site'), siteWords)]),
  ];
}

function refusedKeyIssues(written: InteractionFrontMatter, lines: SourceLines): readonly DocumentIssue[] {
  const refused = refusedBesideSignIn
    .filter(([key]) => written[key] !== undefined)
    .map(([key, detail]) => issueAt(lines, `/${key}`, detail));
  return written.output?.schema === undefined
    ? refused
    : [...refused, issueAt(lines, placeOf('output', 'schema'), outputIsFixed)];
}

function bodyIsWritten({ body }: DocumentParts): boolean {
  return body.trim() !== '';
}

function failing(written: InteractionFrontMatter, { lines, parts }: Reading): Checked<WhenSignedOut> {
  const keys = (['expires', 'deliver'] as const)
    .filter((key) => written[key] !== undefined)
    .map((key) => issueAt(lines, `/${key}`, `${failingAsksNobody}, so it takes no ${key}`));
  const issues = bodyIsWritten(parts)
    ? [...keys, { line: parts.bodyLine, pointer: '', detail: failingSendsNothing }]
    : keys;
  return issues.length > 0 ? Result.fail(issues) : Result.succeed({ answer: 'fail' });
}

function unsaid(question: SignInQuestion, lines: SourceLines): WhenSignedOut {
  const pointer = question === 'if_signed_out' ? placeOf('sign_in', question) : `/${question}`;
  return { answer: 'unsaid', question, line: issueAt(lines, pointer, '').line };
}

interface WrittenExpiry {
  readonly expires: string;
  readonly expiresMs: number;
}

function expiryIn({ expires }: InteractionFrontMatter, lines: SourceLines): Checked<WrittenExpiry | null> {
  return expires === undefined
    ? Result.succeed(null)
    : Result.map(expiresOf(expires, lines), (expiresMs) => ({ expires, expiresMs }));
}

function wayIn(written: InteractionFrontMatter, reading: Reading): Checked<WrittenWay> {
  return routeIn(Struct.omit(written, ['replies']), reading, reading.inputSchema);
}

interface Asking {
  readonly expiry: WrittenExpiry | null;
  readonly way: WrittenWay;
  readonly message: ParsedTemplate;
}

function askingOf({ expiry, way, message }: Asking, lines: SourceLines): WhenSignedOut {
  if (way === null) {
    return unsaid('deliver', lines);
  }
  if (expiry === null) {
    return unsaid('expires', lines);
  }
  const { route } = wayOf(way, lines);
  return { answer: 'ask', asking: { ...expiry, message, ...(route === undefined ? {} : { route }) } };
}

function asking(written: InteractionFrontMatter, reading: Reading): Checked<WhenSignedOut> {
  const parts = {
    expiry: expiryIn(written, reading.lines),
    way: wayIn(written, reading),
    message: messageOf(reading.parts, reading.inputSchema),
  };
  const issues = [...issuesOf(() => parts.expiry), ...issuesOf(() => parts.way), ...issuesOf(() => parts.message)];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.map(Result.all(parts), (done) => askingOf(done, reading.lines));
}

function unanswered(written: InteractionFrontMatter, reading: Reading): Checked<WhenSignedOut> {
  const issues = [
    ...issuesOf(() => expiryIn(written, reading.lines)),
    ...issuesOf(() => wayIn(written, reading)),
    ...(bodyIsWritten(reading.parts) ? issuesOf(() => messageOf(reading.parts, reading.inputSchema)) : []),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(unsaid('if_signed_out', reading.lines));
}

function whenSignedOutOf(
  written: InteractionFrontMatter,
  answer: WrittenSignIn['if_signed_out'],
  reading: Reading,
): Checked<WhenSignedOut> {
  if (answer === undefined) {
    return unanswered(written, reading);
  }
  return answer === 'fail' ? failing(written, reading) : asking(written, reading);
}

export function signInFrom(
  written: InteractionFrontMatter,
  signIn: WrittenSignIn,
  reading: DocumentReading,
  parts: DocumentParts,
): Checked<SignInDocument> {
  const { lines } = reading;
  const input = contractOf(written.input, 'input', lines);
  const inputSchema = Result.isSuccess(input) ? input.success.schema?.document : undefined;
  const whenSignedOut = whenSignedOutOf(written, signIn.if_signed_out, { ...reading, parts, inputSchema });
  const issues = [
    ...refusedKeyIssues(written, lines),
    ...siteIssues(signIn, lines),
    ...issuesOf(() => input),
    ...issuesOf(() => whenSignedOut),
  ];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.map(Result.all({ input, whenSignedOut }), (done) => ({
        shape: 'sign_in',
        ...(written.description === undefined ? {} : { description: written.description }),
        signIn: { server: signIn.server, site: signIn.site },
        input: done.input,
        whenSignedOut: done.whenSignedOut,
        output: { schema: compiledSignedIn },
      }));
}
