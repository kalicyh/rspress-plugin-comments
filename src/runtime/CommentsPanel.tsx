import type { RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Reply, Send, Trash2 } from 'lucide-react';
import {
  buildCommentTree,
  buildLoginUrl,
  createComment,
  deleteComment,
  fetchCurrentUser,
  fetchComments,
  logout,
} from './api';
import type {
  AuthUser,
  CommentRecord,
  CommentNode,
  CommentTarget,
  RuntimeAuthState,
  RuntimeCommentOptions,
  SelectionMeta,
} from './types';

interface CommentsPanelProps {
  options: RuntimeCommentOptions;
  target: CommentTarget;
  title: string;
  emptyText: string;
  showTitle?: boolean;
  showQuote?: boolean;
  onCountChange?: (count: number) => void;
  onCommentCreated?: (comment: CommentRecord) => void;
  auth?: RuntimeAuthState;
  quoteText?: string;
  selectionMeta?: SelectionMeta;
}

const AUTH_STATE_EVENT = 'hf-comments-auth-change';

export default function CommentsPanel({
  options,
  target,
  title,
  emptyText,
  showTitle = true,
  showQuote = true,
  onCountChange,
  onCommentCreated,
  auth,
  quoteText,
  selectionMeta,
}: CommentsPanelProps) {
  const [items, setItems] = useState<CommentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CommentNode | null>(null);
  const onCountChangeRef = useRef(onCountChange);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const effectiveAuthEnabled = auth?.authEnabled ?? authEnabled;
  const effectiveCurrentUser = auth?.currentUser ?? currentUser;
  const effectiveAuthLabel = auth?.authLabel ?? 'Gitea';

  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  useEffect(() => {
    if (auth) {
      setAuthEnabled(auth.authEnabled);
      setCurrentUser(auth.currentUser);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetchCurrentUser(options);
        if (cancelled) {
          return;
        }

        setAuthEnabled(response.authEnabled);
        setCurrentUser(response.user);
      } catch {
        if (!cancelled) {
          setAuthEnabled(false);
          setCurrentUser(null);
        }
      }
    };

    void run();

    const onAuthChange = () => {
      void run();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(AUTH_STATE_EVENT, onAuthChange);
    }

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(AUTH_STATE_EVENT, onAuthChange);
      }
    };
  }, [auth, options, refreshKey]);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const inMenu = accountMenuRef.current?.contains(target);
      const inTrigger = accountTriggerRef.current?.contains(target);

      if (!inMenu && !inTrigger) {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchComments(options, target, 1);
        if (cancelled) {
          return;
        }

        setItems(buildCommentTree(response.items));
        onCountChangeRef.current?.(response.pagination.totalRootComments);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '加载评论失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    options,
    target.pagePath,
    target.blockId,
    refreshKey,
  ]);

  const actions = useMemo(
    () => ({
      submit: async (body: string, parentId?: string) => {
        const comment = await createComment(options, {
          pagePath: target.pagePath,
          blockId: target.blockId,
          parentId,
          quoteText,
          selectionMeta,
          body,
          user: effectiveCurrentUser,
        });
        onCommentCreated?.(comment);
        setRefreshKey(key => key + 1);
      },
      remove: async (commentId: string) => {
        await deleteComment(options, commentId);
        setRefreshKey(key => key + 1);
      },
    }),
    [
      effectiveCurrentUser,
      onCommentCreated,
      options,
      quoteText,
      selectionMeta,
      target.pagePath,
      target.blockId,
    ],
  );

  return (
    <section className="hf-comments-panel" aria-label={title}>
      {showTitle ? <div className="hf-comments-title">{title}</div> : null}

      {showQuote && quoteText ? (
        <blockquote className="hf-comment-quote">{quoteText}</blockquote>
      ) : null}

      <div
        className="hf-comments-scroll"
        onWheelCapture={event => {
          const container = event.currentTarget;
          if (container.scrollHeight <= container.clientHeight) {
            return;
          }

          container.scrollTop += event.deltaY;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {loading ? <div className="hf-comments-meta">正在加载评论…</div> : null}
        {error ? <div className="hf-comments-error">{error}</div> : null}
        {!loading && !error && items.length === 0 ? (
          <div className="hf-comments-meta">{emptyText}</div>
        ) : null}

        <div className="hf-comment-list">
          {items.map(item => (
            <CommentThread
              currentUser={effectiveCurrentUser}
              key={item.id}
              root={item}
              onDelete={actions.remove}
              onReplyStart={comment => {
                setReplyTarget(comment);
                composerInputRef.current?.focus();
              }}
            />
          ))}
        </div>
      </div>

      {effectiveAuthEnabled && !effectiveCurrentUser && !auth?.isLoading ? (
        <div className="hf-comment-auth-loginbar">
          <span className="hf-comments-meta">使用 {effectiveAuthLabel} 登录后即可发表评论。</span>
          {auth ? (
            <button
              className="hf-comment-inline-button hf-comment-auth-link"
              onClick={auth.login}
              type="button"
            >
              使用 {effectiveAuthLabel} 登录
            </button>
          ) : (
            <a
              className="hf-comment-inline-button hf-comment-auth-link"
              href={buildLoginUrl(
                options,
                typeof window !== 'undefined'
                  ? `${window.location.pathname}${window.location.search}${window.location.hash}`
                  : target.pagePath,
              )}
            >
              使用 {effectiveAuthLabel} 登录
            </a>
          )}
        </div>
      ) : null}

      {!effectiveAuthEnabled || effectiveCurrentUser ? (
        <CommentComposer
          accountMenuOpen={accountMenuOpen}
          authEnabled={effectiveAuthEnabled}
          authLabel={effectiveAuthLabel}
          currentUser={effectiveCurrentUser}
          onLogout={() => {
            if (auth) {
              auth.logout();
              return;
            }

            void logout(options).then(() => {
              setAccountMenuOpen(false);
              setCurrentUser(null);
              setRefreshKey(key => key + 1);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event(AUTH_STATE_EVENT));
              }
            });
          }}
          accountTriggerRef={accountTriggerRef}
          onToggleAccountMenu={() => setAccountMenuOpen(value => !value)}
          accountMenuRef={accountMenuRef}
          inputRef={composerInputRef}
          label={replyTarget ? '提交回复' : target.blockId ? '发表段评' : '发表评论'}
          onCancelReply={replyTarget ? () => setReplyTarget(null) : undefined}
          replyTarget={replyTarget}
          onSubmit={async body => {
            await actions.submit(body, replyTarget?.id);
            setReplyTarget(null);
          }}
        />
      ) : null}
    </section>
  );
}

