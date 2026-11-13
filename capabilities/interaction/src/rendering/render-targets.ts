import { standardComponentDefinitions } from '@json-render/chat';
import type { Result } from 'effect';

import type { RenderedMessage, RenderState } from './rendered-message.ts';
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

interface RenderTarget {
  readonly components: Readonly<Record<string, ComponentDefinition>>;
  readonly interactive: Readonly<Record<string, string>>;
  readonly render: (card: unknown, state: RenderState) => Result.Result<RenderedMessage, readonly string[]>;
}

const renderTargets = {
  slack: {
    components: standardComponentDefinitions,
    interactive: {
      Button:
        'A click is not taken as an answer, so remove the Button; to send the reader somewhere, write a LinkButton with a label and a url',
    },
    render: slackMessageOf,
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
