import { Caller, PlaybookContext, PlaybookLifecycle, defineQuery, type Permission } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import { isReadOnly } from '../bounds/tool-results.ts';
import { ArgumentsField, ServerField, ToolField } from '../names/tool-fields.ts';
import { checkedArguments, uncheckable, type ArgumentCheck } from './argument-checks.ts';
import { DryRunSchema, type DryRun } from './dry-run-schema.ts';
import { seenOn, type Seen } from './dry-run-seen.ts';
import type { ToolLookup } from './named-tool.ts';
import { dryRunWords, readingTask, toolRead } from './read-words.ts';
import { toolRemedies, unavailableOf } from './tool-refusals.ts';

const description = [
  'Answers what execute would check for one tool and its arguments, without calling the tool: whether the caller may execute, whether the playbook is retired, whether whoever runs this server allows the tool, whether it only reads, whether the arguments match its input schema and whether its server can be reached just now.',
  'Use it before execute when a call may change something, or when the arguments are unsure.',
  'Nothing is sent to the tool and nothing is recorded.',
  '`server` and `tool` name the tool as search lists it, and `arguments`, when given, are the object to check.',
].join(' ');

const DryRunInputSchema = Schema.Struct({
  server: ServerField,
  tool: ToolField,
  arguments: Schema.optionalKey(ArgumentsField),
});

const executeNeeds = 'playbook:write' satisfies Permission;

function argumentsOf(seen: Seen, input: Schema.JsonObject | undefined): ArgumentCheck | null {
  if (input === undefined) {
    return null;
  }
  return 'tool' in seen ? checkedArguments(seen.tool.input_schema, input) : uncheckable(seen.unseen);
}

function readOnlyOf(seen: Seen): boolean | null {
  return 'tool' in seen ? isReadOnly(seen.tool.annotations) : null;
}

export function defineDryRun(access: ToolLookup) {
  return defineQuery('playbook', {
    name: 'dry_run',
    title: 'Dry run a tool call',
    description,
    route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/dry-run' },
    reachesOutside: true,
    inputSchema: DryRunInputSchema,
    outputSchema: DryRunSchema,
    reasons: ['unavailable'],
    handle: Effect.fnUntraced(function* ({ server, tool, arguments: input }) {
      const address = yield* PlaybookContext;
      const { naming, listed: listing } = yield* access.lookUp(address, { server, tool });
      if (Result.isFailure(naming) && naming.failure.because !== 'tool_not_allowed') {
        return yield* Effect.fail(unavailableOf(naming.failure));
      }
      const allowed = Result.isSuccess(naming);
      const listed = yield* listing;
      const seen = yield* seenOn(listed, { server, tool }, allowed);
      const callerMay = (yield* Caller).permissions.includes(executeNeeds);
      const retired = (yield* PlaybookLifecycle).status === 'retired';
      const answer: DryRun = {
        would_run: callerMay && !retired && allowed && seen.server.reachable === 'yes',
        needs: executeNeeds,
        caller_may: callerMay,
        playbook_retired: retired,
        allowed,
        read_only: readOnlyOf(seen),
        arguments: argumentsOf(seen, input),
        server: seen.server,
      };
      return answer;
    }),
    plainLanguage: {
      task: readingTask.dry_run,
      attempt: (asked) => toolRead('dry run', asked),
      outcome: (answer, asked) => dryRunWords(answer, asked),
      remedies: toolRemedies,
    },
  });
}
