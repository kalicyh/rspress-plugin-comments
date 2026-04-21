import { createHash } from 'node:crypto';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';

const DEFAULT_TAGS = ['h2', 'h3', 'h4', 'p', 'li', 'blockquote'] as const;

export interface RehypeCommentableBlocksOptions {
  enabled?: boolean;
  tags?: readonly string[];
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function addClassName(node: HastElement, className: string): void {
  const current = node.properties?.className;
  const next = Array.isArray(current)
    ? [...current]
    : typeof current === 'string'
      ? [current]
      : [];

  if (!next.includes(className)) {
    next.push(className);
  }

  node.properties = {
    ...node.properties,
    className: next,
  };
}

function removeLegacyTrigger(node: HastElement): void {
  if (!node.children) {
    return;
  }

  node.children = node.children.filter(child => {
    return !(
      child.type === 'element' &&
      child.tagName === 'button' &&
      child.properties &&
      'data-comment-trigger' in child.properties
    );
  });
}

function inferFilePath(file: { path?: string; history?: string[] }): string {
  if (file.path) {
    return file.path;
  }

  return file.history?.[0] ?? 'unknown';
}

export function rehypeCommentableBlocks(
  options: RehypeCommentableBlocksOptions = {},
) {
  const enabled = options.enabled !== false;
  const tags = new Set(options.tags ?? DEFAULT_TAGS);

  return (tree: unknown, file: { path?: string; history?: string[] }) => {
    if (!enabled) {
      return;
    }

    const filePath = inferFilePath(file);
    let counter = 0;

    visit(tree as any, 'element', (node: any) => {
      if (!tags.has(node.tagName)) {
        return;
      }

      const rawText = normalizeText(toString(node as any));
      if (!rawText) {
        return;
      }

      const explicitId =
        typeof node.properties?.id === 'string' ? node.properties.id : '';
      const hash = createHash('sha1')
        .update(`${filePath}:${node.tagName}:${rawText}`)
        .digest('hex')
        .slice(0, 8);
      const fallbackSlug = slugify(rawText) || `${node.tagName}-${++counter}`;
      const commentId = explicitId || `${node.tagName}-${fallbackSlug}-${hash}`;

      node.properties = {
        ...node.properties,
        'data-comment-id': commentId,
        'data-comment-label': rawText.slice(0, 160),
      };
      addClassName(node, 'hf-commentable-block');
      removeLegacyTrigger(node);
    });
  };
}

type HastElement = {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children?: Array<HastElement | HastText>;
};

type HastText = {
  type: 'text';
  value: string;
};
