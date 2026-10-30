import type { Issue } from '@on.auto/operations';
import { headersTheRuntimeSets } from '@on.auto/tool-servers';

import type { ConnectionEntry, ConnectionType } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';

function issue(pointer: string, detail: string): readonly Issue[] {
  return [{ pointer, detail }];
}

function among(names: Iterable<string>, name: string | undefined): boolean {
  return [...names].some((given) => given.toLowerCase() === name?.toLowerCase());
}

function sentAlready(names: Readonly<Record<string, string>> | undefined, name: string | undefined): boolean {
  return among(Object.keys(names ?? {}), name);
}

function headerIssuesOf(name: string | undefined, type: ConnectionType, entry: ConnectionEntry): readonly Issue[] {
  const reserved = headersTheRuntimeSets(type);
  if (among(reserved.names, name)) {
    return issue('/credential/name', `A header ${reserved.setBy} sets itself, so the credential cannot go in it`);
  }
  return sentAlready(entry.headers, name)
    ? issue('/credential/name', 'The entry sends this header already, so the credential cannot go in it')
    : [];
}

export function credentialIssuesOf(
  credential: Credential,
  type: ConnectionType,
  entry: ConnectionEntry,
): readonly Issue[] {
  if (credential.in === 'header') {
    return headerIssuesOf(credential.name, type, entry);
  }
  if (credential.in !== undefined && type === 'mcp') {
    return issue(
      '/credential/in',
      'Expected header for an mcp connection: a query parameter or a security scheme is an HTTP API’s',
    );
  }
  return credential.in === 'query' && sentAlready(entry.query_params, credential.name)
    ? issue('/credential/name', 'The entry sends this query parameter already, so the credential cannot go in it')
    : [];
}
