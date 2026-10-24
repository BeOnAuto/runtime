import type { OperationKind } from '../caller/operation-scope.ts';
import type { Cancelled, Failed, Rejected, RejectionReason } from '../outcome/outcome.ts';
import type { RejectionBecause } from '../outcome/rejection-because.ts';
import type { RejectionKind } from '../outcome/rejection.ts';
import { connectionBecauses, connectionExplanations, connectionRemedies } from './connection-explanations.ts';
import type { Explanation, Remedies } from './plain-language.ts';
import { predictionExplanations } from './prediction-explanations.ts';

export type ExplainedRejection = Pick<Rejected, 'reason' | 'kind' | 'because'>;

const correctable = 'This can be corrected and tried again; the details below say what to change.';

const explanationByReason: Readonly<Record<RejectionReason, Explanation>> = {
  invalid_input: { why: 'what was given does not fit what it needs', remedy: correctable },
  unavailable: {
    why: 'something the server relies on is not available right now',
    remedy: [
      'Only whoever runs the server can put this right, so there is nothing to change on your side;',
      'once they have, it can be tried again. Meanwhile, everything that does not need it still works.',
    ].join(' '),
  },
  not_found: {
    why: 'it, or something it refers to, could not be found',
    remedy: 'Check the names used; the details below say what is missing.',
  },
  forbidden: {
    why: 'this connection is not allowed to do that',
    remedy: 'Whoever set up this connection can allow it.',
  },
  conflict: {
    why: 'it clashes with something already there',
    remedy: 'The details below say what is in the way.',
  },
  cancelled: {
    why: 'it was cancelled before it finished',
    remedy: 'Nothing more of it runs; start a new run if it is still needed.',
    mayHaveChanged: true,
  },
  unanswered: {
    why: 'nobody answered what it asked',
    remedy: 'Nothing more of it runs; asking again is a new run, which can be started if an answer is still needed.',
    mayHaveChanged: true,
  },
};

const ranUntilCancelled =
  'Nothing more of it runs, but what it did before may have changed something; start a new run if it is still needed.';

