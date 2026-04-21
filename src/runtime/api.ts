import type {
  AuthUser,
  CommentCountsResponse,
  CommentNode,
  CommentRecord,
  CommentTarget,
  CommentsResponse,
  RuntimeCommentOptions,
  SelectionMeta,
} from './types';

function parseSelectionMeta(input: unknown): SelectionMeta | null {
  if (!input) {
    return null;
  }

  const value =
    typeof input === 'string'
      ? (() => {
          try {
            return JSON.parse(input);
          } catch {
            return null;
          }
        })()
      : input;

  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { segments?: unknown[] }).segments)
  ) {
    return value as SelectionMeta;
  }

  return null;
}

function normalizeCommentRecord(record: CommentRecord): CommentRecord {
  return {
    ...record,
    selectionMeta: parseSelectionMeta((record as CommentRecord & { selectionMeta?: unknown }).selectionMeta),
  };
}

function normalizeCommentsResponse(response: CommentsResponse): CommentsResponse {
  return {
    ...response,
    items: response.items.map(normalizeCommentRecord),
  };
}

function normalizeCommentCountsResponse(
  response: CommentCountsResponse,
): CommentCountsResponse {
  return {
    ...response,
    blocks: response.blocks.map(item => ({
      ...item,
      selectionMeta: parseSelectionMeta(
        (item as CommentCountsResponse['blocks'][number] & { selectionMeta?: unknown }).selectionMeta,
      ),
    })),
  };
}

function buildQuery(
  target: CommentTarget,
  page: number,
  pageSize: number,
): URLSearchParams {
  const params = new URLSearchParams({
    pagePath: target.pagePath,
    page: String(page),
    pageSize: String(pageSize),
  });

  if (target.blockId) {
    params.set('blockId', target.blockId);
  }

  return params;
}

const REQUEST_INIT: RequestInit = {
  credentials: 'include',
};

const AUTH_REQUEST_INIT: RequestInit = {
  ...REQUEST_INIT,
  cache: 'no-store',
};

export async function fetchComments(
  options: RuntimeCommentOptions,
  target: CommentTarget,
  page: number,
  pageSize = options.pageSize,
): Promise<CommentsResponse> {
  const url = new URL('/api/comments', options.apiBase);
  url.search = buildQuery(target, page, pageSize).toString();
  const response = await fetch(url.toString(), REQUEST_INIT);

  if (!response.ok) {
    throw new Error(`failed to fetch comments: ${response.status}`);
  }

  return normalizeCommentsResponse((await response.json()) as CommentsResponse);
}

export async function fetchCommentPreview(
  options: RuntimeCommentOptions,
  target: CommentTarget,
): Promise<CommentsResponse> {
  return fetchComments(options, target, 1, 2);
}

export async function fetchCommentCounts(
  options: RuntimeCommentOptions,
  pagePath: string,
): Promise<CommentCountsResponse> {
  const url = new URL('/api/comment-counts', options.apiBase);
  url.search = new URLSearchParams({ pagePath }).toString();
  const response = await fetch(url.toString(), REQUEST_INIT);

  if (!response.ok) {
    throw new Error(`failed to fetch comment counts: ${response.status}`);
  }

  return normalizeCommentCountsResponse(
    (await response.json()) as CommentCountsResponse,
  );
}

export async function createComment(
  options: RuntimeCommentOptions,
  payload: {
    pagePath: string;
    blockId?: string;
    parentId?: string;
    authorName?: string;
    quoteText?: string;
    selectionMeta?: SelectionMeta;
    body: string;
  },
): Promise<CommentRecord> {
  const response = await fetch(new URL('/api/comments', options.apiBase), {
    ...REQUEST_INIT,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...payload,
      authorName: payload.authorName || options.defaultAuthorName,
    }),
  });

  if (!response.ok) {
    throw new Error(`failed to create comment: ${response.status}`);
  }

  const data = (await response.json()) as { item: CommentRecord };
  return normalizeCommentRecord(data.item);
}

export async function deleteComment(
  options: RuntimeCommentOptions,
  commentId: string,
): Promise<CommentRecord> {
  const response = await fetch(
    new URL(`/api/comments/${commentId}`, options.apiBase),
    {
      ...REQUEST_INIT,
      method: 'DELETE',
    },
  );

  if (!response.ok) {
    throw new Error(`failed to delete comment: ${response.status}`);
  }

  const data = (await response.json()) as { item: CommentRecord };
  return normalizeCommentRecord(data.item);
}

export async function fetchCurrentUser(
  options: RuntimeCommentOptions,
): Promise<{ authEnabled: boolean; user: AuthUser | null }> {
  const response = await fetch(new URL('/api/auth/me', options.apiBase), AUTH_REQUEST_INIT);

  if (!response.ok) {
    throw new Error(`failed to fetch auth state: ${response.status}`);
  }

  return (await response.json()) as { authEnabled: boolean; user: AuthUser | null };
}

export async function logout(
  options: RuntimeCommentOptions,
): Promise<void> {
  const response = await fetch(new URL('/api/auth/logout', options.apiBase), {
    ...AUTH_REQUEST_INIT,
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`failed to logout: ${response.status}`);
  }
}

export function buildLoginUrl(
  options: RuntimeCommentOptions,
  returnTo: string,
) {
  const url = new URL('/auth/gitea/login', options.apiBase);
  url.search = new URLSearchParams({ returnTo }).toString();
  return url.toString();
}

export function buildCommentTree(items: CommentRecord[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  for (const item of items) {
    nodes.set(item.id, {
      ...item,
      replies: [],
    });
  }

  for (const item of items) {
    const node = nodes.get(item.id);
    if (!node) {
      continue;
    }

    if (item.parentId) {
      const parent = nodes.get(item.parentId);
      if (parent) {
        parent.replies.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}
