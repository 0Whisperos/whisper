import type { ChatContentBlock } from "../types";

export function richMessageDisplayBlocks(blocks: readonly ChatContentBlock[]): ChatContentBlock[] {
  return blocks.flatMap((block, index): ChatContentBlock[] => {
    if (block.type !== "text" || blocks[index - 1]?.type !== "image") return [block];

    // Images already occupy their own row; consume only the first explicit line break after one.
    const text = block.text.replace(/^(?:\r\n|\n|\r)/, "");
    if (text === block.text) return [block];
    return text ? [{ ...block, text }] : [];
  });
}
