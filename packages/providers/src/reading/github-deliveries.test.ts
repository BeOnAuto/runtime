import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Option, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type Arrival,
  arrivalReadingOf,
  eventDestinationOf,
  presentedProofOf,
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
