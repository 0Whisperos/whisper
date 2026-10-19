export const MAX_CLIPBOARD_HTML_BYTES = 72 * 1024 * 1024;
export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_CLIPBOARD_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
export type ClipboardContentBlock = { type: "text"; text: string } | { type: "image"; file: File };

export function assertClipboardHtmlSize(html: string): void {
  if (html.length > MAX_CLIPBOARD_HTML_BYTES || new TextEncoder().encode(html).length > MAX_CLIPBOARD_HTML_BYTES) {
    throw new Error("clipboard_content_too_large");
  }
}

/** Parse in an inert template: no remote requests, executable DOM or second parsing of source code. */
export function parseClipboardHtml(html: string): ClipboardContentBlock[] {
  assertClipboardHtmlSize(html);
  const template = document.createElement("template");
  template.innerHTML = html;
  const blocks: ClipboardContentBlock[] = [];
  let imageBytes = 0;
  let imageCount = 0;
  const text = (value: string) => {
    if (!value) return;
    const last = blocks.at(-1);
    if (last?.type === "text") last.text += value;
    else blocks.push({ type: "text", text: value });
  };
  const image = (node: Element) => {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(node.getAttribute("src") ?? "");
    if (!match) return;
    if (match[2].length > Math.ceil(MAX_CLIPBOARD_IMAGE_BYTES / 3) * 4) throw new Error("clipboard_content_too_large");
    let binary: string;
    try { binary = atob(match[2]); } catch { return; }
    if (!binary.length) return;
    imageBytes += binary.length;
    imageCount += 1;
    if (binary.length > MAX_CLIPBOARD_IMAGE_BYTES || imageBytes > MAX_CLIPBOARD_TOTAL_IMAGE_BYTES || imageCount > 10) {
      throw new Error("clipboard_content_too_large");
    }
    const type = match[1].toLowerCase();
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    blocks.push({ type: "image", file: new File([bytes], `pasted-${imageCount}.${type === "image/jpeg" ? "jpg" : type.slice(6)}`, { type }) });
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { text(node.textContent ?? ""); return; }
    if (!(node instanceof Element)) { node.childNodes.forEach(walk); return; }
    const tag = node.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "SVG", "MATH"].includes(tag)) return;
    if (tag === "PRE" || tag === "CODE") { text(node.textContent ?? ""); return; }
    if (tag === "IMG") { image(node); return; }
    if (tag === "BR") { text("\n"); return; }
    const line = ["P", "DIV", "LI", "H1", "H2", "H3", "BLOCKQUOTE"].includes(tag);
    if (line && blocks.length && !(blocks.at(-1)?.type === "text" && (blocks.at(-1) as { text: string }).text.endsWith("\n"))) text("\n");
    node.childNodes.forEach(walk);
    if (line) text("\n");
  };
  const own = template.content.querySelector('[data-whisper-message-version="1"]');
  if (own && !own.closest("pre,code")) {
    for (const node of own.children) {
      if (node.matches('p[data-whisper-block="text"]')) text(node.textContent ?? "");
      else if (node.matches('img[data-whisper-block="image"]')) image(node);
    }
  } else {
    template.content.childNodes.forEach(walk);
    const last = blocks.at(-1);
    if (last?.type === "text" && last.text.endsWith("\n")) last.text = last.text.slice(0, -1);
  }
  return blocks.filter((block) => block.type !== "text" || block.text.length > 0);
}