const explanationByKind: Readonly<Record<RejectionKind, Explanation>> = {
  input_schema: explanationByReason.invalid_input,
  taken: { why: 'that name is already taken', remedy: 'A different name will work.' },
  retired: {
    why: 'it has been retired',
    remedy: 'What is retired stays retired; a new one can be made under another name.',
  },
  concurrent_change: { why: 'something else changed it at the same moment', remedy: 'Trying again should work.' },
  unworkable: { why: 'it cannot work as it is written', remedy: correctable },
  stalled: {
    why: 'what it keeps of the playbook’s history stopped at a recorded event it could not take in',
    remedy:
      'It answers again once a corrected version is saved, which builds it anew from the history; the details below say which event stopped it and why.',
  },
  rebuilding: {
    why: 'what it keeps of the playbook’s history is still being built from that history',
    remedy: 'Nothing needs to change: trying again in a little while should work.',
  },
  tools_called: {
    why: 'this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something',
    remedy:
      'So it was not run again: start a new run instead, after checking what its history shows it has called so far.',
    mayHaveChanged: true,
  },
  effect_unknown: {
    why: 'it could not finish after calling a tool that may change something, so whether that happened is not known',
    remedy:
      'It is not run again by itself: a person decides, or a workflow rule that names this kind; its history shows the call.',
    mayHaveChanged: true,
  },
  model_not_offered: {
    why: 'this server does not offer the model named',
    remedy:
      'This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.',
  },
  tool_not_offered: {
    why: 'this server does not offer a tool it names',
    remedy:
      'This can be put right on your side: whoever runs the server decides which tool servers and tools this playbook may use, which search shows, so once it names only those, it can be tried again.',
  },
  tool_server_failed: {
    why: 'a tool server it needs could not be used',
    remedy:
      'Nothing was called through it, so it can be tried again later; if it keeps happening, whoever runs the server can look into that tool server.',
  },
  oversized: {
    why: 'its result is larger than a run may record',
    remedy:
      'This can be put right on your side: once its result keeps only what is needed, such as fewer or smaller values, it can be run again.',
  },
  ...predictionExplanations,
  ...connectionExplanations,
  requested: {
    why: 'it was cancelled at the request of someone allowed to change the playbook',
    remedy: ranUntilCancelled,
    mayHaveChanged: true,
  },
  deadline: {
    why: 'the step that waited for it ran out of time, so it was cancelled',
    remedy:
      'Nothing more of it runs, but what it did before may have changed something; the step that waited for it decides what happens next.',
    mayHaveChanged: true,
  },
  overrun: {
    why: 'it ran for as long as a workflow may run, so it was stopped',
    remedy:
      'Whoever runs the server decides how long a workflow may run; what it did before may have changed something, so check before starting a new run.',
    mayHaveChanged: true,
  },
  parent_ended: {
    why: 'the run that waited for it ended first, so it was cancelled',
    remedy: 'Nothing more of it runs, since only that run needed it; what it did before may have changed something.',
    mayHaveChanged: true,
  },
  expired: {
    why: 'nobody answered what it asked before the request expired',
    remedy:
      'Nothing more of it runs, though the request may have reached someone; asking again is a new run, which can be started, with more time if needed.',
    mayHaveChanged: true,
  },
  undelivered: {
    why: 'what it had to send could not be delivered, though every attempt was made',
    remedy:
      'Nothing more of it runs; whoever runs the server can look into the tool it names, and then a new run can send it again.',
    mayHaveChanged: true,
  },
  requests_full: {
    why: 'the playbook already holds as many open requests as it may',
    remedy: 'Once some of them are answered, expire or are cancelled, it can be tried again.',
  },
  tools_unfinished: {
    why: 'it called tools but could not finish',
    remedy:
      "Every tool it called only reads, by its server's own account, so running it again is safe: a new run, or a workflow's retry, may make it; its history shows what it called.",
  },
};

const explanationByBecause: Readonly<Record<RejectionBecause, string>> = {
  provider_not_configured: 'because its provider is not set up on this server, though others are',
  model_not_allowed: 'because it is not among the models whoever runs the server allows',
  tool_server_not_configured:
    'because whoever runs the server has not set up a tool server of that name for this playbook',
  tool_not_allowed: 'because it is not among the tools whoever runs the server allows',
  tool_not_listed: 'because the tool server it names does not have that tool',
  ...connectionBecauses,
  failing: 'because the tool server kept failing',
  rate_limited: 'because the tool server asked it to slow down for longer than a run waits',
  unreachable: 'because the tool server could not be reached in time',
  key_refused: 'because the tool server did not accept the key this server gives it',
  server_failed: 'because a tool server failed',
  tool_error: 'because the tool answered an error, which the details below give',
  model_unavailable: 'because the model stopped answering',
  definition_refused: 'because its definition was refused before its model could be called again',
  run_bound: 'because it ran out of time',
  no_answer: 'because the model kept calling tools instead of answering',
  restarted_without_content:
    'because the server restarted before it finished, and the playbook keeps no content of its calls to go on from',
  call_outcome_unknown:
    'because the server restarted while it called a tool that may change something, so whether that call did is not known',
  only_read: "because every tool it called only reads, by its server's own account",
  builds_of_the_day: 'because the function has had its builds of the day',
  stalled: 'because its dataset stopped at an event its fold could not take',
  not_finite: 'because the model answered something other than finite numbers',
  not_in_order: 'because the model answered a low above its likely value or a high below it',
  baseline_check: 'because the process that checks a build’s baselines ended before it answered',
};

const remedyByBecause: Remedies = {
  key_refused: 'Trying again will not help until whoever runs the server checks the key it gives that tool server.',
  ...connectionRemedies,
};

const explanationByKindAndBecause: Readonly<
  Partial<Record<RejectionKind, Partial<Record<RejectionBecause, Explanation>>>>
