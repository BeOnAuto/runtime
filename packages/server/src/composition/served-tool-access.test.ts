import { defaultTiming, ToolServerDocumentRefused, type ToolAccess } from '@on.auto/tool-servers';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { Cause, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolAccessOf } from './served-tool-access.ts';

const noServers = { toolServers: { servers: [], referencedVariables: [] } };

const scope = { org: 'acme', playbook: 'alpha' };

function countedComposing(): { readonly asked: () => number; readonly composing: Effect.Effect<ToolAccess> } {
  const counts = { asked: 0 };
  return {
    asked: () => counts.asked,
    composing: Effect.sync(() => {
      counts.asked += 1;
      return noToolServers;
    }),
  };
}

describe('the tool access a server makes at start', () => {
  it('asks for the composed access only when one of its ways is used, and closes nothing of it', async () => {
    const { asked, composing } = countedComposing();
    const tools = toolAccessOf(composing, noServers, { takesConnections: false });
    const beforeUse = asked();

    const listed = await Effect.runPromise(tools.listServers(scope));
    await tools.close();

    expect({ beforeUse, listed, afterUse: asked() }).toEqual({ beforeUse: 0, listed: [], afterUse: 1 });
  });

  it('says it is configured as the composed access will, from the servers it names and the connections it takes', () => {
    const { composing } = countedComposing();

    expect(
      [
        toolAccessOf(composing, noServers, { takesConnections: false }),
        toolAccessOf(composing, noServers, { takesConnections: true }),
      ].map(({ configured, takesConnections }) => ({ configured, takesConnections })),
    ).toEqual([
      { configured: false, takesConnections: false },
      { configured: true, takesConnections: true },
    ]);
  });

  it('bounds a call as its timing does, the default unless one is given, without composing anything', () => {
    const { asked, composing } = countedComposing();

    expect([
      toolAccessOf(composing, noServers, { takesConnections: false }).callMs,
      toolAccessOf(composing, noServers, { takesConnections: false }, { ...defaultTiming, callMs: 5000 }).callMs,
      asked(),
    ]).toEqual([defaultTiming.callMs, 5000, 0]);
  });

  it('fails a way used with the refusal of a composition that fails, as a defect', async () => {
    const refusal = new ToolServerDocumentRefused({
      message: 'The documents of the tool servers could not be read.',
      problems: [],
    });
    const tools = toolAccessOf(Effect.fail(refusal), noServers, { takesConnections: false });

    const cause = await Effect.runPromise(Effect.flip(Effect.sandbox(tools.listServers(scope))));

    expect([Cause.hasDies(cause), Cause.squash(cause)]).toEqual([true, refusal]);
  });
});
