import { Caller, InvalidInput, OrgContext, withStudioLink, type Issue } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { leadPageOf } from '../goals/goals-created.ts';
import { heldOn } from '../goals/held-goals.ts';
import type { CheckedGoals, PlaybookGoals } from '../goals/playbook-goals.ts';
import { playbookRegistered } from '../operations/create-playbook.ts';
import { foundPlaybook } from '../operations/registry-loading.ts';
import { takenBy } from '../registry/registry-decisions.ts';
import type {
  ImportedPackage,
  ImportPlanned,
  PlaybookImports,
  PlaybookImportsInItsObject,
} from './playbook-imports.ts';

export interface Importing {
  readonly playbook: string;
  readonly import_id: string;
  readonly title?: string;
  readonly package: ImportedPackage;
}

const refusedWords = 'The package cannot be imported as it is: the issues say what to change, and nothing was written';

const goalsRequired: Issue = {
  pointer: '/package/goals',
  detail: 'An import needs the goals of the playbook; a package without goals cannot be imported here',
};

function underThePackage({ issues }: Pick<InvalidInput, 'issues'>): readonly Issue[] {
  return issues.map(({ pointer, detail }) => ({ pointer: `/package${pointer}`, detail }));
}

function unlessTakenByAnother(playbook: string) {
  return Effect.gen(function* () {
    const existing = yield* Effect.result(foundPlaybook(playbook));
    if (Result.isSuccess(existing)) {
      yield* takenBy(existing.success);
    }
  });
}

function oursAfterTaken(playbook: string) {
  return Effect.gen(function* () {
    const existing = yield* Effect.orDie(foundPlaybook(playbook));
    const caller = yield* Caller;
    return existing.status === 'active' && existing.created_by.id === caller.id ? existing : yield* takenBy(existing);
  });
}

function goalsCheckedOf<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
  written: ImportedPackage,
  creating: { readonly playbook: string; readonly name: string },
) {
  return written.goals === undefined
    ? Effect.succeed(Result.fail<readonly Issue[]>([goalsRequired]))
    : Effect.map(Effect.result(goals.check(written.goals, creating)), Result.mapError(underThePackage));
}

export function playbookImported<Checked extends CheckedGoals, Plan extends ImportPlanned>(
  goals: PlaybookGoals<Checked>,
  imports: PlaybookImports<Plan>,
  { playbook, import_id: importId, title, package: written }: Importing,
) {
  return Effect.gen(function* () {
    const { org } = yield* OrgContext;
    const address = { org, playbook };
    const creating = { playbook, name: title ?? playbook };
    const checkedGoals = yield* goalsCheckedOf(goals, written, creating);
    const { issues, plan } = yield* imports.check(address, written);
    if (Result.isFailure(checkedGoals) || issues.length > 0) {
      const goalsIssues = Result.isFailure(checkedGoals) ? checkedGoals.failure : [];
      return yield* new InvalidInput({ detail: refusedWords, issues: [...goalsIssues, ...issues] });
    }
    const mark = { import_id: importId, digest: plan.digest };
    const { started, finished } = yield* imports.standing(address);
    if (started === undefined) {
      yield* unlessTakenByAnother(playbook);
    }
    yield* imports.start(address, mark);
    const lead = leadPageOf(playbook, checkedGoals.success);
    if (finished) {
      const made = yield* oursAfterTaken(playbook);
      const kept = yield* goals.read(address);
      return yield* withStudioLink({ ...heldOn(made, kept), models_not_offered: plan.modelsNotOffered }, lead);
    }
    const registered = yield* playbookRegistered(creating).pipe(
      Effect.catchTag('conflict', () => oursAfterTaken(playbook)),
    );
    const held = yield* goals.save(address, {
      ...(written.page === undefined ? {} : { page: written.page }),
      goals: checkedGoals.success,
      onlyIfNone: true,
    });
    yield* imports.copy(address, plan, mark);
    return yield* withStudioLink({ ...heldOn(registered, held), models_not_offered: plan.modelsNotOffered }, lead);
  });
}

export function playbookImportedInItsObject<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
  imports: PlaybookImportsInItsObject<Checked>,
  { playbook, import_id: importId, title, package: written }: Importing,
) {
  return Effect.gen(function* () {
    const { org } = yield* OrgContext;
    const address = { org, playbook };
    const creating = { playbook, name: title ?? playbook };
    const checkedGoals = yield* goalsCheckedOf(goals, written, creating);
    const existing = yield* Effect.result(foundPlaybook(playbook));
    const reserving = Result.isFailure(existing);
    if (reserving) {
      yield* imports.reserve(address, importId, written);
    }
    const answer = yield* imports.imported(address, {
      import_id: importId,
      package: written,
      ...(Result.isSuccess(checkedGoals) ? { goals: checkedGoals.success } : {}),
    });
    if ('taken' in answer) {
      return yield* takenBy(yield* Effect.orDie(foundPlaybook(playbook)));
    }
    if (Result.isFailure(checkedGoals) || 'issues' in answer) {
      if (reserving) {
        yield* imports.released(address, importId);
      }
      const goalsIssues = Result.isFailure(checkedGoals) ? checkedGoals.failure : [];
      const packageIssues = 'issues' in answer ? answer.issues : [];
      return yield* new InvalidInput({ detail: refusedWords, issues: [...goalsIssues, ...packageIssues] });
    }
    const registered = yield* playbookRegistered(creating).pipe(
      Effect.catchTag('conflict', () => oursAfterTaken(playbook)),
    );
    yield* imports.finished(address, importId);
    return yield* withStudioLink(
      { ...heldOn(registered, answer.held), models_not_offered: answer.modelsNotOffered },
      leadPageOf(playbook, checkedGoals.success),
    );
  });
}
