import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmojiPickerPopover } from "./EmojiPickerPopover";

describe("EmojiPickerPopover", () => {
  it("opens the localized picker and returns focus to its trigger on Escape", async () => {
    // 测试目标：验证按钮打开简体中文面板，分类名称为简体中文，Escape 可关闭并恢复焦点。
    // 构造方法：渲染未禁用的选择器，点击表情按钮后在搜索框聚焦时按 Escape。
    // 输入数据：触发器“表情”、搜索标签“搜索表情”和 Escape 键。
    // 预期行为：面板显示中文搜索控件，Escape 后对话框消失且焦点回到“表情”按钮。
    const user = userEvent.setup();
    render(<EmojiPickerPopover onSelectEmoji={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "表情" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "选择表情" });
    expect(dialog).toBeInTheDocument();
    expect(await within(dialog).findByLabelText("搜索表情")).toBeInTheDocument();
    expect(dialog.querySelector('[data-epr-category="food_drink"]')).toHaveAttribute("aria-label", "食物与饮料");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "选择表情" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  }, 10000);

  it("closes on outside pointer interaction without stealing focus", async () => {
    // 测试目标：验证点击面板外部会关闭表情面板，并保留外部目标的焦点。
    // 构造方法：在选择器旁渲染外部按钮，打开面板后点击外部按钮。
    // 输入数据：外部按钮“其他操作”和表情面板打开状态。
    // 预期行为：面板关闭，焦点留在被点击的外部按钮。
    const user = userEvent.setup();
    render(<>
      <EmojiPickerPopover onSelectEmoji={vi.fn()} />
      <button type="button">其他操作</button>
    </>);

    await user.click(screen.getByRole("button", { name: "表情" }));
    expect(screen.getByRole("dialog", { name: "选择表情" })).toBeInTheDocument();
    const outsideButton = screen.getByRole("button", { name: "其他操作" });
    await user.click(outsideButton);

    expect(screen.queryByRole("dialog", { name: "选择表情" })).not.toBeInTheDocument();
    expect(outsideButton).toHaveFocus();
  });

  it("inserts a selected Unicode emoji and closes the picker", async () => {
    // 测试目标：验证选择器把选中的 Unicode 字符串交给编辑器回调，而不是直接发送消息。
    // 构造方法：打开选择器并点击 Unicode 标识为 1f600 的表情格。
    // 输入数据：表情“😀”。
    // 预期行为：onSelectEmoji 收到完整“😀”，面板关闭。
    const user = userEvent.setup();
    const onSelectEmoji = vi.fn();
    render(<EmojiPickerPopover onSelectEmoji={onSelectEmoji} />);

    await user.click(screen.getByRole("button", { name: "表情" }));
    const dialog = screen.getByRole("dialog", { name: "选择表情" });
    const emoji = await waitFor(() => {
      const result = dialog.querySelector<HTMLElement>('[role="gridcell"][data-epr-unified="1f600"]');
      if (!result) throw new Error("未找到 😀 表情格");
      return result;
    });
    await user.click(emoji);

    expect(onSelectEmoji).toHaveBeenCalledWith("😀");
    expect(screen.queryByRole("dialog", { name: "选择表情" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表情" })).toHaveFocus();
  });

  it("searches localized emoji names and navigates to the result with the keyboard", async () => {
    // 测试目标：验证中文搜索可筛选表情，并能用方向键移动到结果后按 Enter 激活。
    // 构造方法：打开选择器，在搜索框输入“嘿嘿”，按 ArrowDown 到结果再按 Enter。
    // 输入数据：搜索词“嘿嘿”，匹配表情“😀”。
    // 预期行为：回调收到完整“😀”，面板关闭且焦点返回触发按钮。
    const user = userEvent.setup();
    const onSelectEmoji = vi.fn();
    render(<EmojiPickerPopover onSelectEmoji={onSelectEmoji} />);

    await user.click(screen.getByRole("button", { name: "表情" }));
    const search = await screen.findByRole("textbox", { name: "搜索表情" });
    await user.type(search, "嘿嘿");
    await waitFor(() => expect(screen.getByRole("dialog", { name: "选择表情" }).querySelector('[role="gridcell"][data-epr-unified="1f600"]')).toBeInTheDocument());
    const result = screen.getByRole("dialog", { name: "选择表情" }).querySelector<HTMLElement>('[role="gridcell"][data-epr-unified="1f600"]');
    if (!result) throw new Error("未找到搜索结果“😀”");
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(result).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(onSelectEmoji).toHaveBeenCalledWith("😀");
    expect(screen.queryByRole("dialog", { name: "选择表情" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表情" })).toHaveFocus();
  });
});
