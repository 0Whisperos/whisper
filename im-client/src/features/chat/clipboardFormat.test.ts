import { describe, expect, it } from "vitest";
import { parseClipboardHtml } from "./clipboardFormat";

describe("clipboard HTML", () => {
  it("restores actual ordered Whisper blocks and decodes allowed embedded images", () => {
    // 测试目标：恢复中文、换行和图片的真实 DOM 顺序。
    // 构造方法：解析版本 1 的两段文字及内嵌 PNG，再检查有序结果。
    // 输入数据：前<&、换行、AQID 图片和后文字。
    // 预期行为：文字精确保留且图片转换成 File，顺序不变。
    const blocks = parseClipboardHtml('<div data-whisper-message-version="1"><p data-whisper-block="text">前&lt;&amp;\n行</p><img data-whisper-block="image" src="data:image/png;base64,AQID"/><p data-whisper-block="text">后</p></div>');
    expect(blocks.map((block) => block.type)).toEqual(["text", "image", "text"]);
    expect(blocks[0]).toEqual({ type: "text", text: "前<&\n行" });
    expect(blocks[1]).toEqual({ type: "image", file: expect.objectContaining({ type: "image/png", size: 3 }) });
    expect(blocks[2]).toEqual({ type: "text", text: "后" });
  });

  it("keeps escaped HTML source in code blocks as text without parsing it again", () => {
    // 测试目标：网页代码块复制得到 HTML 源码文字，不能变成消息图片。
    // 构造方法：解析含实体转义源码的 pre/code 结构。
    // 输入数据：源码包含 div、img 和 data URL。
    // 预期行为：返回完整源码文字，不生成图片 File。
    const source = '<div><img src="data:image/png;base64,AQID"></div>';
    expect(parseClipboardHtml(`<pre><code>&lt;div&gt;&lt;img src="data:image/png;base64,AQID"&gt;&lt;/div&gt;</code></pre>`))
      .toEqual([{ type: "text", text: source }]);
  });

  it("ignores scripts, styles, remote images and handlers while retaining visible text", () => {
    // 测试目标：外部 HTML 仅转换可见文字和允许的本地图像。
    // 构造方法：解析带脚本、样式、远程图与事件属性的段落。
    // 输入数据：文字前后、https 图片和 PNG data URL。
    // 预期行为：不保留脚本或远程 URL，文字和本地图像按原顺序恢复。
    const blocks = parseClipboardHtml('<p onclick="evil()">前<script>evil()</script><style>bad</style><img src="https://x/1"><img src="data:image/png;base64,AQID" onerror="evil()">后</p>');
    expect(blocks.map((block) => block.type)).toEqual(["text", "image", "text"]);
    expect(blocks[0]).toEqual({ type: "text", text: "前" });
    expect(blocks[2]).toEqual({ type: "text", text: "后" });
  });

  it("keeps multiple inline image formats in sequence and rejects excess image counts", () => {
    // 测试目标：多图保序且支持的 MIME 白名单与数量上限一致。
    // 构造方法：依次解析 JPEG、PNG、WebP，再构造 11 张内嵌 PNG。
    // 输入数据：三种 MIME 的 AQID data URL 和超限图片数组。
    // 预期行为：三图类型与顺序不变，第 11 张图触发稳定超限错误。
    const images = ["jpeg", "png", "webp"].map((type) => `<img src="data:image/${type};base64,AQID">`).join("");
    expect(parseClipboardHtml(images).map((block) => block.type === "image" ? block.file.type : "text"))
      .toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(() => parseClipboardHtml('<img src="data:image/png;base64,AQID">'.repeat(11))).toThrow("clipboard_content_too_large");
  });
});