> = {
  builds_full: {
    builds_of_the_day: {
      why: 'the function has had its builds of the day',
      remedy: 'It can be asked again once a day has passed since the oldest of them; the details below say when.',
    },
  },
  dataset_not_ready: {
    stalled: {
      why: 'its dataset stopped at an event its fold could not take',
      remedy:
        'Trying again will not help: get_definition names the event and why, and a change of the data part folds a dataset of its own.',
    },
  },
  model_process_failed: {
    not_finite: {
      why: 'the model answered something other than finite numbers in the shape its signature gives',
      remedy: 'Trying again gives the same answer; a new build gives the function another model.',
    },
    not_in_order: {
      why: 'the model answered a low above its likely value or a high below it',
      remedy: 'Trying again gives the same answer; a new build gives the function another model.',
    },
    baseline_check: {
      why: 'the process that checks the build’s baselines ended before it answered',
      remedy: 'Nothing needs to change: asking for the build again starts a new process to check them.',
    },
  },
  tools_called: {
    only_read: {
      why: "an attempt of this run under the same id did not succeed, and every tool it called only reads, by its server's own account",
      remedy: 'So it was not run again under its id: start a new run instead; its history shows what it called.',
    },
  },
};

const noRemedies: Remedies = {};

const refusalByReason: Readonly<Record<RejectionReason, string>> = {
  invalid_input: 'refused its input',
  unavailable: 'was not available',
  not_found: 'could not be found',
  forbidden: 'was not allowed',
  conflict: 'could not go through',
  cancelled: 'was cancelled',
  unanswered: 'went unanswered',
};

const refusedForAnotherReason = 'did not go through';

function isRejectionReason(reason: string): reason is RejectionReason {
  return Object.hasOwn(refusalByReason, reason);
}

export function refusalInWords(reason: string): string {
  return isRejectionReason(reason) ? refusalByReason[reason] : refusedForAnotherReason;
}

export function explanationOf(
  { reason, kind, because }: ExplainedRejection,
  remedies: Remedies = noRemedies,
): Explanation {
  if (kind === undefined) {
    return explanationByReason[reason];
  }
  const explanation = explanationByKind[kind];
  const ofBoth = because === undefined ? undefined : explanationByKindAndBecause[kind]?.[because];
  if (ofBoth !== undefined) {
    return ofBoth;
  }
  return because === undefined
    ? explanation
    : {
        ...explanation,
        why: `${explanation.why}, ${explanationByBecause[because]}`,
        remedy: remedies[because] ?? remedyByBecause[because] ?? explanation.remedy,
      };
}

function rejectionWords(
  attempt: string,
  operationKind: OperationKind,
  rejection: Rejected,
  remedies: Remedies,
): string {
  const { why, remedy, mayHaveChanged } = explanationOf(rejection, remedies);
  const unchanged = operationKind === 'command' && mayHaveChanged === undefined ? ' Nothing was changed.' : '';
  return `Could not ${attempt}: ${why}.${unchanged} ${remedy}`;
}

function failureWords(attempt: string, { incident }: Failed): string {
  return [
    `Could not ${attempt}: something went wrong inside the server.`,
    'It was not caused by anything you did.',
    `If it happens again, whoever runs the server can look into it with this reference: ${incident}.`,
  ].join(' ');
}

function cancellationWords(attempt: string, kind: OperationKind): string {
  const next =
    kind === 'command'
      ? 'It may or may not have taken effect, so check before trying again.'
      : 'It can be tried again once the server is back.';
  return `Could not ${attempt}: the server stopped before it finished. ${next}`;
}

export function unsuccessfulWords(
  attempt: string,
  kind: OperationKind,
  outcome: Rejected | Failed | Cancelled,
  remedies: Remedies = noRemedies,
): string {
  if (outcome.status === 'rejected') {
    return rejectionWords(attempt, kind, outcome, remedies);
  }
  return outcome.status === 'failed' ? failureWords(attempt, outcome) : cancellationWords(attempt, kind);
}
