import { describe, expect, it } from "vitest";

import type { ChatData, ChatMessage } from "../types";
import { formatHoverMessageTime, isCompactMessage, mergeOfficialMessage, sortTimelineMessages } from "./messageTimeline";

const selfUserId = 20001;

function createMessage(sequence: number, timestamp: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    localKey: `message-${sequence}`,
    messageId: `message-${sequence}`,
    conversationId: 42,
    conversationSeq: sequence,
    senderUserId: 20002,
    clientMessageId: `client-${sequence}`,
    messageType: "text",
    content: { text: `消息 ${sequence}` },
    createdAt: timestamp,
    clientSentAt: timestamp,
    localStatus: "accepted",
    displayTime: "",
    showTime: false,
    showAvatar: true,
    ...overrides,
  };
}

function createChatData(messages: ChatMessage[]): ChatData {
  return {
    self: { userId: selfUserId, account: "self", name: "我", avatar: "我", tone: "blue" },
    sessions: [{ id: "session-42", conversationId: 42, name: "周然", avatar: "周", tone: "orange", type: "direct", preview: "", time: "" }],
    conversations: {
      42: {
        conversationId: 42,
        type: "direct",
        name: "周然",
        avatar: "周",
        tone: "orange",
        status: "在线",
        participants: {},
        messages,
      },
    },
    contacts: [],
    contactSections: [],
  };
}

