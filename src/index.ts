import path from 'node:path';
import type { RspressPlugin } from '@rspress/core';
import {
  rehypeCommentableBlocks,
  type RehypeCommentableBlocksOptions,
} from './markdown/rehypeCommentableBlocks';

export interface CommentPluginOptions {
  enabled?: boolean;
  repo?: string;
  repoId?: string;
  category?: string;
  categoryId?: string;
  lang?: string;
  pageComments?: boolean;
  blockComments?: boolean;
  blockSelectorTags?: RehypeCommentableBlocksOptions['tags'];
  termPrefix?: string;
  inputPosition?: 'top' | 'bottom';
}

function hasRequiredConfig(options: CommentPluginOptions): boolean {
  return Boolean(
    options.repo && options.repoId && options.category && options.categoryId,
  );
}

export function pluginComments(options: CommentPluginOptions): RspressPlugin {
  const enabled = options.enabled !== false;
  const configured = hasRequiredConfig(options);
  const runtimeOptions = {
    ...options,
    enabled,
    configured,
    pageComments: enabled && options.pageComments !== false,
    blockComments: enabled && options.blockComments !== false,
  };

  return {
    name: 'rspress-plugin-comments',
    globalStyles: path.join(__dirname, 'runtime', 'styles.css'),
    globalUIComponents: [
      [path.join(__dirname, 'runtime', 'PageComments.tsx'), runtimeOptions],
      [path.join(__dirname, 'runtime', 'BlockComments.tsx'), runtimeOptions],
    ],
    markdown: {
      rehypePlugins: [
        [
          rehypeCommentableBlocks,
          {
            enabled: runtimeOptions.blockComments,
            tags: options.blockSelectorTags,
          } satisfies RehypeCommentableBlocksOptions,
        ],
      ],
    },
  };
}
