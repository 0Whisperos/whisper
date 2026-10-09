import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { exportAvatarCropMock } = vi.hoisted(() => ({ exportAvatarCropMock: vi.fn() }));

vi.mock("../components/avatarCrop", () => ({
  AVATAR_CROP_VIEWPORT_SIZE: 280,
  exportAvatarCrop: exportAvatarCropMock,
}));

import { AvatarResourceCache } from "../avatarResourceCache";
import { AuthenticatedShell } from "../components/AuthenticatedShell";
import { chatMockData } from "../mockData";
import type { ChatData, EditableSelfProfile } from "../types";

const initialCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const initialRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

interface RenderShellOptions {
  canSendMessages?: boolean;
  onSendText?: (conversationId: number, text: string) => boolean | void;
  onRetryMessage?: (clientMessageId: string) => void;
  onSaveProfile?: (profile: EditableSelfProfile) => Promise<void>;
}

function renderShell(options: RenderShellOptions = {}) {
  function ShellHarness() {
    const [data, setData] = useState(() => structuredClone(chatMockData));
    const avatarResourceCacheRef = useRef<AvatarResourceCache | null>(null);
    if (!avatarResourceCacheRef.current) avatarResourceCacheRef.current = new AvatarResourceCache();
    useEffect(() => () => avatarResourceCacheRef.current?.clear(), []);
    const saveProfile = async (profile: EditableSelfProfile) => {
      await options.onSaveProfile?.(profile);
      const avatarObjectKey = profile.avatar.action === "replace"
        ? "avatars/test/profile-image"
        : profile.avatar.action === "remove"
          ? null
          : data.self.avatarObjectKey ?? null;
      if (profile.avatar.action === "replace" && avatarObjectKey) avatarResourceCacheRef.current?.prime(avatarObjectKey, profile.avatar.file);
      setData((current) => ({
        ...current,
        self: {
          ...current.self,
          name: profile.name,
          avatar: Array.from(profile.name)[0] ?? "?",
          signature: profile.signature,
          avatarObjectKey,
        },
      }));
    };
    return (
      <AuthenticatedShell
        data={data}
        connectionLabel="聊天连接在线：connection-uuid"
        canSendMessages={options.canSendMessages}
        isLoggingOut={false}
        onLogout={() => undefined}
        onSendText={options.onSendText}
        onRetryMessage={options.onRetryMessage}
        apiBaseUrl="http://api.test"
        accessToken="access-token"
        avatarResourceCache={avatarResourceCacheRef.current}
        onSaveProfile={saveProfile}
      />
    );
  }
  return render(<ShellHarness />);
}

