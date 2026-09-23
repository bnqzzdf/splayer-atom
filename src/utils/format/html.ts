/**
 * 富文本简介 → 可读纯文本
 *
 * 为什么需要：Qobuz 的 `description`（专辑/歌单简介）是 HTML，
 * 形如 `<p>...<em>Second Song</em>...</p><br><i>...</i>`；
 * TIDAL / 网易云等平台的描述字段也可能带标签。
 *
 * 为什么不用 `v-html`：这些字符串来自第三方 API，直接注入 DOM 会引入 XSS 面，
 * 且项目现有代码没有任何 `v-html` 用法。这里改成「保留可读结构、丢弃标签」，
 * 渲染侧继续用纯文本插值，既安全又能正常显示段落。
 *
 * 转换规则：
 *   - `<br>` 与块级结束标签（`</p>`/`</div>`/`</li>`/标题/`</tr>`）→ 换行
 *   - `<li>` → 行首「· 」
 *   - 其余标签一律剥离
 *   - 常见 HTML 实体解码（`&amp;` 等）
 *   - 收敛多余空白，最多保留一个空行
 *
 * @param input - 可能含 HTML 标签的原始文本
 * @returns 纯文本；输入为空时返回 undefined
 */
export const htmlToText = (input?: string | null): string | undefined => {
  if (!input) return undefined;

  const text = input
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|tr|blockquote)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "· ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || undefined;
};
