import { listComments, listCommentsInOrg } from '../comments/list-comments.ts';
import { makeComment, makeCommentInOrg } from '../comments/make-comment.ts';
import { reopenComment, reopenCommentInOrg } from '../comments/reopen-comment.ts';
import { resolveComment, resolveCommentInOrg } from '../comments/resolve-comment.ts';

export const commentOperations = [makeComment, listComments, resolveComment, reopenComment];

export const orgCommentOperations = [makeCommentInOrg, listCommentsInOrg, resolveCommentInOrg, reopenCommentInOrg];
