import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '@rspress/core/runtime';
import type { RuntimeCommentOptions } from './shared';
import { buildTerm } from './shared';
import GiscusWidget from './GiscusWidget';

interface ActiveComment {
  id: string;
  label: string;
}

export default function BlockComments(options: RuntimeCommentOptions) {
  const location = useLocation();
  const pathname = (location as { pathname?: string })?.pathname || '/';
  const [active, setActive] = useState<ActiveComment | null>(null);

  useEffect(() => {
    setActive(null);
  }, [pathname]);

  useEffect(() => {
    if (!options.blockComments) {
      return;
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const trigger = target.closest<HTMLElement>('[data-comment-trigger]');
      if (!trigger) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const block = trigger.closest<HTMLElement>('[data-comment-id]');
      const id = trigger.dataset.commentId || block?.dataset.commentId;
      if (!id) {
        return;
      }

      const label =
        block?.dataset.commentLabel?.trim() || block?.textContent?.trim() || id;

      setActive({
        id,
        label,
      });
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [options.blockComments]);

  useEffect(() => {
    document
      .querySelectorAll('.hf-commentable-block.is-commenting')
      .forEach(node => node.classList.remove('is-commenting'));

    if (!active) {
      return;
    }

    const node = document.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(active.id)}"]`,
    );
    node?.classList.add('is-commenting');

    return () => node?.classList.remove('is-commenting');
  }, [active]);

  const drawer = useMemo(() => {
    if (!options.blockComments || !active) {
      return null;
    }

    return (
      <div className="hf-comment-drawer-backdrop" onClick={() => setActive(null)}>
        <aside
          aria-label="段评抽屉"
          className="hf-comment-drawer"
          onClick={event => event.stopPropagation()}
        >
          <div className="hf-comment-drawer-header">
            <div>
              <div className="hf-comments-title">段评</div>
              <div className="hf-comment-drawer-meta">{active.id}</div>
            </div>
            <button
              className="hf-comment-drawer-close"
              onClick={() => setActive(null)}
              type="button"
            >
              关闭
            </button>
          </div>

          <div className="hf-comment-drawer-context">{active.label}</div>

          <GiscusWidget
            options={options}
            term={buildTerm(pathname, options.termPrefix, active.id)}
            id={`hf-block-comments:${pathname}:${active.id}`}
          />
        </aside>
      </div>
    );
  }, [active, options, pathname]);

  if (!drawer || typeof document === 'undefined') {
    return null;
  }

  return createPortal(drawer, document.body);
}
