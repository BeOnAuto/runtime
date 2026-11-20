import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Option, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type Arrival,
  arrivalReadingOf,
  eventDestinationOf,
  presentedProofOf,
  providerNamed,
  providersShippedRoots,
  readProviders,
} from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const githubsWebhook = Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(shipped, 'github', 'webhook')));

const hookId = '480932108';

function aDeliveryOfGitHub(event: string, body: Schema.Json): Arrival {
  return {
    transport: 'request',
    headers: {
      'X-GitHub-Event': event,
      'X-GitHub-Hook-ID': hookId,
      'X-GitHub-Delivery': '72d3162e-cc78-11e3-81ab-4c9367dc0958',
      'X-Hub-Signature-256': 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    },
    query: {},
    body,
  };
}

const anIssue = { number: 1347 };

describe("a delivery GitHub's webhook sends", () => {
  it('makes a read due where it is a new comment or a review, naming the webhook and no conversation', () => {
    const answers = [
      aDeliveryOfGitHub('issue_comment', { action: 'created', issue: anIssue, comment: { id: 1 } }),
      aDeliveryOfGitHub('pull_request_review', { action: 'submitted', pull_request: anIssue, review: { id: 2 } }),
      aDeliveryOfGitHub('pull_request_review_comment', {
        action: 'created',
        pull_request: anIssue,
        comment: { id: 3 },
      }),
    ];

    expect(answers.map((arrival) => arrivalReadingOf(githubsWebhook, arrival))).toEqual([
      { wake: { subscription: hookId } },
      { wake: { subscription: hookId } },
      { wake: { subscription: hookId } },
    ]);
  });

  it('makes nothing due where it is the ping that follows its making, an edit, a deletion or an event no answer is', () => {
    const passedOver = [
      aDeliveryOfGitHub('ping', { zen: 'Design for failure.', hook_id: Number(hookId) }),
      aDeliveryOfGitHub('issue_comment', { action: 'edited', issue: anIssue, comment: { id: 1 } }),
      aDeliveryOfGitHub('issue_comment', { action: 'deleted', issue: anIssue, comment: { id: 1 } }),
      aDeliveryOfGitHub('pull_request_review', { action: 'dismissed', pull_request: anIssue, review: { id: 2 } }),
      aDeliveryOfGitHub('issues', { action: 'created', issue: anIssue }),
    ];

    expect(passedOver.map((arrival) => arrivalReadingOf(githubsWebhook, arrival))).toEqual([{}, {}, {}, {}, {}]);
  });

  it('presents as its proof the signature of its header, the body alone signed, with no time and no id', () => {
    const presented = presentedProofOf(githubsWebhook, aDeliveryOfGitHub('ping', {}));

    expect(presented).toEqual({
      signature: 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    });
    expect(githubsWebhook.verify).toMatchObject({ secret: 'subscription', signed_payload: '{payload}' });
  });
});

const theRepository = { id: 1_296_269, node_id: 'R_kgDOABCDEF', full_name: 'octo-org/hello-world' };

const theAuthor = { login: 'octocat', id: 1, node_id: 'U_kgDOAAAAAQ', type: 'User' };

const anOpenedIssue = {
  id: 1_347_000_001,
  node_id: 'I_kwDOABCDEF5A1b2c',
  number: 1347,
  title: 'Found a bug',
  body: "I'm having a problem with this.",
  user: theAuthor,
  html_url: 'https://github.com/octo-org/hello-world/issues/1347',
  created_at: '2026-11-20T09:00:00Z',
  performed_via_github_app: null,
};

const aComment = {
  id: 2_002,
  node_id: 'IC_kwDOABCDEF5x9y8z',
  body: 'Me too',
  user: theAuthor,
  html_url: 'https://github.com/octo-org/hello-world/issues/1347#issuecomment-2002',
  created_at: '2026-11-20T09:15:00Z',
};

const aPullRequest = {
  id: 1_934,
  node_id: 'PR_kwDOABCDEF5Q7r6s',
  number: 1348,
  title: 'Fix the bug',
  body: 'Closes #1347',
  user: theAuthor,
  html_url: 'https://github.com/octo-org/hello-world/pull/1348',
  created_at: '2026-11-20T09:20:00Z',
  closed_at: null,
  merged: false,
};

const aClosedPullRequest = { ...aPullRequest, closed_at: '2026-11-20T09:30:00Z', merged: true };

function readOf(event: string, body: Readonly<Record<string, Schema.Json>>) {
  return arrivalReadingOf(githubsWebhook, aDeliveryOfGitHub(event, { ...body, repository: theRepository }));
}

