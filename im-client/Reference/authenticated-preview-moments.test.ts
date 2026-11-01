import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { appScript, button, cards, cleanupPrototype, createUrl, enter, finishImage, images, inputText, load, nav, openComposer, readComments, revokeUrl, selectImage } from "./authenticated-preview-moments.test-utils";

afterEach(cleanupPrototype);

describe("朋友圈参考页", () => {
  it.each([1120, 375])("%ipx 从好友下方入口切换朋友圈并同步导航状态", (width) => {
    // 测试目标：验证桌面和窄屏均可在当前窗口切换朋友圈，并保留主导航。
    // 构造方法：载入真实页面及全部脚本，检查好友后的入口并通过当前尺寸导航进入。
    // 输入数据：1120px 和 375px 两种宽度、朋友圈和好友导航点击。
    // 预期行为：朋友圈根可见、聊天和会话区隐藏，两组导航选中态一致，好友入口可返回。
    const root = load(width);
    const contacts = document.querySelector(".function-rail [data-view-target='contacts']");
    expect(contacts?.nextElementSibling).toHaveAttribute("data-view-target", "moments");
    const trigger = nav("moments", width < 680);
    expect(trigger).toHaveAttribute("aria-current", "page");
    expect(document.querySelector(".function-rail [data-view-target='moments']")).toHaveClass("is-active");
    expect(root.hidden).toBe(false);
    expect(root).not.toHaveTextContent("这条非好友内容不应出现在动态流。");
    expect(document.querySelector(".chat-panel")).toHaveAttribute("hidden");
    expect(document.querySelector(".session-panel")).toHaveAttribute("hidden");
    expect(document.querySelector("[data-app-shell]")).toHaveAttribute("data-view", "moments");
    nav("contacts", width < 680);
    expect(root.hidden).toBe(true);
    expect(document.querySelector(".contacts-panel")).not.toHaveAttribute("hidden");
  });

  it("往返朋友圈保留聊天草稿、选中会话和滚动，并关闭已有浮层", () => {
    // 测试目标：验证朋友圈切换不破坏聊天上下文，也不遗留会话详情或账号菜单。
    // 构造方法：选择周然、输入草稿、滚动消息列表并打开详情，进入朋友圈后再返回。
    // 输入数据：周然会话、草稿“稍后继续”、scrollTop=37 和导航往返。
    // 预期行为：原会话、原文和滚动值恢复；浮层及非朋友圈拖杆在朋友圈关闭或隐藏。
    const root = load();
    fireEvent.click(document.querySelector<HTMLElement>("[data-conversation-id='zhouran']")!);
    inputText("输入消息", "稍后继续");
    const list = document.querySelector<HTMLElement>("[data-message-list]")!;
    list.scrollTop = 37;
    fireEvent.scroll(list);
    fireEvent.click(document.querySelector<HTMLElement>("[data-detail-trigger]")!);
    nav("moments");
    expect(root.hidden).toBe(false);
    expect(document.querySelector("[data-detail-panel]")).toHaveAttribute("hidden");
    expect(document.querySelector("[data-resizer='sidebar']")).toHaveAttribute("hidden");
    nav("messages");
    expect(document.querySelector("[data-app-shell]")).toHaveAttribute("data-active-conversation", "zhouran");
    expect(within(document.body).getByLabelText("输入消息")).toHaveValue("稍后继续");
    expect(list.scrollTop).toBe(37);
    fireEvent.click(button("账号与设置", document.querySelector(".function-rail")!));
    nav("moments");
    expect(document.querySelector("[data-theme-menu]")).toHaveAttribute("hidden");
  });

  it("发布纯文字时阻止空白并安全显示正文，筛选展示自己的动态", () => {
    // 测试目标：验证文字发布的最小闭环、空内容拦截和文本安全。
    // 构造方法：打开发布窗口，先输入空白再输入含 HTML 的正文，发布后切换我的动态。
    // 输入数据：空白串及“今天散步 <img src=x onerror=alert(1)>”。
    // 预期行为：空白不能发布；成功后正文位于首条，按普通文本显示且我的动态包含该条。
    const root = enter();
    const dialog = openComposer(root);
    const submit = button("确认发布", dialog);
    inputText("动态正文", " \n ", dialog);
    expect(submit).toBeDisabled();
    const text = "今天散步 <img src=x onerror=alert(1)>";
    inputText("动态正文", text, dialog);
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(cards(root)[0]).toHaveTextContent(text);
    expect(cards(root)[0].querySelector("img")).toBeNull();
    expect(within(root).queryByRole("dialog", { name: /发布/ })).toBeNull();
    fireEvent.click(button("我的动态", root));
    expect(cards(root)[0]).toHaveTextContent(text);
    expect(cards(root).every((card) => card.dataset.momentId === "moment-self" || card.textContent?.includes(text))).toBe(true);
    expect(within(root).queryByRole("button", { name: "删除动态" })).toBeNull();
  });

  it("关闭及离开朋友圈保留编辑草稿，成功发布清空草稿", async () => {
    // 测试目标：验证关闭窗口及导航离开不会丢失未发布编辑，而提交后草稿会清空。
    // 构造方法：输入文字并选图，关闭重开，再切到消息并返回重开，最后发布并再次打开。
    // 输入数据：正文“还没写完的周末记录”、周末.png 和两种关闭路径。
    // 预期行为：前两次重开原文和图片仍在且不回收 URL，成功发布后的新窗口为空。
    const root = enter();
    let dialog = openComposer(root);
    inputText("动态正文", "还没写完的周末记录", dialog);
    selectImage(dialog);
    await finishImage();
    const url = createUrl.mock.results[0].value;
    fireEvent.click(button("关闭发布窗口", dialog));
    dialog = openComposer(root);
    expect(within(dialog).getByLabelText("动态正文")).toHaveValue("还没写完的周末记录");
    expect(within(dialog).getByRole("img", { name: "待发布图片 1" })).toHaveAttribute("src", url);
    expect(revokeUrl).not.toHaveBeenCalledWith(url);
    nav("messages");
    expect(within(root).queryByRole("dialog", { name: /发布/ })).toBeNull();
    nav("moments");
    dialog = openComposer(root);
    expect(within(dialog).getByLabelText("动态正文")).toHaveValue("还没写完的周末记录");
    expect(within(dialog).getByRole("img", { name: "待发布图片 1" })).toHaveAttribute("src", url);
    expect(revokeUrl).not.toHaveBeenCalledWith(url);
    fireEvent.click(button("确认发布", dialog));
    dialog = openComposer(root);
    expect(within(dialog).getByLabelText("动态正文")).toHaveValue("");
    expect(within(dialog).queryByRole("img")).toBeNull();
  });

  it("多图按选择顺序发布，单图失败时须处理后才能发布", async () => {
    // 测试目标：验证多图发布保留选图次序，并防止尚未成功读取的图片被提交。
    // 构造方法：同时选两图，让第二张成功、第一张失败，移除失败项后再发布。
    // 输入数据：第一张 湖边.png、第二张 山路.png 及对应 error/load 回调。
    // 预期行为：失败时提交禁用且顺序不变，移除失败图片后可发布并只保留成功图片。
    const root = enter();
    const dialog = openComposer(root);
    fireEvent.change(within(dialog).getByLabelText("选择动态图片"), { target: { files: [
      new File(["lake"], "湖边.png", { type: "image/png" }),
      new File(["mountain"], "山路.png", { type: "image/png" }),
    ] } });
    const firstUrl = createUrl.mock.results[0].value;
    const secondUrl = createUrl.mock.results[1].value;
    await finishImage(1);
    await finishImage(0, false);
    expect(within(dialog).getAllByRole("img").map((image) => image.getAttribute("src"))).toEqual([firstUrl, secondUrl]);
    expect(button("确认发布", dialog)).toBeDisabled();
    fireEvent.click(button("移除图片 1", dialog));
    expect(revokeUrl).toHaveBeenCalledWith(firstUrl);
    expect(button("确认发布", dialog)).not.toBeDisabled();
    fireEvent.click(button("确认发布", dialog));
    expect([...cards(root)[0].querySelectorAll("img")].map((image) => image.src)).toEqual([secondUrl]);
  });

  it.each(["", "照片配文"])("可发布图片并把 URL 所有权转交动态：正文 %j", async (text) => {
    // 测试目标：验证纯图片与图文发布以及预览 URL 从草稿转移到动态的生命周期。
    // 构造方法：选择图片并模拟解码成功，发布后关闭重开窗口，最后删除已发布动态。
    // 输入数据：周末.png、空正文或“照片配文”、真实发布及确认删除操作。
    // 预期行为：加载期间禁止提交，发布后展示图片且 URL 未提前释放，删除时只回收一次。
    const root = enter();
    const dialog = openComposer(root);
    inputText("动态正文", text, dialog);
    selectImage(dialog);
    expect(button("确认发布", dialog)).toBeDisabled();
    await finishImage();
    await waitFor(() => expect(button("确认发布", dialog)).not.toBeDisabled());
    const url = createUrl.mock.results[0].value;
    fireEvent.click(button("确认发布", dialog));
    expect(cards(root)[0].querySelector("img")).toHaveAttribute("src", url);
    openComposer(root);
    fireEvent.click(button("关闭发布窗口", root));
    expect(revokeUrl).not.toHaveBeenCalledWith(url);
    const detail = readComments(root);
    fireEvent.click(button("删除动态", root));
    expect(revokeUrl.mock.calls.filter(([value]) => value === url)).toHaveLength(1);
  });

  it("图片失败可重试，移除及销毁回收草稿 URL", async () => {
    // 测试目标：验证图片读取失败可恢复，并避免图片草稿内存泄漏。
    // 构造方法：让第一张图片解码失败再重试成功，移除后选择第二张并销毁原型。
    // 输入数据：周末.png 的 error/load 回调及第二张 待发布.png。
    // 预期行为：失败信息可见且不能发布，重试后恢复预览；移除与销毁回收对应 URL。
    const root = enter();
    const dialog = openComposer(root);
    selectImage(dialog);
    await finishImage(0, false);
    expect(button("确认发布", dialog)).toBeDisabled();
    expect(dialog).toHaveTextContent(/失败/);
    fireEvent.click(button("重新加载图片", dialog));
    await finishImage();
    expect(within(dialog).getByRole("status")).not.toHaveTextContent("图片加载失败");
    await waitFor(() => expect(button("确认发布", dialog)).not.toBeDisabled());
    const url = createUrl.mock.results.at(-1)!.value;
    fireEvent.click(within(dialog).getByRole("button", { name: /移除/ }));
    expect(revokeUrl).toHaveBeenCalledWith(url);
    expect(button("确认发布", dialog)).toBeDisabled();
    selectImage(dialog, "待发布.png");
    await finishImage();
    const secondUrl = createUrl.mock.results.at(-1)!.value;
    window.__whisperAuthenticatedPrototype?.destroy();
    expect(revokeUrl).toHaveBeenCalledWith(secondUrl);
  });

  it("正文长度边界和无法读取的图片提供可恢复反馈", () => {
    // 测试目标：验证界面声明的文字长度限制和本地图片读取异常不会丢失草稿。
    // 构造方法：输入边界长度及超长正文，再模拟浏览器创建本地图片 URL 失败。
    // 输入数据：2000/2001 个“字”、正文“保留的草稿”和 createObjectURL 抛出异常。
    // 预期行为：2000 字可发布、超长禁用并提示，图片异常可见且原文字仍可发布。
    const root = enter();
    const dialog = openComposer(root);
    inputText("动态正文", "字".repeat(2000), dialog);
    expect(button("确认发布", dialog)).not.toBeDisabled();
    inputText("动态正文", "字".repeat(2001), dialog);
    expect(button("确认发布", dialog)).toBeDisabled();
    expect(dialog).toHaveTextContent("动态正文不能超过 2000 字");
    inputText("动态正文", "保留的草稿", dialog);
    createUrl.mockImplementationOnce(() => { throw new Error("无法读取本地图片"); });
    selectImage(dialog);
    expect(dialog).toHaveTextContent("无法读取图片，请重新选择");
    expect(within(dialog).getByLabelText("动态正文")).toHaveValue("保留的草稿");
    expect(button("确认发布", dialog)).not.toBeDisabled();
    expect(within(dialog).queryByRole("img")).toBeNull();
  });

  it.each(["数量", "格式", "大小"])("拒绝图片%s超限时保留已有图片草稿且不分配新 URL", async (kind) => {
    // 测试目标：验证界面声明的图片数量、格式和大小约束，并防止无效输入破坏已有草稿。
    // 构造方法：先读取一张有效图片，再为文件选择框注入对应超限的第二批文件。
    // 输入数据：已有 周末.png；第二批为九张图片、text/plain 文件或超过 20 MiB 的图片。
    // 预期行为：显示对应限制提示、不再创建 URL、已有图片保留且仍可发布。
    const root = enter();
    const dialog = openComposer(root);
    selectImage(dialog);
    await finishImage();
    const oversized = new File(["large"], "大图.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 20 * 1024 * 1024 + 1 });
    const files = kind === "数量"
      ? Array.from({ length: 9 }, (_, index) => new File(["pic"], `${index}.png`, { type: "image/png" }))
      : kind === "格式" ? [new File(["text"], "伪装.png", { type: "text/plain" })] : [oversized];
    fireEvent.change(within(dialog).getByLabelText("选择动态图片"), { target: { files } });
    expect(dialog).toHaveTextContent(kind === "数量" ? "每条动态最多选择 9 张图片" : kind === "格式" ? "仅支持 JPEG、PNG 或 WebP 图片" : "单张图片不能超过 20 MiB");
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(within(dialog).getAllByRole("img")).toHaveLength(1);
    expect(button("确认发布", dialog)).not.toBeDisabled();
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it("点赞可取消且评论拒绝空白并按文本显示", () => {
    // 测试目标：验证动态互动可逆、空白评论不进入列表且用户文字不被执行。
    // 构造方法：对首条动态点赞再取消，打开评论输入，先提交空格再提交 HTML 文本。
    // 输入数据：两次点赞点击、空格评论和“<b>很漂亮</b>”。
    // 预期行为：点赞状态往返，空白无新增评论，非空评论显示字面文本且不生成 b 元素。
    const root = enter();
    let card = cards(root)[0];
    const id = card.dataset.momentId;
    const current = () => root.querySelector<HTMLElement>(`[data-moment-id='${id}']`)!;
    fireEvent.click(button("点赞", card));
    expect(button("取消点赞", current())).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button("取消点赞", current()));
    expect(button("点赞", current())).toHaveAttribute("aria-pressed", "false");
    card = readComments(root, current());
    inputText("评论内容", "   ", current());
    const before = current().textContent;
    fireEvent.click(button("发表评论", current()));
    expect(current().textContent).toBe(before);
    inputText("评论内容", "<b>很漂亮</b>", current());
    fireEvent.click(button("发表评论", current()));
    expect(current()).toHaveTextContent("<b>很漂亮</b>");
    expect(current().querySelector("b")).toBeNull();
    expect(within(current()).getByLabelText("评论内容")).toHaveValue("");
  });

  it("仅自己的动态可删除，并尊重取消确认", () => {
    // 测试目标：验证原型提供作者删除权限且确认取消不会误删。
    // 构造方法：发布一条自己的记录，检查好友卡片，分别模拟取消及确认删除。
    // 输入数据：正文“待删除动态”、confirm=false 和 confirm=true。
    // 预期行为：好友卡片无删除入口，取消仍保留自己的记录，确认后才移除。
    const root = enter();
    expect(cards(root).some((card) => !within(card).queryByRole("button", { name: "删除动态" }))).toBe(true);
    const dialog = openComposer(root);
    inputText("动态正文", "待删除动态", dialog);
    fireEvent.click(button("确认发布", dialog));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const detail = readComments(root);
    fireEvent.click(button("删除动态", root));
    expect(cards(root)[0]).toHaveTextContent("待删除动态");
    fireEvent.click(button("删除动态", root));
    expect(root).not.toHaveTextContent("待删除动态");
  });

  it("图片预览用 Escape 关闭并归还焦点", () => {
    // 测试目标：验证大图交互可通过鼠标和键盘完成且不会进入阅读页。
    // 构造方法：打开列表首个图片后发送 Escape，再检查原图片入口焦点。
    // 输入数据：示例图片与 Escape 键。
    // 预期行为：图片模态可关闭，焦点返回图片入口且列表保持显示。
    const root = enter();
    const imageTrigger = cards(root).flatMap((card) => [...card.querySelectorAll<HTMLButtonElement>("button")]).find((node) => node.querySelector("img"))!;
    expect(imageTrigger).toBeDefined();
    imageTrigger.focus();
    fireEvent.click(imageTrigger);
    expect(button("关闭图片预览", root)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(root).queryByRole("button", { name: "关闭图片预览" })).toBeNull();
    expect(imageTrigger).toHaveFocus();
  });

  it("图片卡片不渲染辅助操作文案而保留可访问名称", () => {
    // 测试目标：防止图片按钮将辅助名称作为可见文本叠在图片上。
    // 构造方法：进入真实朋友圈页面，按辅助名称查询首张图片入口并检查可见内容。
    // 输入数据：示例图片入口“查看动态图片 1”。
    // 预期行为：入口可由辅助名称找到，内部有图片且没有可见的操作文本。
    const root = enter();
    const imageTrigger = within(root).getAllByRole("button", { name: "查看动态图片 1" })[0];
    expect(imageTrigger).toHaveAccessibleName("查看动态图片 1");
    expect(within(imageTrigger).getByRole("img")).toBeInTheDocument();
    expect(imageTrigger.textContent).toBe("");
  });

  it("大图 Tab 焦点忽略隐藏重试按钮，并在图片失败后包含可见重试入口", async () => {
    // 测试目标：防止大图模态的隐藏错误区参与焦点循环，导致键盘焦点逃出模态。
    // 构造方法：打开大图，用真实 Tab 操作首尾循环，再触发图片 error 并检查重试焦点。
    // 输入数据：正常示例大图、Tab/Shift+Tab、图片 error 事件及再次 Tab。
    // 预期行为：正常时焦点留在关闭按钮，失败后重试可达且首尾循环始终位于弹窗内。
    const root = enter();
    const user = userEvent.setup({ document });
    fireEvent.click(within(root).getAllByRole("button", { name: "查看动态图片 1" })[0]);
    const dialog = within(root).getByRole("dialog", { name: "图片预览" });
    const close = button("关闭图片预览", dialog);
    expect(close).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    fireEvent.error(within(dialog).getByRole("img"));
    const retry = button("重新加载图片", dialog);
    await user.tab();
    expect(retry).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(retry).toHaveFocus();
  });

  it("发布弹窗约束 Tab 焦点并通过 Escape 返回发布入口", () => {
    // 测试目标：验证发布弹窗的键盘操作、焦点约束和关闭恢复。
    // 构造方法：打开弹窗后分别在首尾可用控件触发 Shift+Tab 和 Tab，最后按 Escape。
    // 输入数据：非空正文使提交可用、Tab/Shift+Tab 和 Escape 键。
    // 预期行为：焦点在弹窗首尾循环，Escape 关闭后返回发布按钮。
    const root = enter();
    const trigger = button("发布动态", root);
    trigger.focus();
    const dialog = openComposer(root);
    inputText("动态正文", "键盘测试", dialog);
    const focusables = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, input:not([type='file']), [tabindex='0']")].filter((node) => !node.hidden);
    const first = focusables[0];
    const last = focusables.at(-1)!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(root).queryByRole("dialog", { name: /发布/ })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("重复初始化清理旧监听器，销毁后完成图片读取不污染新实例", async () => {
    // 测试目标：验证同页重初始化不会重复发布，且旧异步图片回调被安全忽略。
    // 构造方法：启动一次图片读取，重新执行主脚本，触发旧回调并在新实例发布文字。
    // 输入数据：未完成的旧图片、第二次主脚本执行及正文“新实例动态”。
    // 预期行为：旧 URL 回收，旧回调不恢复旧弹窗，新实例一次发布只新增一条。
    const root = enter();
    const oldDialog = openComposer(root);
    selectImage(oldDialog);
    const oldImageCallback = images[0].onload;
    const url = createUrl.mock.results[0].value;
    window.eval(appScript());
    oldImageCallback?.();
    await Promise.resolve();
    expect(revokeUrl).toHaveBeenCalledWith(url);
    nav("moments");
    const count = cards(root).length;
    const dialog = openComposer(root);
    expect(within(dialog).getByLabelText("动态正文")).toHaveValue("");
    inputText("动态正文", "新实例动态", dialog);
    fireEvent.click(button("确认发布", dialog));
    expect(cards(root)).toHaveLength(count + 1);
    expect(cards(root).filter((card) => card.textContent?.includes("新实例动态"))).toHaveLength(1);
  });
});