describe("message timeline time separators", () => {
  const now = new Date(2026, 8, 24, 12, 0, 0);

  it("shows a separator for the first message and gaps of at least ten minutes", () => {
    // 测试目标：验证首条消息以及达到十分钟的间隔显示居中时间，短于十分钟的间隔不显示。
    // 构造方法：按时间顺序构造四条消息，分别覆盖首条、599999 毫秒、600000 毫秒和 600001 毫秒。
    // 输入数据：09:00:00、09:09:59.999、09:19:59.999、09:30:00.000。
    // 预期行为：首条和恰好/超过十分钟的消息 showTime 为 true，短间隔消息为 false。
    const messages = sortTimelineMessages([
      createMessage(1, "2026-09-24T09:00:00.000+08:00"),
      createMessage(2, "2026-09-24T09:09:59.999+08:00"),
      createMessage(3, "2026-09-24T09:19:59.999+08:00"),
      createMessage(4, "2026-09-24T09:30:00.000+08:00"),
    ], now);

    expect(messages.map((message) => message.showTime)).toEqual([true, false, true, true]);
    expect(messages[2].displayTime).toMatch(/\d{2}:\d{2}/);
  });

  it("shows a date-only divider when a short gap crosses a local date", () => {
    // 测试目标：验证非今天的消息跨日期时显示日期标记，而不附加当天时间。
    // 构造方法：按运行环境本地时区创建午夜前后相隔四分钟的两条消息并整理时间线。
    // 输入数据：本地时间 2026-09-24 23:58 和 2026-09-25 00:02。
    // 预期行为：第二条消息只显示日期，不显示小时、分钟或秒。
    const messages = sortTimelineMessages([
      createMessage(1, new Date(2026, 8, 24, 23, 58).toISOString()),
      createMessage(2, new Date(2026, 8, 25, 0, 2).toISOString()),
    ], new Date(2026, 8, 29, 12, 0, 0));

    expect(messages[1].showTime).toBe(true);
    expect(messages[1].displayTime).toBe("9月25日");
    expect(messages[1].displayTime).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("formats center separators without unnecessary year or date", () => {
    // 测试目标：验证居中分隔根据固定的当前日期省略今天的日期和同年的年份。
    // 构造方法：以 2026-09-29 为当前日期，分别整理今天、同年其他日期及上一年的首条消息。
    // 输入数据：2026-09-29、2026-09-24、2025-09-24 本地 09:20 的消息。
    // 预期行为：今天只显示时分，同年显示月日，其他年份才显示年份，且都不显示秒。
    const reference = new Date(2026, 8, 29, 12, 0, 0);
    const formatFirst = (date: Date) => sortTimelineMessages([
      createMessage(1, date.toISOString()),
    ], reference)[0].displayTime;

    expect(formatFirst(new Date(2026, 8, 29, 9, 20))).toBe("09:20");
    expect(formatFirst(new Date(2026, 8, 24, 9, 20))).toBe("9月24日");
    expect(formatFirst(new Date(2025, 8, 24, 9, 20))).toBe("2025年9月24日");
  });

  it("shows only one date divider per historical day regardless of message gaps", () => {
    // 测试目标：验证非今天的消息按日期分隔，而不在同一天按十分钟重复显示。
    // 构造方法：将同一天相隔二十分钟和六小时的消息与次日消息放入同一时间线。
    // 输入数据：2026-09-20 的 10:00、10:20、16:00，以及 2026-09-21 的 09:00；当前日期为 09-29。
    // 预期行为：09-20 只在首条消息显示一次日期，09-21 开始新日期标记。
    const reference = new Date(2026, 8, 29, 12, 0, 0);
    const messages = sortTimelineMessages([
      createMessage(1, new Date(2026, 8, 20, 10, 0).toISOString()),
      createMessage(2, new Date(2026, 8, 20, 10, 20).toISOString()),
      createMessage(3, new Date(2026, 8, 20, 16, 0).toISOString()),
      createMessage(4, new Date(2026, 8, 21, 9, 0).toISOString()),
    ], reference);

    expect(messages.map((message) => message.showTime)).toEqual([true, false, false, true]);
    expect(messages.map((message) => message.displayTime)).toEqual(["9月20日", "", "", "9月21日"]);
  });

  it("groups today by ten minutes but groups historical messages by sender and date only", () => {
    // 测试目标：验证当天同发送者十分钟外分组，而历史同日消息忽略时间间隔。
    // 构造方法：使用固定的当前日期，比较当天短/长间隔、历史长间隔、跨日及发送者变化。
    // 输入数据：当天间隔五分钟和十分钟；历史同日间隔六小时；跨日四分钟；发送者不同。
    // 预期行为：当天只有不足十分钟的同发送者消息紧凑，历史同日同发送者即使相隔六小时仍紧凑。
    const today = new Date(2026, 8, 24, 12, 0, 0);
    const morning = createMessage(1, new Date(2026, 8, 24, 10, 0).toISOString());
    const beforeMidnight = createMessage(3, new Date(2026, 8, 24, 23, 58).toISOString());
    const historical = createMessage(4, new Date(2026, 8, 20, 10, 0).toISOString());

    expect(isCompactMessage(morning, createMessage(2, new Date(2026, 8, 24, 10, 5).toISOString()), today)).toBe(true);
    expect(isCompactMessage(morning, createMessage(2, new Date(2026, 8, 24, 10, 10).toISOString()), today)).toBe(false);
    expect(isCompactMessage(historical, createMessage(5, new Date(2026, 8, 20, 16, 0).toISOString()), today)).toBe(true);
    expect(isCompactMessage(beforeMidnight, createMessage(6, new Date(2026, 8, 25, 0, 2).toISOString()), today)).toBe(false);
    expect(isCompactMessage(morning, createMessage(2, new Date(2026, 8, 24, 10, 5).toISOString(), { senderUserId: 20003 }), today)).toBe(false);
  });

  it("recomputes separators after older history is inserted", () => {
    // 测试目标：验证历史分页插入更早消息后，排序和相邻间隔会共同重新计算。
    // 构造方法：先整理两条较新的消息，再将一条旧消息加入同一批时间线重新排序。
    // 输入数据：10:00 和 10:06 原本相邻；加入 09:45 后，10:00 与前一条相隔十五分钟。
    // 预期行为：结果按时间排序，首条与 10:00 显示分隔，10:06 隐藏分隔。
    const beforePage = sortTimelineMessages([
      createMessage(2, "2026-09-24T10:00:00+08:00"),
      createMessage(3, "2026-09-24T10:06:00+08:00"),
    ], now);
    expect(beforePage.map((message) => message.showTime)).toEqual([true, false]);

    const afterPage = sortTimelineMessages([
      ...beforePage,
      createMessage(1, "2026-09-24T09:45:00+08:00"),
    ], now);

    expect(afterPage.map((message) => message.conversationSeq)).toEqual([1, 2, 3]);
    expect(afterPage.map((message) => message.showTime)).toEqual([true, true, false]);
  });

  it("recomputes separators when a real-time message fills a sequence gap", () => {
    // 测试目标：验证实时消息合并到时间线中间后，相邻消息的居中分隔会重新计算。
    // 构造方法：先放入序号 1 和 3 的消息，再通过 mergeOfficialMessage 插入序号 2。
    // 输入数据：序号 1 为 10:00、序号 3 为 10:20，新消息序号 2 为 10:15。
    // 预期行为：序号 2 因首条/长间隔显示时间，序号 3 与其仅隔五分钟而隐藏时间。
    const currentDate = new Date();
    const todayAt = (minute: number) => new Date(
      currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 10, minute,
    ).toISOString();
    const initial = createChatData([
      createMessage(1, todayAt(0)),
      createMessage(3, todayAt(20)),
    ]);
    const merged = mergeOfficialMessage(initial, {
      message_id: "message-2",
      conversation_id: 42,
      conversation_seq: 2,
      sender_user_id: 20002,
      client_message_id: "client-2",
      message_type: "text",
      content: { text: "消息 2" },
      created_at: todayAt(15),
    });

    expect(merged.conversations[42].messages.map((message) => message.showTime)).toEqual([true, true, false]);
  });

  it("uses client time for pending messages and omits invalid timestamps", () => {
    // 测试目标：验证待发送消息使用客户端时间参与分组，非法时间不会产生错误的显示值。
    // 构造方法：分别整理一条 createdAt 为空的待发送消息和一条时间格式无效的消息。
    // 输入数据：待发送消息 clientSentAt=10:00、后续消息 10:05；无效消息时间为 not-a-date。
    // 预期行为：待发送消息是首条并显示 10:00，五分钟后的消息不显示；非法时间不显示时间分隔。
    const pending = createMessage(1, "2026-09-24T10:00:00+08:00", {
      messageId: null,
      conversationSeq: null,
      createdAt: null,
      clientSentAt: "2026-09-24T10:00:00+08:00",
      localStatus: "sending",
    });
    const pendingTimeline = sortTimelineMessages([pending], now);
    const invalidTimeline = sortTimelineMessages([createMessage(3, "not-a-date")], now);

    expect(pendingTimeline[0]).toMatchObject({ showTime: true, displayTime: expect.stringMatching(/\d{2}:\d{2}/) });
    expect(invalidTimeline[0]).toMatchObject({ showTime: false, displayTime: "" });
    expect(formatHoverMessageTime("not-a-date", true, now)).toBeNull();
  });

  it("formats today, same-year, and other-year hover timestamps by context", () => {
    // 测试目标：验证完整悬浮时间按当前本地日期省略不必要的年月日，并保留秒。
    // 构造方法：固定当前时间为 2026-09-29，分别格式化今天、同年更早日期及上一年的消息。
    // 输入数据：2026-09-29、2026-09-24、2025-09-24 的本地 10:47:59。
    // 预期行为：今天只显示时分秒，同年显示月日与时分秒，其他年份再带年份。
    const reference = new Date(2026, 8, 29, 12, 0, 0);
    const today = new Date(2026, 8, 29, 10, 47, 59);
    const sameYear = new Date(2026, 8, 24, 10, 47, 59);
    const otherYear = new Date(2025, 8, 24, 10, 47, 59);

    expect(formatHoverMessageTime(today.toISOString(), true, reference)).toBe("10:47:59");
    expect(formatHoverMessageTime(sameYear.toISOString(), true, reference)).toBe("9月24日 10:47:59");
    expect(formatHoverMessageTime(otherYear.toISOString(), true, reference)).toBe("2025年9月24日 10:47:59");
    expect(formatHoverMessageTime(sameYear.toISOString(), false, reference)).toBe("10:47:59");
  });
});
