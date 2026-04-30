import type { CommentPluginOptions } from '../index';

export interface SelectionSegment {
  blockId: string;
  text: string;
}

export interface SelectionMeta {
  segments: SelectionSegment[];
}

export interface CommentRecord {
  id: string;
  parentId: string | null;
  targetType: 'page' | 'block';
  pagePath: string;
  blockId: string | null;
  quoteText: string | null;
  selectionMeta: SelectionMeta | null;
  authorId: string;
  authorName: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  status: 'published' | 'pending' | 'deleted';
}

export interface AuthUser {
  id: string;
  login: string | null;
  name: string;
  avatarUrl: string | null;
}

export interface RuntimeAuthState {
  authEnabled: boolean;
  authLabel: string;
  currentUser: AuthUser | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

export interface CommentsResponse {
  items: CommentRecord[];
  pagination: {
    page: number;
    pageSize: number;
    totalRootComments: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface CommentCountsResponse {
  pagePath: string;
  pageCount: number;
  blocks: Array<{
    blockId: string;
    quoteText: string | null;
    selectionMeta: SelectionMeta | null;
    count: number;
  }>;
}

export type RuntimeCommentOptions = CommentPluginOptions & {
  enabled: boolean;
  pageComments: boolean;
  blockComments: boolean;
  apiBase: string;
  pageSize: number;
  defaultAuthorName: string;
};

export interface CommentTarget {
  pagePath: string;
  blockId?: string;
}

export interface CommentNode extends CommentRecord {
  replies: CommentNode[];
}
