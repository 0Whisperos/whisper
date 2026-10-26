import { describe, expect, it } from "vitest";
import { canRecallMessage, mergeRecallStatuses, rememberDataRecalls } from "./messageRecall";
import { mergeOfficialMessage } from "./hooks/messageTimeline";
import { recalledAt, recallData, recallMessage } from "./tests/recallFixtures";

describe("monotonic recall facts", () => {
  it("retains unknown-message terminal state without creating rows or changing cursors", () => {
    // 测试目标：验证未加载目标只记录撤回终态，不插入占位或推进游标。
    // 构造方法：空消息数组收到撤回，随后合并撤回前产生的旧创建/历史正文。
    // 输入数据：会话42、消息old、recalled_at非空及迟到recalled_at=null。
    // 预期行为：开始无行，迟到正文按原结构保留且展示状态仍撤回，游标不变。
    let data = mergeRecallStatuses(recallData([]), 42, [{ message_id: "old", recalled_at: recalledAt }]);
    expect(data.conversations[42].messages).toEqual([]);
    expect(data.conversations[42]).toMatchObject({ lastSeq: 9, deliveredSeq: 8, readSeq: 7 });
    const incoming = { message_id: "old", conversation_id: 42, conversation_seq: 1, sender_user_id: 1,
      client_message_id: "c", message_type: "text" as const, content: { text: "原文" }, created_at: "2020-01-01", recalled_at: null };
    data = mergeOfficialMessage(data, incoming);
    data = mergeOfficialMessage(data, incoming);
    expect(data.conversations[42].messages).toHaveLength(1);
    expect(data.conversations[42].messages[0]).toMatchObject({ recalledAt, content: { text: "原文" } });
  });
  it("updates already loaded bodies, all shallow references and the session preview", () => {
    // 测试目标：验证撤回统一更新消息与引用展示，保留全部正文。
    // 构造方法：创建原文和回复，再通过旧历史消息的recalled_at合并撤回。
    // 输入数据：m被n引用，m为当前最后一条，重复空状态随后到达。
    // 预期行为：m与引用都有撤回时间，正文不变，会话预览隐藏原文，重复null不恢复。
    const source = recallMessage();
    let data = recallData([recallMessage("n", { replyTo: { messageId: "m", senderUserId: 1, messageType: "text", content: source.content } }), source]);
    data = mergeOfficialMessage(data, { message_id: "m", conversation_id: 42, conversation_seq: 1, sender_user_id: 1,
      client_message_id: source.clientMessageId, message_type: "text", content: source.content, created_at: source.createdAt!, recalled_at: recalledAt });
    data = mergeRecallStatuses(data, 42, [{ message_id: "m", recalled_at: null }]);
    expect(data.conversations[42].messages[0].replyTo).toMatchObject({ recalledAt, content: source.content });
    expect(data.conversations[42].messages[1].content).toEqual(source.content);
    expect(data.sessions[0].preview).toBe("你撤回了一条消息");
  });
  it("restores remembered facts across data replacement and limits recall to accepted own messages", () => {
    // 测试目标：验证同账号数据重建保留撤回事实，权限只允许本人正式accepted消息。
    // 构造方法：将旧数据事实收集到独立map，再归一化重建后的活动正文。
    // 输入数据：m已撤回、其他发送者、sending、failed及缺正式ID消息。
    // 预期行为：重建m仍撤回；只有本人旧accepted消息允许撤回，不限制创建年份。
    const states = {};
    rememberDataRecalls(recallData([recallMessage("m", { recalledAt })]), states);
    expect(rememberDataRecalls(recallData(), states).conversations[42].messages[0].recalledAt).toBe(recalledAt);
    expect(canRecallMessage(recallMessage(), 1)).toBe(true);
    for (const message of [recallMessage("m", { senderUserId: 2 }), recallMessage("m", { localStatus: "sending" }),
      recallMessage("m", { localStatus: "failed" }), recallMessage("m", { messageId: null }), recallMessage("m", { recalledAt })]) {
      expect(canRecallMessage(message, 1)).toBe(false);
    }
  });
});
