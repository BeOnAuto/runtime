import { actingAsIn, instructionsActingAs } from '@on.auto/api';
import {
  directoryCallsOf,
  instructionsToldTo,
  MOST_TOOL_CALL_MS,
  NOT_LISTED,
  racedWith,
  turnOf,
  type ConversationMessage,
  type TurnEnded,
  type Waits,
} from '@on.auto/chat';
import { signedInPersonOf } from '@on.auto/identity';
import type { ChatRendering } from '@on.auto/interaction';
import { defaultOrg } from '@on.auto/openid-connect';
import { allPermissions, InAConversation, randomUUIDv7 } from '@on.auto/operations';
import { Context } from 'effect';

import type { InProcessDirectory } from './in-process-directory.ts';
import type { ChosenModel } from './turn-model.ts';

export interface AskedOfTheTools {
  readonly person: string;
  readonly autoNotNamed: boolean;
  readonly messages: readonly ConversationMessage[];
}

export interface ToolParts {
  readonly render: Pick<ChatRendering, 'instructions'>;
  readonly chosen: ChosenModel;
  readonly directory: InProcessDirectory;
  readonly directoryUrl: string;
  readonly holdsARole: (person: string) => Promise<boolean>;
  readonly now: () => number;
  readonly waits: Waits;
  readonly signal: Readonly<AbortSignal>;
}

const inAConversation = Context.add(Context.empty(), InAConversation, true);

function personOf(person: string) {
  return signedInPersonOf({ subject: person, name: person, org: defaultOrg, permissions: allPermissions });
}

export function endedBy(asked: AskedOfTheTools, parts: ToolParts): Promise<TurnEnded<never>> {
  const principal = personOf(asked.person);
  const { signal } = parts;
  return parts.directory.asking(principal, inAConversation, async (send) => {
    const tools = directoryCallsOf(parts.directoryUrl, send);
    const listed = await racedWith(tools.tools(signal), MOST_TOOL_CALL_MS, { waits: parts.waits, signal });
    if (!('settled' in listed)) {
      throw new Error(NOT_LISTED);
    }
    const offered = listed.settled;
    const acting = instructionsActingAs(actingAsIn(principal, principal.own, defaultOrg), 'directory', {
      orgTools: offered.map(({ name }) => name),
      playbookTools: [],
    });
    return turnOf<never>({
      id: randomUUIDv7(),
      instructions: instructionsToldTo(acting, {
        surfaceLines: parts.render.instructions,
        autoNotNamed: asked.autoNotNamed,
      }),
      messages: asked.messages,
      model: parts.chosen.model,
      offered,
      tools,
      admitted: () => parts.holdsARole(asked.person),
      now: parts.now,
      closed: () => signal.aborted,
      signal,
      waits: parts.waits,
      bounds: parts.chosen.bounds,
    });
  });
}