function CommentItem({
  currentUser,
  item,
  replyToName,
  onReplyStart,
  onDelete,
}: {
  currentUser: AuthUser | null;
  item: CommentNode;
  replyToName?: string;
  onReplyStart: (comment: CommentNode) => void;
  onDelete: (commentId: string) => Promise<void>;
}) {
  const deleted = item.status === 'deleted';
  const createdAt = new Date(item.createdAt);
  const canDelete =
    !deleted &&
    currentUser !== null &&
    (currentUser.id === item.authorId ||
      (currentUser.login && item.authorLogin && currentUser.login === item.authorLogin));
  const userForAvatar = {
    id: item.authorId,
    login: item.authorLogin || item.authorName,
    name: item.authorName,
    avatarUrl: item.authorAvatarUrl,
  };

  return (
    <article className={`hf-comment-item${replyToName ? ' is-reply-item' : ''}`}>
      <div className="hf-comment-avatar-wrap">
        <Avatar user={userForAvatar} />
        <div className="hf-comment-avatar-name" role="tooltip">
          {item.authorName}
        </div>
      </div>
      <div className="hf-comment-item-main">
        {replyToName ? (
          <div className="hf-comment-reply-target">
            回复 {replyToName}
          </div>
        ) : null}
        <div className="hf-comment-bubble-card">
          {canDelete ? (
            <button
              aria-label="删除评论"
              className="hf-comment-delete-icon"
              onClick={() => {
                void onDelete(item.id);
              }}
              title="删除评论"
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          ) : null}
          <div className={`hf-comment-body${deleted ? ' is-deleted' : ''}`}>
            {deleted ? '该评论已删除。' : item.body}
          </div>

          <div className="hf-comment-bubble-footer">
            <time
              className="hf-comment-item-time"
              dateTime={item.createdAt}
              title={createdAt.toLocaleString()}
            >
              {formatCommentTime(createdAt)}
            </time>
            {!deleted ? (
              <button
                className="hf-comment-reply-text"
                onClick={() => onReplyStart(item)}
                title="回复"
                type="button"
              >
                <Reply aria-hidden="true" size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function CommentThread({
  currentUser,
  root,
  onReplyStart,
  onDelete,
}: {
  currentUser: AuthUser | null;
  root: CommentNode;
  onReplyStart: (comment: CommentNode) => void;
  onDelete: (commentId: string) => Promise<void>;
}) {
  const replies = useMemo(() => flattenReplies(root.replies, root), [root.replies, root]);
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="hf-comment-thread">
      <CommentItem
        currentUser={currentUser}
        item={root}
        onDelete={onDelete}
        onReplyStart={onReplyStart}
      />
      {replies.length > 0 ? (
        <>
          <button
            className="hf-comment-thread-toggle"
            onClick={() => setExpanded(value => !value)}
            type="button"
          >
            {expanded ? '收起回复' : `展开 ${replies.length} 条回复`}
          </button>
          {expanded ? (
            <div className="hf-comment-replies">
              {replies.map(({ item, replyToName }) => (
                <CommentItem
                  currentUser={currentUser}
                  item={item}
                  key={item.id}
                  onDelete={onDelete}
                  onReplyStart={onReplyStart}
                  replyToName={replyToName}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function flattenReplies(
  nodes: CommentNode[],
  parent?: CommentNode,
): Array<{ item: CommentNode; replyToName?: string }> {
  return nodes.flatMap(node => [
    {
      item: node,
      replyToName: parent?.authorName,
    },
    ...flattenReplies(node.replies, node),
  ]);
}

function formatCommentTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }

  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase();
  }

  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function Avatar({ user }: { user: AuthUser }) {
  const initials = getInitials(user.name || user.login || user.id);

  if (user.avatarUrl) {
    return (
      <img
        alt={user.name}
        className="hf-comment-avatar hf-comment-avatar-image"
        referrerPolicy="no-referrer"
        src={user.avatarUrl}
      />
    );
  }

  return (
    <div className="hf-comment-avatar" aria-hidden="true">
      {initials}
    </div>
  );
}

function CommentComposer({
  accountMenuOpen,
  accountMenuRef,
  accountTriggerRef,
  authEnabled,
  authLabel,
  currentUser,
  inputRef,
  label,
  onLogout,
  onCancelReply,
  onSubmit,
  onToggleAccountMenu,
  compact = false,
  replyTarget,
}: {
  accountMenuOpen?: boolean;
  accountMenuRef?: RefObject<HTMLDivElement | null>;
  accountTriggerRef?: RefObject<HTMLButtonElement | null>;
  authEnabled: boolean;
  authLabel: string;
  currentUser: AuthUser | null;
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  label: string;
  onLogout?: () => void;
  onCancelReply?: () => void;
  onSubmit: (body: string) => Promise<void>;
  onToggleAccountMenu?: () => void;
  compact?: boolean;
  replyTarget?: CommentNode | null;
}) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={`hf-comment-composer${compact ? ' is-compact' : ''}`}
      onSubmit={async event => {
        event.preventDefault();
        const content = body.trim();
        if (!content) {
          setError('评论内容不能为空');
          return;
        }

        if (authEnabled && !currentUser) {
          setError(`请先登录 ${authLabel} 再发表评论`);
          return;
        }

        setSubmitting(true);
        setError(null);

        try {
          await onSubmit(content);
          setBody('');
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : '提交失败');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className={`hf-comment-composer-row${currentUser && !compact ? ' has-account' : ''}`}>
        {currentUser && !compact ? (
          <div className="hf-comment-composer-account" ref={accountMenuRef}>
            <button
              className="hf-comment-account-trigger hf-comment-composer-account-trigger"
              onClick={onToggleAccountMenu}
              ref={accountTriggerRef}
              type="button"
            >
              <Avatar user={currentUser} />
            </button>
          </div>
        ) : null}
        <div className={`hf-comment-composer-shell${replyTarget ? ' is-replying' : ''}`}>
          {compact ? (
            <textarea
              className="hf-comment-input hf-comment-input-multiline"
              onChange={event => setBody(event.target.value)}
              placeholder={replyTarget ? `回复 ${replyTarget.authorName}` : '写下你的评论…'}
              ref={inputRef as RefObject<HTMLTextAreaElement | null> | undefined}
              rows={3}
              value={body}
            />
          ) : (
            <input
              className="hf-comment-input"
              onChange={event => setBody(event.target.value)}
              placeholder={replyTarget ? `回复 ${replyTarget.authorName}` : '写下你的评论…'}
              ref={inputRef as RefObject<HTMLInputElement | null> | undefined}
              type="text"
              value={body}
            />
          )}
          <div className="hf-comment-composer-footer">
            {replyTarget ? (
              <button
                className="hf-comment-replying-cancel"
                onClick={onCancelReply}
                type="button"
              >
                取消
              </button>
            ) : null}
            <button
              aria-label={submitting ? '提交中' : label}
              className="hf-comment-submit hf-comment-submit-icon"
              disabled={submitting}
              title={submitting ? '提交中' : label}
              type="submit"
            >
              <Send aria-hidden="true" className="hf-comment-submit-icon-svg" size={16} />
            </button>
          </div>
        </div>
      </div>
      {accountMenuOpen &&
      onLogout &&
      currentUser &&
      accountMenuRef &&
      accountTriggerRef?.current &&
      typeof document !== 'undefined'
        ? createPortal(
            <AccountMenu
              menuRef={accountMenuRef}
              onLogout={onLogout}
              triggerRect={accountTriggerRef.current.getBoundingClientRect()}
              user={currentUser}
            />,
            document.body,
          )
        : null}
      {error ? <div className="hf-comments-error hf-comment-composer-error">{error}</div> : null}
    </form>
  );
}

function AccountMenu({
  menuRef,
  onLogout,
  triggerRect,
  user,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  onLogout: () => void;
  triggerRect: DOMRect;
  user: AuthUser;
}) {
  const width = 220;
  const left = Math.max(16, Math.min(triggerRect.left, window.innerWidth - width - 16));
  const estimatedHeight = 126;
  const openUpward = triggerRect.bottom + 10 + estimatedHeight > window.innerHeight - 12;
  const top = openUpward
    ? Math.max(12, triggerRect.top - estimatedHeight - 10)
    : triggerRect.bottom + 10;

  return (
    <div
      className="hf-comment-account-menu"
      ref={menuRef}
      style={{
        left,
        position: 'fixed',
        top,
      }}
    >
      <div className="hf-comment-account-row">
        <span className="hf-comment-account-value">{user.name}</span>
        <span className="hf-comment-account-subvalue">@{user.login}</span>
      </div>
      <button
        className="hf-comment-account-row hf-comment-account-action"
        onPointerDown={event => {
          event.preventDefault();
          event.stopPropagation();
          onLogout();
        }}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
        }}
        type="button"
      >
        <span className="hf-comment-account-action-text">退出登录</span>
      </button>
    </div>
  );
}
