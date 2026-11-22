import type { GuideVariables } from '@on.auto/definitions';
import { marked } from 'marked';

import { forTheAgent } from './agent-rendition.ts';

export interface GuidePages {
  readonly forTheAgent: (path: string, written: string, variables: GuideVariables) => string;
  readonly asHtml: (markdown: string) => string;
}

export const renderedGuidePages: GuidePages = {
  forTheAgent,
  asHtml: (markdown) => marked.parse(markdown, { async: false }),
};
