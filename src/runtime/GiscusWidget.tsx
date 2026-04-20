import Giscus, { type GiscusProps } from '@giscus/react';
import {
  buildBaseGiscusProps,
  useIsDarkTheme,
  type RuntimeCommentOptions,
} from './shared';

interface GiscusWidgetProps {
  options: RuntimeCommentOptions;
  term: string;
  id: string;
}

export default function GiscusWidget({
  options,
  term,
  id,
}: GiscusWidgetProps) {
  const isDark = useIsDarkTheme();
  const baseProps = buildBaseGiscusProps(options, isDark);

  if (!baseProps) {
    return (
      <div className="hf-comments-placeholder">
        <strong>评论已挂载，但尚未配置 Giscus。</strong>
        <div>
          请设置 `GISCUS_REPO`、`GISCUS_REPO_ID`、`GISCUS_CATEGORY`、
          `GISCUS_CATEGORY_ID` 后重新启动站点。
        </div>
        <div className="hf-comments-placeholder-term">term: {term}</div>
      </div>
    );
  }

  const finalProps: GiscusProps = {
    ...baseProps,
    id,
    mapping: 'specific',
    term,
  };

  return <Giscus {...finalProps} />;
}