function renderShellWithData(data: ChatData) {
  return render(
    <AuthenticatedShell
      data={data}
      connectionLabel="聊天连接在线：connection-uuid"
      isLoggingOut={false}
      onLogout={() => undefined}
      onSaveProfile={async () => undefined}
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
  vi.restoreAllMocks();
  exportAvatarCropMock.mockReset();
  if (initialCreateObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", initialCreateObjectUrlDescriptor);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (initialRevokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", initialRevokeObjectUrlDescriptor);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
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
    // 输入数据：联系人为空，好友页仍展示发现入口、通知入口和联系人空状态。
    // 预期行为：资料区域中央显示“当前没有好友”，不显示头像、资料字段或发消息按钮。
    const user = userEvent.setup();
    renderShellWithData(noFriendsData());
    await user.click(screen.getAllByRole("button", { name: "好友" })[0]);

    expect(screen.getByText("当前没有好友")).toBeInTheDocument();
    expect(screen.getByText("发现")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /朋友.*通过账号搜索/ })).toBeInTheDocument();
    expect(screen.getByText("通知")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新的朋友.*查看好友申请/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /群聊.*敬请期待/ })).toBeInTheDocument();
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

  it("shows the Enter hint and sends trimmed text when Enter is pressed", async () => {
    // 测试目标：验证发送按钮提示 Enter 快捷键，且按 Enter 会发送裁剪后的草稿。
    // 构造方法：渲染可发送的工作台，在输入框填入带首尾空格的文本后按 Enter。
    // 输入数据：当前会话 10002 的文本“  回车发送  ”。
    // 预期行为：按钮 title 为“发送(Enter)”，回调收到裁剪文本，接受后输入框清空。
    const user = userEvent.setup();
    const onSendText = vi.fn(() => true);
    renderShell({ canSendMessages: true, onSendText });
    const input = screen.getByLabelText("输入消息");

    expect(screen.getByRole("button", { name: "发送消息" })).toHaveAttribute("title", "发送(Enter)");
    await user.type(input, "  回车发送  ");
    await user.keyboard("{Enter}");

    expect(onSendText).toHaveBeenCalledWith(10002, "回车发送");
    expect(input).toHaveValue("");
  });

  it("inserts a newline with Shift+Enter without sending", async () => {
    // 测试目标：验证 Shift+Enter 在编辑栏插入换行而不触发消息发送。
    // 构造方法：渲染可发送的工作台，输入一段文字后按 Shift+Enter。
    // 输入数据：当前会话草稿“第一行”。
    // 预期行为：输入框内容变为“第一行\n”，发送回调未调用。
    const user = userEvent.setup();
    const onSendText = vi.fn(() => true);
    renderShell({ canSendMessages: true, onSendText });
    const input = screen.getByLabelText("输入消息");

    await user.type(input, "第一行");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(input).toHaveValue("第一行\n");
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("does not send while the input method is composing text", () => {
    // 测试目标：验证输入法组合候选词期间按 Enter 不会发送消息。
    // 构造方法：渲染可发送的工作台，输入组合文本并派发 isComposing=true 的 Enter 按键事件。
    // 输入数据：当前会话草稿“拼音”，键盘事件 key=Enter 且 isComposing=true。
    // 预期行为：草稿保持不变，发送回调未调用。
    const onSendText = vi.fn(() => true);
    renderShell({ canSendMessages: true, onSendText });
    const input = screen.getByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "拼音" } });

    fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true });

    expect(input).toHaveValue("拼音");
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("does not send an empty draft when Enter is pressed", async () => {
    // 测试目标：验证空草稿按 Enter 不会调用发送回调。
    // 构造方法：渲染已认证且可发送的工作台，不输入内容，直接在编辑栏按 Enter。
    // 输入数据：当前会话空草稿。
    // 预期行为：发送回调未调用，输入框仍为空。
    const user = userEvent.setup();
    const onSendText = vi.fn(() => true);
    renderShell({ canSendMessages: true, onSendText });
    const input = screen.getByLabelText("输入消息");

    await user.click(input);
    await user.keyboard("{Enter}");

    expect(onSendText).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });

  it("keeps sending disabled while the chat connection is not authenticated", async () => {
    // 测试目标：验证未认证连接不会暴露可用的发送操作，即使当前草稿包含正文。
    // 构造方法：渲染未传入连接发送权限的工作台，在输入框中填写文本。
    // 输入数据：正文“等待连接”。
    // 预期行为：发送按钮保持禁用，且发送回调不会被调用。
    const user = userEvent.setup();
    const onSendText = vi.fn(() => true);
    renderShell({ onSendText });

    const input = screen.getByLabelText("输入消息");
    await user.type(input, "等待连接");
    await user.keyboard("{Enter}");

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
        onSaveProfile={async () => undefined}
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
        onSaveProfile={async () => undefined}
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

  it("opens the profile editor with current values and applies saved text to the running profile", async () => {
    // 测试目标：验证账号菜单可以打开资料编辑器，且保存昵称和个性签名只更新当前运行界面。
    // 构造方法：渲染已登录工作台，从账号菜单进入编辑器，修改两个文本字段后保存。
    // 输入数据：昵称“新昵称”和个性签名“专注当下”。
    // 预期行为：编辑器初值与当前资料一致；保存后导航栏和账号菜单显示新昵称，其他账号资料保持不变。
    const user = userEvent.setup();
    renderShell();
    const accountTrigger = screen.getAllByRole("button", { name: "账号与设置" })[0];

    await user.click(accountTrigger);
    await user.click(screen.getByRole("button", { name: "编辑" }));

    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    const nickname = within(dialog).getByRole("textbox", { name: /昵称/ });
    const signature = within(dialog).getByRole("textbox", { name: /个性签名/ });
    expect(signature).toHaveAttribute("placeholder", "编辑个性签名，展示我的独特态度");
    expect(nickname).toHaveValue(chatMockData.self.name);
    expect(signature).toHaveValue(chatMockData.self.signature ?? "");
    expect(within(dialog).getByRole("button", { name: "更换头像" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/账号|地区|状态/)).not.toBeInTheDocument();

    await user.clear(nickname);
    await user.type(nickname, "新昵称");
    await user.type(signature, "专注当下");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(screen.getByText("新昵称", { selector: ".auth-rail-label" })).toBeInTheDocument();
    await user.click(accountTrigger);
    expect(screen.getByRole("dialog", { name: "账号与设置" })).toHaveTextContent("新昵称");
    expect(screen.getByText(chatMockData.self.account)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const reopenedEditor = screen.getByRole("dialog", { name: "编辑资料" });
    expect(within(reopenedEditor).getByRole("textbox", { name: /昵称/ })).toHaveValue("新昵称");
    expect(within(reopenedEditor).getByRole("textbox", { name: /个性签名/ })).toHaveValue("专注当下");
  });

  it("discards profile text edits when the cancel button is clicked", async () => {
    // 测试目标：验证点击资料编辑器底部的取消按钮会丢弃未保存文字且不调用保存回调。
    // 构造方法：打开账号菜单中的资料编辑器，修改昵称和个性签名后点击取消，再重新打开编辑器。
    // 输入数据：临时昵称“未保存昵称”和临时个性签名“未保存签名”。
    // 预期行为：编辑器关闭且保存回调未调用；重新打开后仍显示原有资料。
    const onSaveProfile = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderShell({ onSaveProfile });
    const accountTrigger = screen.getAllByRole("button", { name: "账号与设置" })[0];

    await user.click(accountTrigger);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    await user.clear(within(dialog).getByRole("textbox", { name: /昵称/ }));
    await user.type(within(dialog).getByRole("textbox", { name: /昵称/ }), "未保存昵称");
    await user.clear(within(dialog).getByRole("textbox", { name: /个性签名/ }));
    await user.type(within(dialog).getByRole("textbox", { name: /个性签名/ }), "未保存签名");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument();
    expect(onSaveProfile).not.toHaveBeenCalled();
    await user.click(accountTrigger);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const reopenedEditor = screen.getByRole("dialog", { name: "编辑资料" });
    expect(within(reopenedEditor).getByRole("textbox", { name: /昵称/ })).toHaveValue(chatMockData.self.name);
    expect(within(reopenedEditor).getByRole("textbox", { name: /个性签名/ })).toHaveValue(chatMockData.self.signature ?? "");
  });

  it("submits the reset avatar with the profile form", async () => {
    // 测试目标：验证点击恢复默认头像只修改草稿，并在提交资料时使用 remove 操作。
    // 构造方法：打开当前用户资料编辑器，点击恢复按钮后再点击表单保存。
    // 输入数据：当前头像状态和头像操作 remove。
    // 预期行为：保存回调收到 avatar.action=remove，工作台切换到默认文字头像。
    const onSaveProfile = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const { container } = renderShell({ onSaveProfile });
    await user.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });

    await user.click(within(dialog).getByRole("button", { name: "恢复默认头像" }));
    expect(onSaveProfile).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({ avatar: { action: "remove" } }));
    await waitFor(() => expect(container.querySelector(".auth-person-avatar img")).toBeNull());
  });

  it("blocks invalid profile fields and unsupported image extensions with clear errors", async () => {
    // 测试目标：验证空昵称、超长 Unicode 昵称、超长个性签名、GIF 和未知文件后缀均不能保存。
    // 构造方法：打开编辑器，依次提交无效文本并上传非图片扩展名文件。
    // 输入数据：空白昵称、16 个 emoji、81 个签名字符、portrait.gif 和 notes.txt。
    // 预期行为：每种无效输入都显示明确错误，编辑器保持打开且不会保存。
    const user = userEvent.setup({ applyAccept: false });
    renderShell();
    await user.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    const nickname = within(dialog).getByRole("textbox", { name: /昵称/ });
    const signature = within(dialog).getByRole("textbox", { name: /个性签名/ });
    const save = within(dialog).getByRole("button", { name: "保存" });

    await user.clear(nickname);
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("请输入昵称");

    await user.type(nickname, "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀");
    await user.clear(signature);
    await user.type(signature, "签".repeat(81));
    await user.click(save);
    expect(screen.getByText("昵称不能超过 15 个字符。", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("个签不能超过 80 个字符。", { exact: true })).toBeInTheDocument();

    const unsupportedFile = new File(["not an image"], "notes.txt", { type: "text/plain" });
    await user.upload(within(dialog).getByLabelText("选择头像图片"), unsupportedFile);
    expect(screen.getByText("请选择 PNG、JPG、WebP 或 BMP 图片。", { exact: true })).toBeInTheDocument();
    await user.upload(within(dialog).getByLabelText("选择头像图片"), new File(["gif"], "portrait.gif", { type: "image/gif" }));
    expect(screen.getByText("请选择 PNG、JPG、WebP 或 BMP 图片。", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "编辑资料" })).toBeInTheDocument();
  });

  it("previews an accepted image, hands the file to saving, and lets the shared cache own the saved image", async () => {
    // 测试目标：验证选图使用临时 Blob URL 预览，保存时传递 File，并由共享缓存创建正式展示 URL。
    // 构造方法：替换 URL.createObjectURL/revokeObjectURL 为可观察替身，在资料编辑器连续选择两张图片后保存。
    // 输入数据：portrait.png、portrait.webp、两张裁剪 PNG，以及 source、preview 和 cache Blob URL。
    // 预期行为：裁剪源图和替换预览及时释放；多个本人头像使用缓存 URL，卸载时再释放缓存 URL。
    const originalCreateDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:first-source")
      .mockReturnValueOnce("blob:first-preview")
      .mockReturnValueOnce("blob:second-source")
      .mockReturnValueOnce("blob:profile-preview")
      .mockReturnValueOnce("blob:cached-avatar");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    const user = userEvent.setup();
    const onSendText = vi.fn();
    const onSaveProfile = vi.fn(async () => undefined);
    const { container, unmount } = renderShell({ onSendText, onSaveProfile });
    await user.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    const imageInput = within(dialog).getByLabelText("选择头像图片");
    const firstImage = new File(["first image"], "portrait.png", { type: "image/png" });
    const firstCrop = new File(["first crop"], "avatar.png", { type: "image/png" });
    exportAvatarCropMock.mockResolvedValueOnce(firstCrop);
    await user.upload(imageInput, firstImage);

    expect(createObjectURL).toHaveBeenCalledWith(firstImage);
    const firstCropImage = screen.getByRole("img", { name: "待裁剪图片" });
    Object.defineProperty(firstCropImage, "naturalWidth", { configurable: true, value: 600 });
    Object.defineProperty(firstCropImage, "naturalHeight", { configurable: true, value: 400 });
    fireEvent.load(firstCropImage);
    await user.click(screen.getByRole("button", { name: "使用此头像" }));
    expect(dialog.querySelector(".auth-profile-editor-avatar img")).toHaveAttribute("src", "blob:first-preview");
    await user.upload(imageInput, []);
    expect(dialog.querySelector(".auth-profile-editor-avatar img")).toHaveAttribute("src", "blob:first-preview");

    const image = new File(["image bytes"], "portrait.webp", { type: "image/webp" });
    const croppedImage = new File(["cropped image"], "avatar.png", { type: "image/png" });
    exportAvatarCropMock.mockResolvedValueOnce(croppedImage);
    await user.upload(imageInput, image);
    expect(createObjectURL).toHaveBeenLastCalledWith(image);
    const nextCropImage = screen.getByRole("img", { name: "待裁剪图片" });
    Object.defineProperty(nextCropImage, "naturalWidth", { configurable: true, value: 400 });
    Object.defineProperty(nextCropImage, "naturalHeight", { configurable: true, value: 600 });
    fireEvent.load(nextCropImage);
    await user.click(screen.getByRole("button", { name: "使用此头像" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-preview");
    expect(dialog.querySelector(".auth-profile-editor-avatar img")).toHaveAttribute("src", "blob:profile-preview");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(onSaveProfile).toHaveBeenCalledWith({
      name: chatMockData.self.name,
      signature: chatMockData.self.signature ?? "",
      avatar: { action: "replace", file: croppedImage },
    });
    await user.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await waitFor(() => expect(container.querySelectorAll('.auth-person-avatar img[src="blob:cached-avatar"]').length).toBeGreaterThanOrEqual(2));
    expect(container.querySelector('.auth-message-avatar img[src="blob:cached-avatar"]')).toBeInTheDocument();
    expect(onSendText).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-source");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second-source");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-preview");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:profile-preview");

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(5);
    expect(revokeObjectURL).toHaveBeenLastCalledWith("blob:cached-avatar");
    if (originalCreateDescriptor) Object.defineProperty(URL, "createObjectURL", originalCreateDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", originalRevokeDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("keeps the editor and selected preview when remote profile saving fails", async () => {
    // 测试目标：验证头像上传或资料提交失败时不会关闭编辑器，也不会覆盖当前运行资料。
    // 构造方法：让保存回调拒绝，选择图片、修改昵称并点击保存。
    // 输入数据：failed.png、本地预览 URL blob:failed-preview、昵称“未保存昵称”。
    // 预期行为：显示保存失败提示，预览仍可见，保存按钮恢复可用，导航栏仍显示旧昵称。
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:failed-preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const user = userEvent.setup();
    const { unmount } = renderShell({ onSaveProfile: vi.fn(async () => { throw new Error("upload failed"); }) });
    await user.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    const nickname = within(dialog).getByRole("textbox", { name: /昵称/ });
    await user.clear(nickname);
    await user.type(nickname, "未保存昵称");
    exportAvatarCropMock.mockResolvedValueOnce(new File(["cropped"], "avatar.png", { type: "image/png" }));
    await user.upload(
      within(dialog).getByLabelText("选择头像图片"),
      new File(["image"], "failed.png", { type: "image/png" }),
    );
    const cropImage = screen.getByRole("img", { name: "待裁剪图片" });
    Object.defineProperty(cropImage, "naturalWidth", { configurable: true, value: 400 });
    Object.defineProperty(cropImage, "naturalHeight", { configurable: true, value: 400 });
    fireEvent.load(cropImage);
    await user.click(screen.getByRole("button", { name: "使用此头像" }));

    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("资料保存失败，请稍后重试");
    expect(dialog.querySelector('.auth-profile-editor-avatar img[src="blob:failed-preview"]')).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeEnabled();
    expect(screen.getByText(chatMockData.self.name, { selector: ".auth-rail-label" })).toBeInTheDocument();
    unmount();
  });

  it("keeps the reset draft and current profile unchanged when saving the reset fails", async () => {
    // 测试目标：验证清除头像提交失败时编辑器保留清除草稿，当前资料不提前更新。
    // 构造方法：让保存回调拒绝，打开编辑器点击恢复默认头像并提交。
    // 输入数据：头像操作 remove 和 upload_failed 保存错误。
    // 预期行为：显示保存失败提示、编辑器仍打开、未发布资料状态更新。
    const onSaveProfile = vi.fn(async () => { throw new Error("update_failed"); });
    const user = userEvent.setup();
    renderShell({ onSaveProfile });
    await user.click(screen.getAllByRole("button", { name: "账号与设置" })[0]);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    await user.click(within(dialog).getByRole("button", { name: "恢复默认头像" }));
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("资料保存失败，请稍后重试");
    expect(onSaveProfile).toHaveBeenCalledWith(expect.objectContaining({ avatar: { action: "remove" } }));
    expect(within(dialog).getByRole("button", { name: "恢复默认头像" })).toBeDisabled();
    expect(screen.getByText(chatMockData.self.name, { selector: ".auth-rail-label" })).toBeInTheDocument();
  });

  it("discards an unsubmitted avatar and restores focus after Escape", async () => {
    // 测试目标：验证取消编辑会丢弃未保存头像，Escape 可关闭对话框并把焦点交还账号入口。
    // 构造方法：打开编辑器，聚焦首个按钮后用 Shift+Tab 检查焦点循环，再上传图片并按 Escape。
    // 输入数据：未保存图片 draft.png、Shift+Tab 和 Escape 键。
    // 预期行为：焦点循环留在对话框内；Escape 关闭对话框、恢复账号触发器焦点，且头像草稿 URL 被释放。
    const originalCreateDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const createObjectURL = vi.fn(() => "blob:discarded-preview");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    const user = userEvent.setup();
    const { container } = renderShell();
    const accountTrigger = screen.getAllByRole("button", { name: "账号与设置" })[0];
    await user.click(accountTrigger);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    const cameraButton = within(dialog).getByRole("button", { name: "更换头像" });
    const fileInput = within(dialog).getByLabelText("选择头像图片");
    const openPicker = vi.spyOn(fileInput, "click");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(within(dialog).getByRole("button", { name: "恢复默认头像" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(cameraButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(openPicker).toHaveBeenCalledOnce();

    const close = within(dialog).getByRole("button", { name: "关闭编辑资料" });
    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(within(dialog).getByRole("button", { name: "保存" })).toHaveFocus();

    exportAvatarCropMock.mockResolvedValueOnce(new File(["cropped"], "avatar.png", { type: "image/png" }));
    await user.upload(within(dialog).getByLabelText("选择头像图片"), new File(["bytes"], "draft.png", { type: "image/png" }));
    const cropImage = screen.getByRole("img", { name: "待裁剪图片" });
    Object.defineProperty(cropImage, "naturalWidth", { configurable: true, value: 400 });
    Object.defineProperty(cropImage, "naturalHeight", { configurable: true, value: 400 });
    fireEvent.load(cropImage);
    await user.click(screen.getByRole("button", { name: "使用此头像" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument();
    await waitFor(() => expect(accountTrigger).toHaveFocus());
    expect(container.querySelector('.auth-person-avatar img[src="blob:discarded-preview"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:discarded-preview");

    if (originalCreateDescriptor) Object.defineProperty(URL, "createObjectURL", originalCreateDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", originalRevokeDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });
});
