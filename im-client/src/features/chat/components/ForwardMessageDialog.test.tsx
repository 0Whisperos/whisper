import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForwardTarget } from "../forwardTargets";
import { ForwardMessageDialog } from "./ForwardMessageDialog";

const targets: ForwardTarget[] = [
  { key: "a", conversationId: 42, name: "林晓", avatar: "晓", tone: "blue" },
  { key: "b", conversationId: 43, name: "周然", avatar: "周", tone: "orange" },
  { key: "c", conversationId: null, name: "新好友", avatar: "新", tone: "gray", disabledReason: "好友尚无可用会话" },
];
function props() { return { targets, selectedConversationId: null as number | null, phase: "choosing" as const,
  error: "", submitted: false, canSend: true, onSelectTarget: vi.fn(), onSubmit: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() }; }
afterEach(cleanup);

describe("ForwardMessageDialog", () => {
  it("requires one available target and submits only the controlled selection", async () => {
    // 测试目标：验证单选目标、不可用好友原因与确认前置条件。
    // 构造方法：渲染未选目标弹窗，点击目标，再用选中 props 重渲染并确认。
    // 输入数据：可用会话 42/43 和没有会话 ID 的新好友，选择 43。
    // 预期行为：无目标时禁确认，新好友禁选且展示原因，只回调一次会话 43 并确认。
    const options = props(); const { rerender } = render(<ForwardMessageDialog {...options} />);
    expect(screen.getByRole("button", { name: "确认转发" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "新好友，好友尚无可用会话" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "周然" }));
    expect(options.onSelectTarget).toHaveBeenCalledExactlyOnceWith(43);
    rerender(<ForwardMessageDialog {...options} selectedConversationId={43} />);
    expect(screen.getByRole("radio", { name: "周然" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "林晓" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "确认转发" }));
    expect(options.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("locks targets while busy and failed, offers retry and keeps submitted close available", async () => {
    // 测试目标：验证任务启动后目标固定，失败只重试，已提交任务可关闭弹窗。
    // 构造方法：同一弹窗依次显示上传、失败及等待发送确认状态，分别执行重试和关闭。
    // 输入数据：选中会话 42，上传失败提示“上传失败”，submitted=true 的发送中任务。
    // 预期行为：各状态目标禁选；失败显示状态与重试按钮；提交后关闭回调仍可用。
    const options = props(); const { rerender } = render(<ForwardMessageDialog {...options} selectedConversationId={42} phase="uploading" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在上传图片");
    expect(screen.getByRole("radio", { name: "周然" })).toBeDisabled();
    rerender(<ForwardMessageDialog {...options} selectedConversationId={42} phase="failed" error="上传失败" />);
    expect(screen.getByRole("radio", { name: "林晓" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("上传失败");
    expect(screen.queryByRole("button", { name: "确认转发" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试转发" })); expect(options.onRetry).toHaveBeenCalledTimes(1);
    rerender(<ForwardMessageDialog {...options} selectedConversationId={42} phase="sending" submitted />);
    await userEvent.click(screen.getByRole("button", { name: /^关闭$/ })); expect(options.onClose).toHaveBeenCalledTimes(1);
  });

  it("traps keyboard focus, closes with Escape and restores the opener", async () => {
    // 测试目标：验证键盘焦点留在弹窗、Escape 关闭与卸载后的焦点恢复。
    // 构造方法：聚焦外部触发按钮，挂载弹窗，使用 Tab/Shift+Tab，按 Escape 后卸载。
    // 输入数据：选中会话 42、可提交弹窗；焦点位于关闭按钮或确认按钮。
    // 预期行为：前后 Tab 都循环在弹窗内，Escape 调用关闭一次，卸载恢复外部按钮焦点。
    const opener = document.createElement("button"); document.body.append(opener); opener.focus();
    const options = props(); const { unmount } = render(<ForwardMessageDialog {...options} selectedConversationId={42} />);
    const first = screen.getByRole("button", { name: "关闭转发" }); const last = screen.getByRole("button", { name: "确认转发" });
    last.focus(); await userEvent.tab(); expect(first).toHaveFocus();
    await userEvent.tab({ shift: true }); expect(last).toHaveFocus();
    await userEvent.keyboard("{Escape}"); expect(options.onClose).toHaveBeenCalledTimes(1);
    unmount(); expect(opener).toHaveFocus(); opener.remove();
  });

  it("shows empty and offline states without allowing submission", () => {
    // 测试目标：验证没有目标和连接离线时展示原因并禁止确认。
    // 构造方法：用空目标集合与不可发送状态渲染弹窗。
    // 输入数据：targets=[]，canSend=false，selectedConversationId=null。
    // 预期行为：显示无目标提示和连接提示，确认按钮禁用。
    render(<ForwardMessageDialog {...props()} targets={[]} canSend={false} />);
    expect(screen.getByText("暂无可转发的好友或会话")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("聊天连接暂不可用");
    expect(screen.getByRole("button", { name: "确认转发" })).toBeDisabled();
  });
});
