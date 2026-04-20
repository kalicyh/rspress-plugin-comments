# rspress-plugin-comments

Rspress plugin for:

- page-level comments rendered at the end of each document
- block-level comments opened in a drawer from headings, paragraphs, list items, and blockquotes

The plugin uses Giscus as the discussion backend and generates stable block terms from each page's content.

## Install

```bash
pnpm add rspress-plugin-comments
```

## Usage

```ts
import { defineConfig } from '@rspress/core';
import { pluginComments } from 'rspress-plugin-comments';

export default defineConfig({
  plugins: [
    pluginComments({
      repo: process.env.GISCUS_REPO,
      repoId: process.env.GISCUS_REPO_ID,
      category: process.env.GISCUS_CATEGORY,
      categoryId: process.env.GISCUS_CATEGORY_ID,
      pageComments: true,
      blockComments: true,
      termPrefix: 'docs',
    }),
  ],
});
```

## Options

- `enabled`: Enable or disable the plugin. Defaults to `true`.
- `repo`: Giscus GitHub repository in `owner/name` format.
- `repoId`: Giscus repository id.
- `category`: Giscus discussion category name.
- `categoryId`: Giscus discussion category id.
- `lang`: Giscus UI language. Defaults to `zh-CN`.
- `pageComments`: Enable full page comments. Defaults to `true`.
- `blockComments`: Enable block comments. Defaults to `true`.
- `blockSelectorTags`: Override the set of commentable HTML tags.
- `termPrefix`: Prefix added to every Giscus term.
- `inputPosition`: `top` or `bottom`. Defaults to `bottom`.

## Notes

- Without Giscus configuration, the plugin renders a placeholder so the UI can still be verified locally.
- Block terms use `pathname#blockId`.
- Page terms use `pathname`.
