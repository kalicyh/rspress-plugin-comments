import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '@rspress/core/runtime';
import type { RuntimeCommentOptions } from './shared';
import { buildTerm } from './shared';
import GiscusWidget from './GiscusWidget';

const FOOTER_SELECTOR = '.rp-doc-footer';
const DOC_SELECTOR = '.rp-doc';

export default function PageComments(options: RuntimeCommentOptions) {
  const location = useLocation();
  const pathname = (location as { pathname?: string })?.pathname || '/';

  if (!options.pageComments) {
    return null;
  }

  return <PageCommentsInternal key={pathname} options={options} pathname={pathname} />;
}

function PageCommentsInternal({
  options,
  pathname,
}: {
  options: RuntimeCommentOptions;
  pathname: string;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

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
        footer.parentElement.insertBefore(wrapper, footer);
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
    <section aria-label="整页评论">
      <div className="hf-comments-title">整页评论</div>
      <GiscusWidget
        options={options}
        term={buildTerm(pathname, options.termPrefix)}
        id={`hf-page-comments:${pathname}`}
      />
    </section>,
    container,
  );
}
