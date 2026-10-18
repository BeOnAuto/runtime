import { Buffer } from 'node:buffer';

const mostIssuesShown = 5;

const mostIssueDetailBytes = 256;

const mostPointerBytes = 128;

export const mostDetailBytes = 1024;

export const mostDescriptionCharacters = 300;

export const mostNameBytes = 256;

export interface ShownIssue {
  readonly detail: string;
  readonly pointer: string;
}

function encodedBytesOf(character: string): number {
  return Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
}

export function cutAtCodePoint(text: string, mostBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += encodedBytesOf(character);
    if (bytes > mostBytes) {
      return text.slice(0, end);
    }
    end += character.length;
  }
  return text;
}

export function issuesShown(issues: readonly ShownIssue[]) {
  return {
    issue_count: issues.length,
    issues: issues.slice(0, mostIssuesShown).map(({ detail, pointer }) => ({
      detail: cutAtCodePoint(detail, mostIssueDetailBytes),
      pointer: cutAtCodePoint(pointer, mostPointerBytes),
    })),
  };
}
