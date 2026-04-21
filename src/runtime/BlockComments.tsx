import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '@rspress/core/runtime';
import { MessageSquareQuote, X } from 'lucide-react';
import { fetchCommentCounts } from './api';
import CommentsPanel from './CommentsPanel';
import type {
  RuntimeCommentOptions,
  SelectionMeta,
  SelectionSegment,
} from './types';

interface SelectionComment {
  blockId: string;
  blockLabel: string;
  rect: DOMRect;
  selectionId: string;
  text: string;
  actionLabel: string;
  selectionMeta: SelectionMeta;
}

interface SelectionMarker {
  selectionId: string;
  selectionMeta: SelectionMeta;
}

function getEventElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target;
  }

  if (target instanceof Text) {
    return target.parentElement;
  }

  return null;
}

function hashText(input: string): string {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function buildSelectionId(blockId: string, text: string): string {
  return `${blockId}::selection-${hashText(text)}`;
}

function clearSelectionHighlights() {
  document
    .querySelectorAll<HTMLElement>('[data-comment-selection-highlight]')
    .forEach(node => {
      const parent = node.parentNode;
      if (!parent) {
        return;
      }

      while (node.firstChild) {
        parent.insertBefore(node.firstChild, node);
      }

      parent.removeChild(node);
      parent.normalize();
    });
}

function createTextNodeMap(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;
      if (parent?.closest('[data-comment-selection-highlight]')) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let cursor = 0;
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const text = node.textContent ?? '';
    textNodes.push({
      node,
      start: cursor,
      end: cursor + text.length,
    });
    cursor += text.length;
    current = walker.nextNode();
  }

  return {
    textNodes,
    content: textNodes.map(item => item.node.textContent ?? '').join(''),
  };
}

function applySelectionHighlight(block: HTMLElement, quoteText: string, selectionId: string) {
  const normalizedQuoteText = quoteText.trim();
  if (!normalizedQuoteText) {
    return;
  }

  const { textNodes, content } = createTextNodeMap(block);
  if (textNodes.length === 0) {
    return;
  }

  const startIndex = content.indexOf(normalizedQuoteText);
  if (startIndex < 0) {
    return;
  }

  const endIndex = startIndex + normalizedQuoteText.length;
  const startEntry = textNodes.find(item => startIndex >= item.start && startIndex < item.end);
  const endEntry = textNodes.find(item => endIndex > item.start && endIndex <= item.end);

  if (!startEntry || !endEntry) {
    return;
  }

  const range = document.createRange();
  range.setStart(startEntry.node, startIndex - startEntry.start);
  range.setEnd(endEntry.node, endIndex - endEntry.start);

  const highlight = document.createElement('span');
  highlight.className = 'hf-inline-selection-comment';
  highlight.dataset.commentSelectionHighlight = selectionId;
  highlight.dataset.commentId = selectionId;

  try {
    const fragment = range.extractContents();
    highlight.appendChild(fragment);
    range.insertNode(highlight);
  } catch {
    return;
  }
}

function collectSelectionSegments(range: Range): SelectionSegment[] {
  const root =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!root) {
    return [];
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      return range.intersectsNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const parts = new Map<string, string[]>();
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const parent = node.parentElement?.closest<HTMLElement>('[data-comment-id]');
    const blockId = parent?.dataset.commentId;

    if (blockId) {
      const text = node.textContent ?? '';
      let startOffset = 0;
      let endOffset = text.length;

      if (node === range.startContainer) {
        startOffset = range.startOffset;
      }

      if (node === range.endContainer) {
        endOffset = range.endOffset;
      }

      const slice = text.slice(startOffset, endOffset);
      if (slice.trim()) {
        parts.set(blockId, [...(parts.get(blockId) ?? []), slice]);
      }
    }

    current = walker.nextNode();
  }

  return [...parts.entries()].map(([blockId, texts]) => ({
    blockId,
    text: texts.join('').replace(/\s+/g, ' ').trim(),
  }));
}

