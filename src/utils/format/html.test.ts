import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToText } from "./html";

describe("htmlToText", () => {
  it("把块级标签转成换行而不是显示成标签原文", () => {
    const text = htmlToText("<p>第一段</p><p>第二段</p>");
    assert.equal(text, "第一段\n第二段");
  });

  it("br 转成换行，行内标签被剥离", () => {
    const text = htmlToText("前<br>后<em>强调</em><b>粗</b>");
    assert.equal(text, "前\n后强调粗");
  });

  it("解码常见 HTML 实体", () => {
    const text = htmlToText("Rock &amp; Roll &lt;live&gt; &quot;quoted&quot;&nbsp;end");
    assert.equal(text, 'Rock & Roll <live> "quoted" end');
  });

  it("列表项转成项目符号", () => {
    const text = htmlToText("<ul><li>一</li><li>二</li></ul>");
    assert.equal(text, "· 一\n· 二");
  });

  it("收敛多余空白，最多保留一个空行", () => {
    const text = htmlToText("<p>a</p>\n\n\n\n<p>b</p>");
    assert.equal(text, "a\n\nb");
  });

  it("处理真实 Qobuz 简介片段（不再出现标签原文）", () => {
    const raw =
      "<p>Neil Young has described his latest album as &quot;a rambling set of songs&quot;.</p><br><i>Second Song</i> finds the album&#39;s opener.<br><p>更多内容</p>";
    const text = htmlToText(raw) ?? "";
    assert.ok(!text.includes("<"), `不应残留标签: ${text}`);
    assert.ok(!text.includes("&quot;"), `不应残留实体: ${text}`);
    assert.ok(text.includes('"a rambling set of songs"'));
    assert.ok(text.includes("Second Song"));
  });

  it("空输入返回 undefined", () => {
    assert.equal(htmlToText(""), undefined);
    assert.equal(htmlToText(null), undefined);
    assert.equal(htmlToText(undefined), undefined);
    assert.equal(htmlToText("   "), undefined);
  });
});
