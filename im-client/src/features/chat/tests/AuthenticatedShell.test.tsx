import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedShell } from "../components/AuthenticatedShell";
import { chatMockData } from "../mockData";
import type { ChatData } from "../types";

interface RenderShellOptions {
  canSendMessages?: boolean;
  onSendText?: (conversationId: number, text: string) => boolean | void;
  onRetryMessage?: (clientMessageId: string) => void;
}

function renderShell({ canSendMessages, onSendText, onRetryMessage }: RenderShellOptions = {}) {
  return render(
    <AuthenticatedShell
      data={chatMockData}
      connectionLabel="聊天连接在线：connection-uuid"
      canSendMessages={canSendMessages}
      isLoggingOut={false}
      onLogout={() => undefined}
      onSendText={onSendText}
      onRetryMessage={onRetryMessage}
    />,
  );
}

function renderShellWithData(data: ChatData) {
  return render(
    <AuthenticatedShell
      data={data}
      connectionLabel="聊天连接在线：connection-uuid"
      isLoggingOut={false}
      onLogout={() => undefined}
    />,
  );
}

function noFriendsData(): ChatData {
  return {
    ...structuredClone(chatMockData),
    sessions: [],
    conversations: {},
    contacts: [],
    contactSections: [],
  };
}

afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  window.localStorage.clear();
});

