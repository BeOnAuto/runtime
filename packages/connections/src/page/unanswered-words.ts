import { callWordsOf, waitWordsOf, type ConsentCall } from '@on.auto/tool-servers';

export function unansweredWordsOf(lead: string, call: ConsentCall | undefined): string {
  return call === undefined
    ? `${lead}: a server it asks did not answer; try again in a moment`
    : `${lead}: ${callWordsOf(call)}; ${waitWordsOf(call)}`;
}
