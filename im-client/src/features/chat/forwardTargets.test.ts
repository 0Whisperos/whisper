import { describe, expect, it } from "vitest";
import { buildForwardTargets } from "./forwardTargets";
import { chatMockData } from "./mockData";

describe("forward targets", () => {
  it("merges contacts and direct conversations by conversation id and permits the original conversation", () => {
    // 测试目标：验证好友和已有会话按会话 ID 去重，原会话仍可作为目标。
    // 构造方法：克隆正式 mock，将一个好友复制到同一会话后生成目标。
    // 输入数据：好友和已有 direct 会话 10002、重复好友、其他 group 与 assistant 会话。
    // 预期行为：10002 只出现一次且可选，所有可选项都是已有 direct 会话。
    const data = structuredClone(chatMockData);
    const contact = data.contacts.find((item) => item.conversationId === 10002)!;
    data.contacts.push({ ...contact, id: "duplicate" });
    const targets = buildForwardTargets(data);
    expect(targets.filter((target) => target.conversationId === 10002)).toHaveLength(1);
    expect(targets.find((target) => target.conversationId === 10002)?.disabledReason).toBeUndefined();
    expect(targets.filter((target) => !target.disabledReason).every((target) => data.conversations[target.conversationId!].type === "direct")).toBe(true);
    expect(targets.some((target) => target.conversationId === 10005)).toBe(true);
  });

  it("keeps unavailable friends visible with a reason and handles an empty workspace", () => {
    // 测试目标：验证没有可用会话的好友禁用且说明原因，空数据不制造目标。
    // 构造方法：保留一个好友，先删除其会话 ID，再改成不存在的 ID，最后清空好友。
    // 输入数据：无 ID 好友、不存在会话 999，以及空好友/会话集合。
    // 预期行为：分别提示尚无可用会话、会话暂不可用，最终返回空数组。
    const data = structuredClone(chatMockData);
    data.sessions = []; data.conversations = {}; data.contacts = [{ ...data.contacts[0], conversationId: undefined }];
    expect(buildForwardTargets(data)[0]).toMatchObject({ conversationId: null, disabledReason: "好友尚无可用会话" });
    data.contacts[0].conversationId = 999;
    expect(buildForwardTargets(data)[0]).toMatchObject({ conversationId: 999, disabledReason: "会话暂不可用" });
    data.contacts = [];
    expect(buildForwardTargets(data)).toEqual([]);
  });
});
