import type { CallsEndedBecause } from '../access/tool-server-failed.ts';
import { callsEnded, noCalls } from '../bounds/call-bounds.ts';
import { isReadOnly } from '../bounds/tool-results.ts';
import { modelFacingNames } from '../names/model-facing-names.ts';
import { toolsInWords } from '../names/tool-words.ts';
import { offeredToolOf, type OfferedTool } from './offered-tools.ts';
import { argumentsDigestOf, scrubbedJsonOf } from './recorded-calls.ts';
import type { OfferedOnServer, RunState, RunToolsParts } from './run-parts.ts';

export interface ToolsEnding {
  readonly because: CallsEndedBecause;
}

export interface RunTools {
  readonly offered: readonly OfferedTool[];
  readonly keepsContent: boolean;
  readonly argumentsDigest: (input: unknown) => string;
  readonly scrubJson: (json: string) => string;
  readonly callsEnded: () => boolean;
  readonly ended: Readonly<AbortSignal>;
  readonly ending: () => ToolsEnding | undefined;
  readonly calledAny: () => boolean;
  readonly calledOnlyReadOnly: () => boolean;
  readonly usedInWords: () => string;
  readonly answeredBytes: () => number;
  readonly close: () => Promise<void>;
}

export function runTools(parts: RunToolsParts): RunTools {
  let tally = noCalls;
  let ending: ToolsEnding | undefined;
  let answeredBytes = 0;
  const used: OfferedOnServer[] = [];
  const stop = new AbortController();
  const state: RunState = {
    tally: () => tally,
    tallied: (next) => {
      tally = next;
    },
    used: (offer) => {
      used.push(offer);
    },
    ended: (because) => {
      ending ??= { because };
      stop.abort();
    },
    answered: (bytes) => {
      answeredBytes += bytes;
    },
  };
  const offered = modelFacingNames(parts.offered).map((tool) => offeredToolOf(parts, state, tool));
  return {
    offered,
    keepsContent: parts.offered.every(({ slot }) => slot.settings.record_content),
    argumentsDigest: (input) => argumentsDigestOf(input, parts.secrets),
    scrubJson: (json) => scrubbedJsonOf(json, parts),
    callsEnded: () => callsEnded(tally),
    ended: stop.signal,
    ending: () => ending,
    calledAny: () => used.length > 0,
    calledOnlyReadOnly: () => used.every(({ tool }) => isReadOnly(tool.annotations)),
    usedInWords: () => toolsInWords(used.map(({ reference }) => reference)),
    answeredBytes: () => answeredBytes,
    close: async () => {
      await Promise.all(parts.slots.map((slot) => slot.release()));
    },
  };
}
