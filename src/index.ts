import path from 'node:path';
import type { RspressPlugin } from '@rspress/core';
import {
  rehypeCommentableBlocks,
  type RehypeCommentableBlocksOptions,
} from './markdown/rehypeCommentableBlocks';

export interface CommentPluginOptions {
  enabled?: boolean;
  pageComments?: boolean;
  blockComments?: boolean;
  blockSelectorTags?: RehypeCommentableBlocksOptions['tags'];
  apiBase?: string;
  pageSize?: number;
  defaultAuthorName?: string;
  logto?: {
    endpoint: string;
    appId: string;
    callbackPath?: string;
    postSignOutRedirectUri?: string;
  };
}

export function pluginComments(options: CommentPluginOptions): RspressPlugin {
  const enabled = options.enabled !== false;
  const runtimeOptions = {
    ...options,
    enabled,
    pageComments: enabled && options.pageComments !== false,
    blockComments: enabled && options.blockComments !== false,
    apiBase: options.apiBase ?? 'http://localhost:4010',
    pageSize: options.pageSize ?? 20,
    defaultAuthorName: options.defaultAuthorName ?? 'Anonymous',
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
