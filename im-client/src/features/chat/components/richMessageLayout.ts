import type { ChatContentBlock } from "../types";

export function richMessageDisplayBlocks(blocks: readonly ChatContentBlock[]): ChatContentBlock[] {
  return richMessageDisplayBlocksWithIndexes(blocks).map(({ block }) => block);
}

export function richMessageDisplayBlocksWithIndexes(blocks: readonly ChatContentBlock[]): { block: ChatContentBlock; blockIndex: number }[] {
  return blocks.flatMap((block, blockIndex) => {
    if (block.type !== "text" || blocks[blockIndex - 1]?.type !== "image") return [{ block, blockIndex }];

    // Images already occupy their own row; consume only the first explicit line break after one.
    const text = block.text.replace(/^(?:\r\n|\n|\r)/, "");
    if (text === block.text) return [{ block, blockIndex }];
    return text ? [{ block: { ...block, text }, blockIndex }] : [];
  });
}
