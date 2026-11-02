import { listComments } from '../comments/list-comments.ts';
import { makeComment } from '../comments/make-comment.ts';
import { resolveComment } from '../comments/resolve-comment.ts';

export const commentOperations = [makeComment, listComments, resolveComment];
