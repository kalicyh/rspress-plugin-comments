import { useSyncExternalStore } from 'react';
import type { GiscusProps } from '@giscus/react';
import type { CommentPluginOptions } from '../index';

export type RuntimeCommentOptions = CommentPluginOptions & {
  enabled: boolean;
  configured: boolean;
  pageComments: boolean;
  blockComments: boolean;
};

function getThemeFromDOM(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const root = document.documentElement;
  return (
    root.classList.contains('dark') ||
    root.classList.contains('rp-dark') ||
    root.getAttribute('data-theme') === 'dark' ||
    root.style.colorScheme === 'dark'
  );
}

function subscribeToTheme(callback: () => void): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }

  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });
  return () => observer.disconnect();
}

export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(subscribeToTheme, getThemeFromDOM, () => false);
}

export function buildBaseGiscusProps(
  options: RuntimeCommentOptions,
  isDark: boolean,
): Omit<GiscusProps, 'mapping' | 'term'> | null {
  if (!options.enabled) {
    return null;
  }

  if (
    !options.configured ||
    !options.repo ||
    !options.repoId ||
    !options.category ||
    !options.categoryId
  ) {
    return null;
  }

  return {
    repo: options.repo as GiscusProps['repo'],
    repoId: options.repoId,
    category: options.category,
    categoryId: options.categoryId,
    reactionsEnabled: '1',
    emitMetadata: '0',
    inputPosition: options.inputPosition ?? 'bottom',
    lang: options.lang ?? 'zh-CN',
    loading: 'eager',
    theme: isDark ? 'noborder_dark' : 'light',
  };
}

export function buildTerm(
  pathname: string,
  termPrefix?: string,
  blockId?: string,
): string {
  const normalizedPath = pathname || '/';
  const prefix = termPrefix ? `${termPrefix.trim()}:` : '';
  const suffix = blockId ? `#${blockId}` : '';
  return `${prefix}${normalizedPath}${suffix}`;
}