function getSelectionComment(): SelectionComment | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const endElement =
    range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement;

  if (!startElement || !endElement) {
    return null;
  }

  const startBlock = startElement.closest<HTMLElement>('[data-comment-id]');
  const endBlock = endElement.closest<HTMLElement>('[data-comment-id]');
  if (!startBlock || !endBlock) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }

  const segments = collectSelectionSegments(range);
  if (segments.length === 0) {
    return null;
  }

  const blockId = startBlock.dataset.commentId;
  if (!blockId) {
    return null;
  }

  return {
    blockId,
    blockLabel:
      startBlock.dataset.commentLabel?.trim() || startBlock.textContent?.trim() || blockId,
    rect,
    selectionId: buildSelectionId(
      segments.map(segment => segment.blockId).join('|'),
      text,
    ),
    text,
    actionLabel: '评论所选内容',
    selectionMeta: {
      segments,
    },
  };
}

export default function BlockComments(options: RuntimeCommentOptions) {
  const location = useLocation();
  const pathname = (location as { pathname?: string })?.pathname || '/';
  const [selectionDraft, setSelectionDraft] = useState<SelectionComment | null>(null);
  const [selectionActive, setSelectionActive] = useState<SelectionComment | null>(null);
  const [selectionMarkers, setSelectionMarkers] = useState<SelectionMarker[]>([]);

  useEffect(() => {
    setSelectionDraft(null);
    setSelectionActive(null);
    setSelectionMarkers([]);
  }, [pathname]);

  useEffect(() => {
    if (!options.blockComments) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetchCommentCounts(options, pathname);
        if (cancelled) {
          return;
        }

        setSelectionMarkers(
          response.blocks
            .filter(
              item =>
                item.blockId.includes('::selection-') &&
                item.count > 0 &&
                item.selectionMeta &&
                item.selectionMeta.segments.length > 0,
            )
            .map(item => ({
              selectionId: item.blockId,
              selectionMeta: item.selectionMeta as SelectionMeta,
            })),
        );
      } catch {
        if (!cancelled) {
          setSelectionMarkers([]);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [options, pathname]);

  useEffect(() => {
    if (!options.blockComments) {
      return;
    }

    const syncSelection = () => {
      const next = getSelectionComment();
      setSelectionDraft(current => {
        if (
          current &&
          next &&
          current.selectionId === next.selectionId &&
          current.text === next.text
        ) {
          return {
            ...current,
            rect: next.rect,
          };
        }

        return next;
      });
    };

    const clearOnPointerDown = (event: PointerEvent) => {
      const target = getEventElement(event.target);
      if (!target) {
        return;
      }

      if (
        target.closest('.hf-selection-comment-button') ||
        target.closest('.hf-selection-comment-panel') ||
        target.closest('.hf-inline-selection-comment')
      ) {
        return;
      }

      setSelectionDraft(null);
    };

    document.addEventListener('selectionchange', syncSelection);
    document.addEventListener('pointerdown', clearOnPointerDown, true);
    window.addEventListener('scroll', syncSelection, true);
    window.addEventListener('resize', syncSelection);

    return () => {
      document.removeEventListener('selectionchange', syncSelection);
      document.removeEventListener('pointerdown', clearOnPointerDown, true);
      window.removeEventListener('scroll', syncSelection, true);
      window.removeEventListener('resize', syncSelection);
    };
  }, [options.blockComments]);

  useEffect(() => {
    clearSelectionHighlights();

    selectionMarkers.forEach(marker => {
      marker.selectionMeta.segments.forEach(segment => {
        const block = document.querySelector<HTMLElement>(
          `[data-comment-id="${CSS.escape(segment.blockId)}"]`,
        );

        if (!block) {
          return;
        }

        applySelectionHighlight(block, segment.text, marker.selectionId);
      });
    });

    return () => {
      clearSelectionHighlights();
    };
  }, [pathname, selectionMarkers]);

  useEffect(() => {
    if (!options.blockComments) {
      return;
    }

    const onClick = (event: MouseEvent) => {
      const target = getEventElement(event.target);
      if (!target) {
        return;
      }

      if (target.closest('.hf-selection-comment-panel')) {
        return;
      }

      const inlineSelection = target.closest<HTMLElement>('.hf-inline-selection-comment');
      if (inlineSelection) {
        event.preventDefault();
        event.stopPropagation();
        const selectionId = inlineSelection.dataset.commentId;
        const block = inlineSelection.closest<HTMLElement>('[data-comment-id]');
        const marker = selectionMarkers.find(item => item.selectionId === selectionId);

        if (selectionId && block && marker) {
          setSelectionActive({
            actionLabel: '查看评论',
            blockId: marker.selectionMeta.segments[0]?.blockId || block.dataset.commentId || '',
            blockLabel:
              block.dataset.commentLabel?.trim() ||
              block.textContent?.trim() ||
              marker.selectionMeta.segments[0]?.blockId ||
              '',
            rect: inlineSelection.getBoundingClientRect(),
            selectionId,
            text: marker.selectionMeta.segments.map(segment => segment.text).join('\n'),
            selectionMeta: marker.selectionMeta,
          });
          setSelectionDraft(null);
          window.getSelection()?.removeAllRanges();
        }
        return;
      }

      if (selectionActive) {
        setSelectionActive(null);
      }
    };

    document.addEventListener('click', onClick, true);

    return () => {
      document.removeEventListener('click', onClick, true);
    };
  }, [options.blockComments, selectionActive, selectionMarkers]);

  const selectionButton =
    selectionDraft && !selectionActive && typeof document !== 'undefined'
      ? createPortal(
            <button
              aria-label={selectionDraft.actionLabel}
              className="hf-selection-comment-button"
              onClick={() => {
                setSelectionActive(selectionDraft);
                setSelectionDraft(null);
                window.getSelection()?.removeAllRanges();
              }}
            style={{
              left: Math.min(
                Math.max(16, selectionDraft.rect.right + 10),
                window.innerWidth - 84,
              ),
              top: Math.max(16, selectionDraft.rect.top - 8),
              }}
              title={selectionDraft.actionLabel}
            type="button"
          >
            <MessageSquareQuote aria-hidden="true" size={16} />
          </button>,
          document.body,
        )
      : null;

  if (typeof document === 'undefined' || !options.blockComments) {
    return null;
  }

  return (
    <>
      {selectionButton}
      {selectionActive
        ? createPortal(
            <SelectionCommentPanel
              target={selectionActive}
              onClose={() => {
                setSelectionActive(null);
                window.getSelection()?.removeAllRanges();
              }}
              title={selectionActive.text}
            >
              <CommentsPanel
                emptyText="这段选中文本还没有评论。"
                options={options}
                onCommentCreated={comment => {
                  if (
                    comment.parentId ||
                    typeof comment.blockId !== 'string' ||
                    !comment.selectionMeta
                  ) {
                    return;
                  }

                  const selectionId = comment.blockId;
                  const selectionMeta = comment.selectionMeta;

                  setSelectionMarkers(current => {
                    if (current.some(item => item.selectionId === selectionId)) {
                      return current;
                    }

                    return [
                      ...current,
                      {
                        selectionId,
                        selectionMeta,
                      },
                    ];
                  });
                }}
                quoteText={selectionActive.text}
                selectionMeta={selectionActive.selectionMeta}
                showQuote={false}
                showTitle={false}
                target={{ pagePath: pathname, blockId: selectionActive.selectionId }}
                title="选区评论"
              />
            </SelectionCommentPanel>,
            document.body,
          )
        : null}
    </>
  );
}

function SelectionCommentPanel({
  target,
  title,
  onClose,
  children,
}: {
  target: SelectionComment;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelWidth = Math.min(420, window.innerWidth - 24);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const leftCandidate = target.rect.right + 12;
  const left =
    leftCandidate + panelWidth < viewportWidth - 20
      ? leftCandidate
      : Math.max(18, target.rect.left - panelWidth - 12);
  const top = Math.min(
    Math.max(14, target.rect.top - 8),
    Math.max(14, viewportHeight - 560),
  );

  return (
    <aside className="hf-selection-comment-panel" style={{ left, top }}>
      <div className="hf-selection-comment-panel-header">
        <div>
          <div className="hf-comment-preview-kicker">选区评论</div>
          <div className="hf-selection-comment-panel-title">{title}</div>
        </div>
        <button
          aria-label="关闭"
          className="hf-comment-bubble-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
      <div className="hf-selection-comment-panel-body">{children}</div>
    </aside>
  );
}