describe("AuthenticatedShell", () => {
  it("shows the empty session message and leaves the chat area blank when there are no friends", () => {
    // 测试目标：验证没有好友和会话时显示会话空态，并移除聊天标题、消息和编辑区。
    // 构造方法：用空 sessions、conversations、contacts 渲染已登录工作台。
    // 输入数据：当前用户资料保留，好友、会话和会话数据均为空。
    // 预期行为：会话列表显示“暂时没有新消息”，右侧只有空白区域，没有聊天面板或消息输入框。
    renderShellWithData(noFriendsData());

    expect(screen.getByText("暂时没有新消息")).toBeInTheDocument();
    expect(screen.getByLabelText("空白聊天区域")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "聊天详情" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("消息列表")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("输入消息")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送消息" })).not.toBeInTheDocument();
  });

  it("keeps contact shortcuts and shows the empty friend message instead of a fake profile", async () => {
    // 测试目标：验证无好友时仅替换右侧联系人资料，保留左侧系统入口。
    // 构造方法：用空联系人数据渲染工作台并切换到好友视图。
    // 输入数据：联系人与分组为空，好友页的添加好友和系统入口仍由组件提供。
    // 预期行为：资料区域中央显示“当前没有好友”，不显示头像、资料字段或发消息按钮。
    const user = userEvent.setup();
    renderShellWithData(noFriendsData());
    await user.click(screen.getAllByRole("button", { name: "好友" })[0]);

    expect(screen.getByText("当前没有好友")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加好友" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新的朋友" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "群聊" })).toBeInTheDocument();
    expect(screen.queryByText(/^备注：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^账号：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^地区：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^状态：/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发消息" })).not.toBeInTheDocument();
  });

  it("keeps the no-friends message available in the narrow contacts view", async () => {
    // 测试目标：验证窄屏下切换到好友视图仍呈现无好友提示。
    // 构造方法：将视口设为 320px，渲染无好友工作台并点击好友导航。
    // 输入数据：320px 窄屏，contacts 为空。
    // 预期行为：工作台切换到 contacts 面板，页面显示“当前没有好友”。
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    const user = userEvent.setup();
    const { container } = renderShellWithData(noFriendsData());
    const shell = container.querySelector(".auth-shell");

    await user.click(screen.getAllByRole("button", { name: "好友" })[0]);

    expect(shell).toHaveAttribute("data-mobile-panel", "contacts");
    expect(screen.getByText("当前没有好友")).toBeInTheDocument();
  });

  it("switches conversations and renders representative mock session states", async () => {
    // 测试目标：验证会话列表呈现 mock 数据状态，并可切换到另一会话。
    // 构造方法：渲染聊天工作台，检查代表性会话与状态文本后点击周然会话。
    // 输入数据：默认 mock 数据中的文件传输助手、家庭群、周然、陈默和周然会话。
    // 预期行为：界面显示置顶/@我/草稿/免打扰等状态，切换后标题与消息变为周然。
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByRole("button", { name: /文件传输助手/ })).toHaveTextContent("置顶");
    expect(screen.getByRole("button", { name: /家庭群/ })).toHaveTextContent("@我");
    expect(screen.getByRole("button", { name: /周然 收到，明天同步/ })).toHaveTextContent("草稿");
    expect(screen.getByRole("button", { name: /陈默/ })).toHaveTextContent("免打扰");

    await user.click(screen.getByRole("button", { name: /周然 收到，明天同步/ }));

    expect(screen.getByRole("heading", { level: 1, name: "周然" })).toBeInTheDocument();
    expect(screen.getByText("明天十点同步可以吗？")).toBeInTheDocument();
  });

  it("opens a contact profile and enters its conversation", async () => {
    // 测试目标：验证通讯录可选择联系人，并通过资料页进入关联会话。
    // 构造方法：渲染工作台，切到好友视图，选择周然联系人并点击发消息。
    // 输入数据：联系人 zhouran，关联 conversationId=10005。
    // 预期行为：资料页显示账号/地区/状态，点击发消息后打开周然聊天。
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getAllByRole("button", { name: "好友" })[0]);
    await user.click(screen.getByRole("button", { name: /周然 手机在线/ }));

    expect(screen.getByText("账号：zhouran")).toBeInTheDocument();
    expect(screen.getByText("地区：深圳")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发消息" }));

    expect(screen.getByRole("heading", { level: 1, name: "周然" })).toBeInTheDocument();
    expect(screen.getByText("可以，我会准备好。")).toBeInTheDocument();
  });

  it("submits trimmed text and clears the current conversation draft after acceptance", async () => {
    // 测试目标：验证已认证时发送按钮提交裁剪后的文本，并在数据层接受提交后清空当前草稿。
    // 构造方法：渲染带可观察发送回调的工作台，输入带首尾空格的正文并点击发送按钮。
    // 输入数据：当前会话 10002 的文本“  测试发送  ”。
    // 预期行为：回调收到会话 10002 和“测试发送”，输入框清空，且不保留预览提示。
    const user = userEvent.setup();
    const onSendText = vi.fn(() => true);
    renderShell({ canSendMessages: true, onSendText });
    const input = screen.getByLabelText("输入消息");
    const send = screen.getByRole("button", { name: "发送消息" });

    await user.type(input, "   ");
    expect(send).toBeDisabled();
    await user.clear(input);
    await user.type(input, "  测试发送  ");
    expect(send).toBeEnabled();
    await user.click(send);

    expect(onSendText).toHaveBeenCalledWith(10002, "测试发送");
    expect(input).toHaveValue("");
    expect(screen.queryByText("发送仅作界面预览")).not.toBeInTheDocument();
  });

  it("keeps sending disabled while the chat connection is not authenticated", async () => {
    // 测试目标：验证未认证连接不会暴露可用的发送操作，即使当前草稿包含正文。
    // 构造方法：渲染未传入连接发送权限的工作台，在输入框中填写文本。
    // 输入数据：正文“等待连接”。
    // 预期行为：发送按钮保持禁用，且发送回调不会被调用。
    const user = userEvent.setup();
    const onSendText = vi.fn(() => true);
    renderShell({ onSendText });

    await user.type(screen.getByLabelText("输入消息"), "等待连接");

    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("renders a pending local message as sending", () => {
    // 测试目标：验证尚未收到服务端确认的己方消息向用户显示发送中状态。
    // 构造方法：复制 mock 数据并在当前会话追加 localStatus 为 sending 的临时消息。
    // 输入数据：client_message_id=client-pending-1、正文“正在发送”。
    // 预期行为：消息正文与带“发送中”标签的状态同时出现在消息列表中。
    const data = structuredClone(chatMockData);
    data.conversations[10002].messages.push({
      localKey: "local:client-pending-1",
      messageId: null,
      conversationId: 10002,
      conversationSeq: null,
      senderUserId: 20001,
      clientMessageId: "client-pending-1",
      messageType: "text",
      content: { text: "正在发送" },
      createdAt: null,
      clientSentAt: "2026-08-30T12:00:00+08:00",
      localStatus: "sending",
      displayTime: "12:00",
      showTime: false,
      showAvatar: true,
    });

    render(
      <AuthenticatedShell
        data={data}
        connectionLabel="聊天连接在线：connection-uuid"
        canSendMessages
        isLoggingOut={false}
        onLogout={() => undefined}
        onSendText={() => true}
      />,
    );

    expect(screen.getByText("正在发送")).toBeInTheDocument();
    expect(screen.getByLabelText("发送中")).toBeInTheDocument();
  });

  it("renders failed messages with a retry action that preserves their client message identity", async () => {
    // 测试目标：验证失败的本地消息提示发送失败，并把原 client_message_id 交给重试回调。
    // 构造方法：复制 mock 数据并在当前会话追加一条失败的己方临时消息，然后点击其重试按钮。
    // 输入数据：client_message_id=client-failed-1、正文“需要重试”、错误码 network_error。
    // 预期行为：界面显示发送失败和重试按钮，点击后回调只收到 client-failed-1。
    const user = userEvent.setup();
    const onRetryMessage = vi.fn();
    const data = structuredClone(chatMockData);
    data.conversations[10002].messages.push({
      localKey: "local:client-failed-1",
      messageId: null,
      conversationId: 10002,
      conversationSeq: null,
      senderUserId: 20001,
      clientMessageId: "client-failed-1",
      messageType: "text",
      content: { text: "需要重试" },
      createdAt: null,
      clientSentAt: "2026-08-30T12:00:00+08:00",
      localStatus: "failed",
      errorCode: "network_error",
      displayTime: "12:00",
      showTime: false,
      showAvatar: true,
    });

    render(
      <AuthenticatedShell
        data={data}
        connectionLabel="聊天连接在线：connection-uuid"
        canSendMessages
        isLoggingOut={false}
        onLogout={() => undefined}
        onSendText={() => true}
        onRetryMessage={onRetryMessage}
      />,
    );

    expect(screen.getByText("需要重试")).toBeInTheDocument();
    expect(screen.getByLabelText("发送失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetryMessage).toHaveBeenCalledWith("client-failed-1");
  });

  it("stores drafts independently for each conversation", async () => {
    // 测试目标：验证不同会话的输入草稿互不覆盖，并保留纯空白草稿原文。
    // 构造方法：在林晓输入空白草稿，切换到周然输入正文，再往返两个会话。
    // 输入数据：林晓草稿为三个空格，周然草稿为“同步草稿”。
    // 预期行为：两个会话各自恢复原文，林晓空白草稿恢复后发送仍禁用。
    const user = userEvent.setup();
    renderShell({ canSendMessages: true });
    const input = screen.getByLabelText("输入消息");
    const send = screen.getByRole("button", { name: "发送消息" });

    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: /周然 收到，明天同步/ }));
    await user.type(input, "同步草稿");
    await user.click(screen.getByRole("button", { name: /林晓 晚饭回家吃吗/ }));

    expect(input).toHaveValue("   ");
    expect(send).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /周然 收到，明天同步/ }));
    expect(input).toHaveValue("同步草稿");
    expect(send).toBeEnabled();
  });

  it("shows preview feedback for tools without filtering mock sessions", async () => {
    // 测试目标：验证搜索和工具入口只更新当前可见反馈区，不改变 mock 会话数据。
    // 构造方法：记录会话行数量，输入搜索文本并点击截图和设置入口。
    // 输入数据：搜索文本“不存在的联系人”、截图工具和功能栏设置。
    // 预期行为：会话数量不变，搜索/截图/设置分别显示仅作界面预览反馈。
    const user = userEvent.setup();
    renderShell();
    const sessionRegion = screen.getByRole("region", { name: "会话" });
    const initialSessionRows = within(sessionRegion).getAllByRole("button").length;

    await user.type(screen.getByLabelText("搜索会话"), "不存在的联系人");
    expect(within(sessionRegion).getAllByRole("button")).toHaveLength(initialSessionRows);
    expect(screen.getByText("搜索仅作界面预览")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "截图" }));
    expect(screen.getByText("截图仅作界面预览")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText("设置仅作界面预览")).toBeInTheDocument();
  });

  it("renders compact group messages and receipts", async () => {
    // 测试目标：验证群聊连续同一发送者只重复正文，不重复发送者名，并显示己方回执。
    // 构造方法：切换到产品讨论组，查询消息正文、发送者标签和回执。
    // 输入数据：产品讨论组中周然连续两条消息和己方已读消息。
    // 预期行为：两条正文都存在，发送者“周然”只作为标签出现一次，己方消息显示已读。
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /产品讨论组/ }));

    expect(screen.getByText(/12 位成员/)).toBeInTheDocument();
    const messageList = screen.getByLabelText("消息列表");
    expect(within(messageList).getByText(/版本说明已更新/)).toBeInTheDocument();
    expect(within(messageList).getByText("截图也放到共享文件夹了。")).toBeInTheDocument();
    expect(within(messageList).getAllByText("周然")).toHaveLength(1);
    expect(screen.getByLabelText("已读")).toBeInTheDocument();
  });

  it("closes dialogs with Escape and restores focus to the trigger", async () => {
    // 测试目标：验证账号菜单和会话详情弹层公开正确 ARIA，并支持 Escape 关闭和焦点归还。
    // 构造方法：分别打开账号菜单与会话详情，检查 aria-expanded 后发送 Escape。
    // 输入数据：账号与设置按钮、会话详情按钮和 Escape 键。
    // 预期行为：两个弹层关闭后 aria-expanded=false，焦点回到对应触发器。
    const user = userEvent.setup();
    renderShell();
    const accountTrigger = screen.getAllByRole("button", { name: "账号与设置" })[0];

    await user.click(accountTrigger);
    expect(accountTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "账号与设置" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(accountTrigger).toHaveAttribute("aria-expanded", "false");
    expect(accountTrigger).toHaveFocus();

    const detailTrigger = screen.getByRole("button", { name: "会话详情" });
    await user.click(detailTrigger);
    expect(detailTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "会话详情" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(detailTrigger).toHaveAttribute("aria-expanded", "false");
    expect(detailTrigger).toHaveFocus();
  });

  it("closes conversation detail when selecting another view from the keyboard", async () => {
    // 测试目标：验证键盘切换消息/好友视图时会收起会话详情弹层，并保持页面 landmark 清晰。
    // 构造方法：渲染工作台，打开会话详情，把焦点移动到好友导航按钮后用 Enter 激活。
    // 输入数据：会话详情按钮、好友导航按钮和键盘 Enter。
    // 预期行为：会话详情 dialog 从可访问树消失，好友视图打开，页面只暴露一个 main landmark。
    const user = userEvent.setup();
    renderShell();

    const detailTrigger = screen.getByRole("button", { name: "会话详情" });
    await user.click(detailTrigger);
    expect(screen.getByRole("dialog", { name: "会话详情" })).toBeInTheDocument();

    const contactsNav = screen.getAllByRole("button", { name: "好友" })[0];
    contactsNav.focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("dialog", { name: "会话详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "好友" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("follows the mobile single-panel flow", async () => {
    // 测试目标：验证窄屏下会话、聊天、通讯录、联系人详情按单面板流程切换。
    // 构造方法：把 innerWidth 设为 320 后渲染，依次选择会话、返回、进入好友和联系人详情。
    // 输入数据：320px 视口、周然会话、好友入口和许言联系人。
    // 预期行为：auth-shell 的 data-mobile-panel 按 sessions/chat/contacts/contact-detail/contacts 变化。
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    const user = userEvent.setup();
    const { container } = renderShell();
    const shell = container.querySelector(".auth-shell");

    expect(shell).toHaveAttribute("data-mobile-panel", "sessions");
    await user.click(screen.getByRole("button", { name: /周然 收到，明天同步/ }));
    expect(shell).toHaveAttribute("data-mobile-panel", "chat");
    await user.click(screen.getByRole("button", { name: "返回会话" }));
    expect(shell).toHaveAttribute("data-mobile-panel", "sessions");
    await user.click(screen.getAllByRole("button", { name: "好友" })[0]);
    expect(shell).toHaveAttribute("data-mobile-panel", "contacts");
    await user.click(screen.getByRole("button", { name: /许言 忙碌中/ }));
    expect(shell).toHaveAttribute("data-mobile-panel", "contact-detail");
    await user.click(screen.getByRole("button", { name: "返回联系人" }));
    expect(shell).toHaveAttribute("data-mobile-panel", "contacts");
  });
});
