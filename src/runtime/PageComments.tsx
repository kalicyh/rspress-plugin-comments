import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '@rspress/core/runtime';
import { fetchCommentCounts } from './api';
import type { RuntimeAuthState, RuntimeCommentOptions } from './types';
import CommentsPanel from './CommentsPanel';
import { WithLogto } from './LogtoRuntime';

const FOOTER_SELECTOR = '.rp-doc-footer';
const DOC_SELECTOR = '.rp-doc';

export default function PageComments(options: RuntimeCommentOptions) {
  const location = useLocation();
  const pathname = (location as { pathname?: string })?.pathname || '/';

  if (!options.pageComments) {
    return null;
  }

  return (
    <WithLogto options={options}>
      {auth => (
        <PageCommentsInternal
          auth={auth}
          key={pathname}
          options={options}
          pathname={pathname}
        />
      )}
    </WithLogto>
  );
}

function PageCommentsInternal({
  auth,
  options,
  pathname,
}: {
  auth?: RuntimeAuthState;
  options: RuntimeCommentOptions;
  pathname: string;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const target = useMemo(() => ({ pagePath: pathname }), [pathname]);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let mounted = true;

    const createContainer = (): HTMLDivElement | null => {
      const footer = document.querySelector(FOOTER_SELECTOR);
      const doc = document.querySelector(DOC_SELECTOR);
      const host = footer?.parentElement ?? doc;

      if (!host) {
        return null;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'hf-page-comments';

      if (footer?.parentElement) {
        footer.insertAdjacentElement('afterend', wrapper);
      } else {
        host.appendChild(wrapper);
      }

      return wrapper;
    };

    const mount = () => {
      if (!mounted) {
        return;
      }

      const next = createContainer();
      if (next) {
        setContainer(next);
      }
    };

    mount();

    if (!container) {
      observer = new MutationObserver(() => {
        if (!document.querySelector('.hf-page-comments')) {
          mount();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      mounted = false;
      observer?.disconnect();
      setContainer(prev => {
        prev?.remove();
        return null;
      });
    };
  }, [pathname]);

  if (!container) {
    return null;
  }

  return createPortal(
    <PageCommentsContent auth={auth} options={options} pathname={pathname} target={target} />,
    container,
  );
}

function PageCommentsContent({
  auth,
  options,
  pathname,
  target,
}: {
  auth?: RuntimeAuthState;
  options: RuntimeCommentOptions;
  pathname: string;
  target: { pagePath: string };
}) {
  const hasBlockTab = options.blockComments;
  const [blockThreads, setBlockThreads] = useState<
    Array<{
      blockId: string;
      text: string;
      count: number;
    }>
  >([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [activeTab, setActiveTab] = useState<'blocks' | 'page'>(hasBlockTab ? 'blocks' : 'page');

  useEffect(() => {
    setActiveTab(hasBlockTab ? 'blocks' : 'page');
  }, [hasBlockTab, pathname]);

  useEffect(() => {
    if (!options.blockComments) {
      setBlockThreads([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoadingBlocks(true);

      try {
        const response = await fetchCommentCounts(options, pathname);
        if (cancelled) {
          return;
        }

        const nextThreads = response.blocks
          .filter(item => item.blockId.includes('::selection-') && item.count > 0)
          .map(item => ({
            blockId: item.blockId,
            count: item.count,
            text:
              item.quoteText?.trim() ||
              item.selectionMeta?.segments.map(segment => segment.text).join(' / ').trim() ||
              '选区评论',
          }));

        setBlockThreads(nextThreads);
      } catch {
        if (!cancelled) {
          setBlockThreads([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingBlocks(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [options, pathname]);

  return (
    <div className="hf-page-comments-layout">
      <section className="hf-page-comment-section hf-page-comment-switcher" aria-label="页面评论">
        <div className="hf-page-comment-tabs" role="tablist" aria-label="评论视图切换">
          {hasBlockTab ? (
            <button
              aria-selected={activeTab === 'blocks'}
              className={`hf-page-comment-tab${activeTab === 'blocks' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('blocks')}
              role="tab"
              type="button"
            >
              本页段评
            </button>
          ) : null}
          <button
            aria-selected={activeTab === 'page'}
            className={`hf-page-comment-tab${activeTab === 'page' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('page')}
            role="tab"
            type="button"
          >
            整页评论
          </button>
        </div>

        {activeTab === 'blocks' && hasBlockTab ? (
          <div className="hf-page-comment-tabpanel" role="tabpanel">
            {loadingBlocks ? (
              <div className="hf-comments-meta">正在汇总本页段评…</div>
            ) : null}
            {!loadingBlocks && blockThreads.length === 0 ? (
              <div className="hf-comments-meta">当前页面还没有段评。</div>
            ) : null}
            {blockThreads.length > 0 ? (
              <div className="hf-page-thread-list">
                {blockThreads.map(thread => (
                  <section className="hf-page-thread-card" key={thread.blockId}>
                    <header className="hf-page-thread-header">
                      <div className="hf-page-thread-label">选区评论</div>
                      <div className="hf-page-thread-count">{thread.count} 条评论</div>
                    </header>
                    <blockquote className="hf-comment-quote hf-page-thread-quote">
                      {thread.text}
                    </blockquote>
                    <CommentsPanel
                      auth={auth}
                      emptyText="这段选中文本还没有评论。"
                      options={options}
                      showQuote={false}
                      showTitle={false}
                      target={{ pagePath: pathname, blockId: thread.blockId }}
                      title="选区评论"
                    />
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'page' ? (
          <div className="hf-page-comment-tabpanel" role="tabpanel">
            <CommentsPanel
              auth={auth}
              emptyText="当前页面还没有评论。"
              options={options}
              showTitle={false}
              target={target}
              title="整页评论"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
