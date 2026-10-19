import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedShell } from "../components/AuthenticatedShell";
import { chatMockData } from "../mockData";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("authenticated forwarding composition", () => {
  it("keeps initial modal focus after queued editor animation frames and restores the editor only on close", async () => {
    // 测试目标：验证真实编辑器排队的 focus 不会抢走转发弹窗初始焦点，关闭后才恢复编辑器。
    // 构造方法：保留真实 Shell/Tiptap，捕获 rAF 队列，先选回复排队编辑器 focus，再从菜单打开转发并执行队列。
    // 输入数据：林晓正式消息、打开前未执行的编辑器 focus rAF，以及 Escape 关闭操作。
    // 预期行为：打开后与清空旧队列后焦点均在弹窗内，按 Tab 仍在弹窗，关闭并执行恢复队列后焦点在输入框。
    const frames = new Map<number, FrameRequestCallback>(); let nextFrameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrameId; frames.set(id, callback); return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    const flushFrames = async () => {
      await act(async () => {
        while (frames.size) {
          const pending = [...frames.values()]; frames.clear();
          pending.forEach((callback) => callback(performance.now()));
        }
      });
    };
    const user = userEvent.setup();
    render(<AuthenticatedShell data={structuredClone(chatMockData)} connectionLabel="在线" canSendMessages
      isLoggingOut={false} onLogout={vi.fn()} onSaveProfile={async () => undefined} />);
    const editor = screen.getByLabelText("输入消息");
    await user.click(editor);
    const original = within(screen.getByLabelText("消息列表")).getByText("晚饭回家吃吗？");
    fireEvent.contextMenu(original);
    await user.click(screen.getByRole("menuitem", { name: "回复" }));
    expect(frames.size).toBeGreaterThan(0);
    fireEvent.contextMenu(original);
    await user.click(screen.getByRole("menuitem", { name: "转发" }));
    const dialog = screen.getByRole("dialog", { name: "转发消息" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await flushFrames();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await flushFrames();
    expect(screen.queryByRole("dialog", { name: "转发消息" })).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it("forwards through the dedicated callback while retaining both conversation bodies and reply drafts", async () => {
    // 测试目标：验证菜单、目标选择和发送接线，并保留源/目标会话各自正文与回复草稿。
    // 构造方法：在周然和林晓分别编辑草稿并选择回复，再转发林晓正式消息到周然并关闭任务。
    // 输入数据：源草稿“源会话草稿”、目标草稿“目标会话草稿”，源正式正文“晚饭回家吃吗？”。
    // 预期行为：只调用专用转发回调且正文无引用；关闭和切换后两个编辑器正文与回复条均保留。
    const user = userEvent.setup(); const onForwardMessage = vi.fn(() => "forward-client-id");
    const onSendText = vi.fn(); const onSendRich = vi.fn();
    render(<AuthenticatedShell data={structuredClone(chatMockData)} connectionLabel="在线" canSendMessages
      isLoggingOut={false} onLogout={vi.fn()} onSaveProfile={async () => undefined}
      apiBaseUrl="https://api.test" accessToken="token" onForwardMessage={onForwardMessage}
      onSendText={onSendText} onSendRich={onSendRich} />);
    const sessions = screen.getByRole("region", { name: "会话" });
    await user.click(within(sessions).getByRole("button", { name: /周然 收到，明天同步/ }));
    await user.type(screen.getByLabelText("输入消息"), "目标会话草稿");
    fireEvent.contextMenu(within(screen.getByLabelText("消息列表")).getByText("明天十点同步可以吗？"));
    await user.click(screen.getByRole("menuitem", { name: "回复" }));
    expect(screen.getByRole("group", { name: "回复消息" })).toHaveTextContent("明天十点同步可以吗？");
    await user.click(within(sessions).getByRole("button", { name: /林晓 晚饭回家吃吗/ }));
    await user.type(screen.getByLabelText("输入消息"), "源会话草稿");
    const original = within(screen.getByLabelText("消息列表")).getByText("晚饭回家吃吗？");
    fireEvent.contextMenu(original); await user.click(screen.getByRole("menuitem", { name: "回复" }));
    fireEvent.contextMenu(original); await user.click(screen.getByRole("menuitem", { name: "转发" }));
    const dialog = screen.getByRole("dialog", { name: "转发消息" });
    await user.click(within(dialog).getByRole("radio", { name: "周然" }));
    await user.click(within(dialog).getByRole("button", { name: "确认转发" }));
    await waitFor(() => expect(onForwardMessage).toHaveBeenCalledExactlyOnceWith(10005,
      { messageType: "text", content: { text: "晚饭回家吃吗？" } }));
    expect(onSendText).not.toHaveBeenCalled(); expect(onSendRich).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: /^关闭$/ }));
    expect(screen.getByLabelText("输入消息")).toHaveTextContent("源会话草稿");
    expect(screen.getByRole("group", { name: "回复消息" })).toHaveTextContent("晚饭回家吃吗？");
    await user.click(within(sessions).getByRole("button", { name: /周然 收到，明天同步/ }));
    expect(screen.getByLabelText("输入消息")).toHaveTextContent("目标会话草稿");
    expect(screen.getByRole("group", { name: "回复消息" })).toHaveTextContent("明天十点同步可以吗？");
  });
});
