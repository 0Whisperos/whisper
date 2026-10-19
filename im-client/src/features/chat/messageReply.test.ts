import { describe, expect, it } from "vitest";
import { replySummary, parseReplyTarget, isReplyMetadata } from "./messageReply";

describe("message replies", () => {
  it("summarizes the first nonempty text and counts images without splitting Unicode characters", () => {
    // 测试目标：验证引用摘要按 Unicode 字符截断并保留图片数量。
    // 构造方法：传入空段落、跨行长文本、两张图片和后续文字。
    // 输入数据：首段非空文字为 81 个 emoji，图片附件为 a、b。
    // 预期行为：摘要仅包含前 80 个完整 emoji，后附 [2张图片]。
    expect(replySummary({ blocks: [
      { type: "text", text: " \n " }, { type: "text", text: ` ${"😀".repeat(81)}\n` },
      { type: "image", attachment_id: "a" }, { type: "image", attachment_id: "b" },
      { type: "text", text: "不应选中后续文字" },
    ] })).toBe(`${"😀".repeat(80)} [2张图片]`);
    expect(replySummary({ text: " 第一行\n\t第二行 " })).toBe("第一行 第二行");
  });

  it("renders an image-only reference and parses shallow server targets", () => {
    // 测试目标：验证纯图引用及服务端浅层引用 DTO 的转换。
    // 构造方法：构造纯图目标并调用协议转换与摘要函数。
    // 输入数据：目标 original、发送者 2、单图片正文。
    // 预期行为：转换为客户端字段，摘要为 [图片]，不需要递归引用数据。
    const target = parseReplyTarget({ message_id: "original", sender_user_id: 2,
      message_type: "rich", content: { blocks: [{ type: "image", attachment_id: "a" }] } });
    expect(target).toMatchObject({ messageId: "original", senderUserId: 2, messageType: "rich" });
    expect(replySummary(target!.content)).toBe("[图片]");
  });

  it("accepts legacy messages and rejects malformed or mismatched reply metadata", () => {
    // 测试目标：验证旧消息兼容以及引用元数据的协议校验。
    // 构造方法：分别校验缺字段、空引用、非法目标正文与不匹配 ID。
    // 输入数据：旧消息空对象；reply_to_message_id=original；目标 ID=different。
    // 预期行为：旧消息与空引用有效，错误类型和目标不匹配均无效。
    expect(isReplyMetadata({})).toBe(true);
    expect(isReplyMetadata({ reply_to_message_id: null, reply_to: null })).toBe(true);
    expect(isReplyMetadata({ reply_to_message_id: 12 })).toBe(false);
    expect(isReplyMetadata({ reply_to: { message_id: "a", sender_user_id: 2, message_type: "text", content: {} } })).toBe(false);
    expect(isReplyMetadata({ reply_to_message_id: "original", reply_to: {
      message_id: "different", sender_user_id: 2, message_type: "text", content: { text: "原文" },
    } })).toBe(false);
  });
});