const inTheRepository = { subject: 'octo-org/hello-world' };

const anIssueOpened = {
  type: 'com.github.issues.opened',
  id: 'I_kwDOABCDEF5A1b2c',
  time: '2026-11-20T09:00:00Z',
  ...inTheRepository,
  data: {
    number: 1347,
    title: 'Found a bug',
    body: "I'm having a problem with this.",
    author: 'octocat',
    html_url: 'https://github.com/octo-org/hello-world/issues/1347',
  },
};

const aCommentAdded = {
  type: 'com.github.issue_comment.created',
  id: 'I_kwDOABCDEF5A1b2c/IC_kwDOABCDEF5x9y8z',
  time: '2026-11-20T09:15:00Z',
  ...inTheRepository,
  data: {
    number: 1347,
    title: 'Found a bug',
    body: 'Me too',
    author: 'octocat',
    html_url: 'https://github.com/octo-org/hello-world/issues/1347#issuecomment-2002',
  },
};

const aPullRequestClosed = {
  type: 'com.github.pull_request.closed',
  id: 'PR_kwDOABCDEF5Q7r6s/2026-11-20T09%3A30%3A00Z',
  time: '2026-11-20T09:30:00Z',
  ...inTheRepository,
  data: {
    number: 1348,
    title: 'Fix the bug',
    author: 'octocat',
    html_url: 'https://github.com/octo-org/hello-world/pull/1348',
    merged: true,
  },
};

const reported = [
  'com.github.issues.opened',
  'com.github.issue_comment.created',
  'com.github.pull_request.opened',
  'com.github.pull_request.closed',
];

describe('the event a delivery GitHub’s webhook sends is', () => {
  it('a new issue, a new comment, a new pull request or a closed one, in the repository it happened in', () => {
    expect([
      readOf('issues', { action: 'opened', issue: anOpenedIssue, sender: theAuthor }),
      readOf('issue_comment', { action: 'created', issue: anOpenedIssue, comment: aComment }),
      readOf('pull_request', { action: 'opened', number: 1348, pull_request: aPullRequest }).event,
      readOf('pull_request', { action: 'closed', number: 1348, pull_request: aClosedPullRequest }),
    ]).toEqual([
      { event: anIssueOpened },
      { wake: { subscription: hookId }, event: aCommentAdded },
      expect.objectContaining({ type: 'com.github.pull_request.opened', id: 'PR_kwDOABCDEF5Q7r6s' }),
      { event: aPullRequestClosed },
    ]);
  });

  it('one of the types GitHub’s entry declares, each a trigger names a repository for, which the topic is written from', () => {
    const events = Result.getOrThrow(providerNamed(shipped, 'github')).entry.events;

    expect(events?.types?.map(({ type, subject }) => [type, subject?.required])).toEqual(
      reported.map((type) => [type, true]),
    );
    expect(
      events?.destinations.flatMap(({ events: mapped = [] }) => mapped.map(({ type, topic }) => [type, topic])),
    ).toEqual(reported.map((type) => [type, '{{ subject }}']));
  });

  it('marked automatic where an app did it, whose account GitHub types Bot', () => {
    const anApp = { ...theAuthor, login: 'octo-app[bot]', type: 'Bot' };
    const comment = { action: 'created', issue: anOpenedIssue, comment: aComment };

    expect([
      readOf('issue_comment', { ...comment, sender: anApp }).event?.automatic,
      readOf('pull_request', { action: 'opened', pull_request: aPullRequest, sender: anApp }).event?.automatic,
      readOf('issue_comment', { ...comment, sender: theAuthor }).event?.automatic,
    ]).toEqual([true, true, undefined]);
  });

  it('none for an edit, a review’s comment, the ping, a reopening, or an issue closed', () => {
    const passedOver = [
      readOf('issue_comment', { action: 'edited', issue: anOpenedIssue, comment: aComment }),
      readOf('pull_request_review_comment', { action: 'created', pull_request: aPullRequest, comment: aComment }),
      readOf('ping', { zen: 'Design for failure.', hook_id: Number(hookId) }),
      readOf('pull_request', { action: 'reopened', number: 1348, pull_request: aPullRequest }),
      readOf('issues', { action: 'closed', issue: { ...anOpenedIssue, closed_at: '2026-11-20T10:00:00Z' } }),
    ];

    expect(passedOver).toEqual([{}, { wake: { subscription: hookId } }, {}, {}, {}]);
  });
});
