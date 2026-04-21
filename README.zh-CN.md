# rspress-plugin-comments

[English README](./README.md)

一个适用于 Rspress 的自托管评论插件，支持：

- 页面级评论，在文档页脚后统一展示
- Markdown 正文中的文本选区评论
- 页面底部的当前页评论聚合展示
- 可选的 Gitea OAuth 登录，用于获取用户身份、昵称和头像

这个仓库同时包含了插件运行时依赖的独立后端服务。

## 交互模型

- 页面评论会展示在每篇文档底部。
- 段落评论基于文本选区：用户选中文本后，可在附近打开评论面板。
- 已存在的选区评论在页面刷新后会恢复为行内高亮范围。
- 回复以会话线程形式展示，包含头像、作者名和时间戳。

## 安装

```bash
npm install rspress-plugin-comments
```

## 使用方式

```ts
import { defineConfig } from '@rspress/core';
import { pluginComments } from 'rspress-plugin-comments';

export default defineConfig({
  plugins: [
    pluginComments({
      apiBase: 'http://localhost:4010',
      pageComments: true,
      blockComments: true,
    }),
  ],
});
```

## 配置项

- `enabled`：是否启用插件，默认 `true`
- `pageComments`：是否启用整页评论，默认 `true`
- `blockComments`：是否启用选区评论，默认 `true`
- `blockSelectorTags`：覆盖默认可评论块的标签集合
- `apiBase`：后端 API 地址，默认 `http://localhost:4010`
- `pageSize`：每页根评论数量，默认 `20`
- `defaultAuthorName`：后端未开启认证时的默认作者名

## 后端

原始 Node.js 后端见 [backend/README.md](/Users/kalicyh/Documents/GitHub/rspress-plugin-comments/backend/README.md)。
Rust 重写版见 [backend-rust/README.md](/Users/kalicyh/Documents/GitHub/rspress-plugin-comments/backend-rust/README.md)。

当前后端提供：

- SQLite 存储
- 页面评论和选区评论接口
- 删除评论能力
- 基于 session 的登录态
- 可选的 Gitea OAuth 登录

## 说明

- 插件会为支持的 Markdown 块注入稳定的 `data-comment-id`
- 选区评论绑定在 `pagePath + blockId + 选中文本元数据`
- 当前视觉和交互更偏向 Rspress 文档站，而不是通用论坛场景
