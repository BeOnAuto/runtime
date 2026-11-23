import { standardComponentDefinitions } from '@json-render/chat';
import type { Result } from 'effect';

import type { ChatRendering } from './chat-rendering.ts';
import type { RenderedMessage, RenderState } from './rendered-message.ts';
import { slackCatalog, type CatalogEntry } from './slack-catalog.ts';
import { slackChat } from './slack-chat.ts';
import { slackExample } from './slack-example.ts';
import { slackLimitList, slackShows } from './slack-limits.ts';
import { slackMessageOf } from './slack-target.ts';

interface PropsParse {
  readonly success: boolean;
  readonly error?: {
    readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
  };
}

interface ComponentDefinition {
  readonly props: { readonly safeParse: (written: unknown) => PropsParse };
}

interface RenderLimit {
  readonly key: string;
  readonly most: number;
  readonly words: string;
}

interface RenderTarget {
  readonly label: string;
  readonly renderedAs: string;
  readonly components: Readonly<Record<string, ComponentDefinition>>;
  readonly catalog: Readonly<Record<string, CatalogEntry>>;
  readonly interactive: Readonly<Record<string, string>>;
  readonly limits: readonly RenderLimit[];
  readonly shows: string;
  readonly example: string;
  readonly render: (card: unknown, state: RenderState) => Result.Result<RenderedMessage, readonly string[]>;
  readonly chat: ChatRendering;
}

const renderTargets = {
  slack: {
    label: 'Slack',
    renderedAs: 'the list of Slack blocks',
    components: standardComponentDefinitions,
    catalog: slackCatalog,
    interactive: {
      Button:
        'A click is not taken as an answer, so remove the Button; to send the reader somewhere, write a LinkButton with a label and a url',
    },
    limits: slackLimitList,
    shows: slackShows,
    example: slackExample,
    render: slackMessageOf,
    chat: slackChat,
  },
} satisfies Record<string, RenderTarget>;

export type RenderTargetName = keyof typeof renderTargets;

export const renderTargetNames: readonly RenderTargetName[] = Object.keys(renderTargets).filter((name) =>
  isRenderTargetName(name),
);

export function isRenderTargetName(written: string): written is RenderTargetName {
  return Object.hasOwn(renderTargets, written);
}

export function renderTargetOf(name: RenderTargetName): RenderTarget {
  return renderTargets[name];
}

export function chatRenderingOf(name?: string): ChatRendering | undefined {
  return name !== undefined && isRenderTargetName(name) ? renderTargetOf(name).chat : undefined;
}
