import { fireEvent, within } from "@testing-library/react";
import { button, cards, cleanupPrototype, createUrl, enter, finishImage, inputText, nav, openComposer, readComments, reader, revokeUrl, selectImage } from "./authenticated-preview-moments.test-utils";

afterEach(cleanupPrototype);

function record(root: HTMLElement, id: string) {
  return root.querySelector<HTMLElement>(`[data-moment-id='${id}']`)!;
}
function body(card: HTMLElement) { return within(card).getByRole("link", { name: "阅读动态正文" }); }
function count(card: HTMLElement, label: string) {
  const action = button(label, card);
  const text = action.querySelector(".moments-action-count")?.textContent;
  expect(text, "互动入口应显示明确计数").toMatch(/^\d+$/);
  return Number(text);
}
function back(root: HTMLElement) { fireEvent.click(button("返回朋友圈", root)); }

describe("朋友圈独立阅读页", () => {
  it("作者头像昵称签名相邻展示，操作栏只保留点赞评论且名单随状态更新", () => {
    // 测试目标：验证知乎式作者信息、简化操作栏和保留点赞名单的布局契约。
    // 构造方法：遍历实际列表作者结构，再对林晓动态点赞并进入阅读取消点赞。
    // 输入数据：全部模拟作者、陈默原始点赞和当前用户林澈新增点赞。
    // 预期行为：每位作者均有头像、昵称和非空签名；操作栏仅两按钮，名单与计数双向同步。
    const root = enter();
    for (const card of cards(root)) {
      const author = card.querySelector<HTMLElement>(".moments-author")!;
      const copy = author.querySelector<HTMLElement>(".moments-author-copy")!;
      expect(author.firstElementChild).toHaveClass("moments-avatar");
      expect(author.lastElementChild).toBe(copy);
      expect(copy.firstElementChild).toHaveClass("moments-author-name");
      expect(copy.lastElementChild).toHaveClass("moments-signature");
      expect(copy.lastElementChild?.textContent?.trim()).not.toBe("");
      const actions = card.querySelector<HTMLElement>(".moments-actions")!;
      expect(within(actions).getAllByRole("button")).toHaveLength(2);
      expect(within(actions).getByRole("button", { name: /^(取消)?点赞$/ })).toBeInTheDocument();
      expect(button("评论", actions)).toBeInTheDocument();
    }
    let card = record(root, "moment-linxiao");
    expect(card.querySelector("[data-moments-likes]")).toHaveTextContent("陈默 赞过");
    expect(count(card, "点赞")).toBe(1);
    fireEvent.click(button("点赞", card));
    card = record(root, "moment-linxiao");
    expect(card.querySelector("[data-moments-likes]")).toHaveTextContent("陈默、林澈 赞过");
    expect(count(card, "取消点赞")).toBe(2);
    readComments(root, card);
    fireEvent.click(button("取消点赞", reader(root)));
    expect(reader(root).querySelector("[data-moments-likes]")).toHaveTextContent("陈默 赞过");
    back(root);
    expect(record(root, "moment-linxiao").querySelector("[data-moments-likes]")).toHaveTextContent("陈默 赞过");
  });

  it.each([160, 161])("%i 个 Unicode 字符的正文按边界决定阅读全文入口", (length) => {
    // 测试目标：验证 160 字截断边界沿用 Unicode 字符计数，短文也保留正文阅读入口。
    // 构造方法：发布由 emoji 组成的指定长度正文，再检查摘要及阅读全文链接并打开阅读。
    // 输入数据：160 或 161 个“🌸”字符。
    // 预期行为：160 字完整展示无阅读全文链接；161 字显示 160 字加省略号，阅读后全文完整。
    const root = enter();
    const dialog = openComposer(root);
    const text = "🌸".repeat(length);
    inputText("动态正文", text, dialog);
    fireEvent.click(button("确认发布", dialog));
    const card = cards(root)[0];
    expect(body(card).textContent).toBe(length > 160 ? "🌸".repeat(160) + "…" : text);
    const full = within(card).queryByRole("link", { name: "阅读全文" });
    expect(Boolean(full)).toBe(length > 160);
    fireEvent.click(full || body(card));
    expect(reader(root).querySelector(".moments-text")?.textContent).toBe(text);
  });

  it("列表只展示摘要和计数，长文阅读全文链接进入完整阅读页", () => {
    // 测试目标：验证长文阅读从列表展开改为独立页，列表不再承载评论编辑和删除。
    // 构造方法：进入朋友圈，检查长文摘要及各卡片结构，点击阅读全文链接。
    // 输入数据：陈默长文、阅读全文链接和带评论的林晓动态。
    // 预期行为：列表正文截断且无表单/删除；阅读页显示全文、作者信息、评论区和返回入口。
    const root = enter();
    expect(within(root).queryByLabelText("评论内容")).toBeNull();
    expect(within(root).queryByRole("button", { name: "删除动态" })).toBeNull();
    const card = record(root, "moment-chenmo");
    expect(card).not.toHaveTextContent("提醒自己下次也别忘了出门");
    expect(count(record(root, "moment-linxiao"), "评论")).toBe(1);
    const link = within(card).getByRole("link", { name: "阅读全文" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href");
    fireEvent.click(link);
    expect(reader(root)).toHaveAttribute("data-moment-id", "moment-chenmo");
    expect(reader(root)).toHaveTextContent("提醒自己下次也别忘了出门");
    expect(within(reader(root)).getByLabelText("评论内容")).toBeInTheDocument();
    expect(button("返回朋友圈", root)).toBeInTheDocument();
    expect(within(root).queryByRole("link", { name: "阅读全文" })).toBeNull();
    expect(within(root).queryByRole("button", { name: "删除动态" })).toBeNull();
  });

  it.each(["鼠标", "Enter", "Space"])("短文正文支持%s阅读入口", (method) => {
    // 测试目标：验证短文正文通过鼠标、Enter 和空格提供等价的独立阅读导航。
    // 构造方法：查询短文正文链接，按指定方式激活，再检查当前阅读记录及焦点。
    // 输入数据：林晓短文正文和鼠标、Enter、空格三种激活方式。
    // 预期行为：打开林晓的独立阅读页且阅读标题获得焦点，不遗留列表评论表单。
    const root = enter();
    const target = body(record(root, "moment-linxiao"));
    expect(target).toHaveAttribute("tabindex", "0");
    target.focus();
    if (method === "鼠标") fireEvent.click(target);
    else fireEvent.keyDown(target, { key: method === "Space" ? " " : "Enter" });
    expect(reader(root)).toHaveAttribute("data-moment-id", "moment-linxiao");
    expect(within(root).getByRole("heading", { name: "阅读全文" })).toHaveFocus();
  });

  it("评论数入口直接定位评论输入，并在列表与阅读页同步点赞和评论计数", () => {
    // 测试目标：验证评论数入口定位和同一动态跨视图的互动状态同步。
    // 构造方法：列表点赞后点击评论数进入，新增评论并取消点赞，再返回列表。
    // 输入数据：林晓动态、评论“下次带我一起！”和一次点赞/取消点赞。
    // 预期行为：评论输入聚焦，阅读初始点赞数已增加；返回时评论数加一且点赞恢复原数。
    const root = enter();
    let card = record(root, "moment-linxiao");
    const likes = count(card, "点赞");
    const comments = count(card, "评论");
    fireEvent.click(button("点赞", card));
    card = record(root, "moment-linxiao");
    expect(count(card, "取消点赞")).toBe(likes + 1);
    const detail = readComments(root, card);
    expect(within(detail).getByLabelText("评论内容")).toHaveFocus();
    expect(count(detail, "取消点赞")).toBe(likes + 1);
    inputText("评论内容", "下次带我一起！", detail);
    fireEvent.click(button("发表评论", detail));
    expect(reader(root)).toHaveTextContent("下次带我一起！");
    fireEvent.click(button("取消点赞", reader(root)));
    back(root);
    card = record(root, "moment-linxiao");
    expect(count(card, "评论")).toBe(comments + 1);
    expect(count(card, "点赞")).toBe(likes);
    expect(within(card).queryByLabelText("评论内容")).toBeNull();
    readComments(root, card);
    expect(reader(root)).toHaveTextContent("下次带我一起！");
  });

  it("评论入口先滚动评论区再聚焦输入，基础评论按头像昵称正文时间排列", () => {
    // 测试目标：验证 B 站式基础评论布局及评论入口的显式定位行为。
    // 构造方法：临时观察真实元素 scrollIntoView 调用，点击林晓评论数并检查评论结构。
    // 输入数据：林晓的一条种子评论、“评论”入口和仅对本例生效的滚动观测替身。
    // 预期行为：定位评论区且输入获得焦点；总数、输入、列表依序展示，评论包含头像及三项信息。
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scrolled: HTMLElement[] = [];
    const scrollIntoView = vi.fn(function (this: HTMLElement) { scrolled.push(this); });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      const root = enter();
      const detail = readComments(root, record(root, "moment-linxiao"));
      const comments = within(detail).getByRole("region", { name: "动态评论" });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
      expect(scrolled).toContain(comments);
      expect(within(comments).getByLabelText("评论内容")).toHaveFocus();
      expect(comments.firstElementChild).toBe(within(comments).getByRole("heading", { name: "评论 1" }));
      const rows = comments.querySelectorAll<HTMLElement>("[data-comment-id]");
      expect(rows).toHaveLength(1);
      expect(rows[0].firstElementChild).toHaveClass("moments-comment-avatar");
      const copy = rows[0].lastElementChild!;
      expect(copy.querySelector(".moments-comment-author")).toHaveTextContent("陈默");
      expect(copy.querySelector(".moments-comment-text")).toHaveTextContent("这里好漂亮，下次一起！");
      expect(copy.querySelector("time")).toHaveTextContent("5 分钟前");
      expect(button("点赞评论", rows[0])).toBeInTheDocument();
      expect(button("回复 陈默", rows[0])).toBeInTheDocument();
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
    }
  });

  it("返回列表恢复筛选、滚动和阅读入口焦点", () => {
    // 测试目标：验证阅读导航不会丢失我的动态筛选、列表阅读位置及键盘入口。
    // 构造方法：筛选我的动态并设置滚动，从自身短文正文进入后返回。
    // 输入数据：我的动态筛选、scrollTop=246 和自身动态正文入口。
    // 预期行为：返回后筛选仍选中、滚动恢复 246、焦点回到同一动态正文入口。
    const root = enter();
    fireEvent.click(button("我的动态", root));
    const scroll = root.querySelector<HTMLElement>("[data-moments-scroll]")!;
    scroll.scrollTop = 246;
    const target = body(record(root, "moment-self"));
    target.focus();
    fireEvent.click(target);
    scroll.scrollTop = 31;
    back(root);
    expect(button("我的动态", root)).toHaveAttribute("aria-pressed", "true");
    expect(cards(root)).toHaveLength(1);
    expect(scroll.scrollTop).toBe(246);
    expect(body(record(root, "moment-self"))).toHaveFocus();
  });

  it("从阅读全文和评论数返回时分别恢复对应入口焦点", () => {
    // 测试目标：验证不同入口的返回焦点准确落在原动态对应控件。
    // 构造方法：依次从长文阅读全文和短文评论计数进入阅读，再使用返回按钮。
    // 输入数据：陈默阅读全文链接和林晓评论计数按钮。
    // 预期行为：两次返回分别聚焦阅读全文链接与评论按钮，而不是统一跳到页首。
    const root = enter();
    const link = within(record(root, "moment-chenmo")).getByRole("link", { name: "阅读全文" });
    link.focus();
    fireEvent.click(link);
    back(root);
    expect(within(record(root, "moment-chenmo")).getByRole("link", { name: "阅读全文" })).toHaveFocus();
    const comments = button("评论", record(root, "moment-linxiao"));
    comments.focus();
    fireEvent.click(comments);
    back(root);
    expect(button("评论", record(root, "moment-linxiao"))).toHaveFocus();
  });

  it("阅读中离开朋友圈保留当前记录、评论草稿和聊天上下文", () => {
    // 测试目标：验证阅读页及评论草稿在主导航往返后保留，且不覆盖聊天草稿。
    // 构造方法：先输入聊天草稿，再进入林晓阅读页编辑评论，切到消息及好友后返回。
    // 输入数据：聊天草稿“聊到一半”、评论草稿“评论还没写完”和消息/好友导航。
    // 预期行为：聊天草稿原样保留，返回朋友圈仍为同一阅读记录和未提交评论。
    const root = enter();
    nav("messages");
    inputText("输入消息", "聊到一半");
    nav("moments");
    readComments(root, record(root, "moment-linxiao"));
    inputText("评论内容", "评论还没写完", reader(root));
    const scroll = root.querySelector<HTMLElement>("[data-moments-scroll]")!;
    scroll.scrollTop = 431;
    nav("messages");
    expect(within(document.body).getByLabelText("输入消息")).toHaveValue("聊到一半");
    nav("contacts");
    nav("moments");
    expect(reader(root)).toHaveAttribute("data-moment-id", "moment-linxiao");
    expect(scroll.scrollTop).toBe(431);
    expect(within(reader(root)).getByLabelText("评论内容")).toHaveValue("评论还没写完");
    back(root);
    readComments(root, record(root, "moment-linxiao"));
    expect(within(reader(root)).getByLabelText("评论内容")).toHaveValue("评论还没写完");
  });

  it("阅读往返和主导航保留发布图片资源，只有删除或销毁才释放", async () => {
    // 测试目标：验证新增阅读视图不改变本地图片资源所有权，不在视图切换中提前回收。
    // 构造方法：发布本地图片，阅读并导航往返后返回列表，最终进入阅读删除，再销毁。
    // 输入数据：正文“留住这一刻”、周末.png 和我的动态筛选。
    // 预期行为：两个视图及导航往返图片 URL 保持有效；删除仅释放一次，销毁不重复释放。
    const root = enter();
    const dialog = openComposer(root);
    inputText("动态正文", "留住这一刻", dialog);
    selectImage(dialog);
    await finishImage();
    const url = createUrl.mock.results[0].value;
    fireEvent.click(button("确认发布", dialog));
    const id = cards(root)[0].dataset.momentId!;
    fireEvent.click(button("我的动态", root));
    fireEvent.click(body(record(root, id)));
    expect(within(reader(root)).getByRole("img")).toHaveAttribute("src", url);
    nav("contacts"); nav("moments");
    expect(reader(root)).toHaveAttribute("data-moment-id", id);
    expect(within(reader(root)).getByRole("img")).toHaveAttribute("src", url);
    back(root);
    expect(record(root, id).querySelector("img")).toHaveAttribute("src", url);
    expect(revokeUrl).not.toHaveBeenCalledWith(url);
    fireEvent.click(body(record(root, id)));
    fireEvent.click(button("删除动态", root));
    expect(cards(root).some((card) => card.dataset.momentId === id)).toBe(false);
    expect(revokeUrl.mock.calls.filter(([value]) => value === url)).toHaveLength(1);
    window.__whisperAuthenticatedPrototype?.destroy();
    expect(revokeUrl.mock.calls.filter(([value]) => value === url)).toHaveLength(1);
  });

  it("纯图片动态可通过评论进入阅读，图片和点赞操作不误跳阅读", () => {
    // 测试目标：验证纯图片动态的可达性，并防止图片、点赞的局部操作触发阅读导航。
    // 构造方法：先在纯图卡点赞和查看图片，关闭预览后使用零评论计数入口。
    // 输入数据：许言纯图片动态、取消点赞按钮、图片入口及零评论按钮。
    // 预期行为：点赞和图片预览保持列表；零评论入口也能进入正确动态并继续查看大图。
    const root = enter();
    const card = record(root, "moment-xuyan");
    fireEvent.click(button("取消点赞", card));
    expect(reader(root)).toBeNull();
    fireEvent.click(button("查看动态图片 1", record(root, "moment-xuyan")));
    expect(reader(root)).toBeNull();
    fireEvent.click(button("关闭图片预览", root));
    readComments(root, record(root, "moment-xuyan"));
    expect(reader(root)).toHaveAttribute("data-moment-id", "moment-xuyan");
    expect(within(reader(root)).getByRole("img")).toBeInTheDocument();
    fireEvent.click(button("查看动态图片 1", reader(root)));
    expect(within(root).getByRole("dialog", { name: "图片预览" })).toBeInTheDocument();
    expect(reader(root)).toHaveAttribute("data-moment-id", "moment-xuyan");
  });

  it("选中正文复制时不误进阅读，清除选择后仍可正常打开", () => {
    // 测试目标：防止用户拖选正文或复制文字时意外触发阅读导航。
    // 构造方法：对短文正文建立真实 Range 选择并点击，再清空选择后点击。
    // 输入数据：林晓正文中的文字选择和两次正文点击。
    // 预期行为：有非空文字选择时保持列表，清空选择后进入阅读。
    const root = enter();
    const target = body(record(root, "moment-linxiao"));
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).not.toBe("");
    fireEvent.click(target);
    expect(reader(root)).toBeNull();
    selection.removeAllRanges();
    fireEvent.click(target);
    expect(reader(root)).toHaveAttribute("data-moment-id", "moment-linxiao");
  });

  it("自己动态只在阅读页可删除，取消保留阅读、确认后返回原筛选", () => {
    // 测试目标：验证删除入口迁移到阅读页且删除完成后有可继续操作的列表落点。
    // 构造方法：筛选我的动态，打开自身动态，先取消删除再确认。
    // 输入数据：自身种子动态及 confirm=false/true 两种选择。
    // 预期行为：列表无删除入口，取消不离开阅读；确认后回我的动态空态并显示删除反馈。
    const root = enter();
    fireEvent.click(button("我的动态", root));
    expect(within(root).queryByRole("button", { name: "删除动态" })).toBeNull();
    fireEvent.click(body(record(root, "moment-self")));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(button("删除动态", root));
    expect(reader(root)).toHaveAttribute("data-moment-id", "moment-self");
    fireEvent.click(button("删除动态", root));
    expect(reader(root)).toBeNull();
    expect(button("我的动态", root)).toHaveAttribute("aria-pressed", "true");
    expect(cards(root)).toHaveLength(0);
    expect(root).toHaveTextContent("动态已删除");
  });

  it("评论具有稳定 ID 和可核验时间，往返重绘不改变身份且正文安全", () => {
    // 测试目标：验证评论身份和时间稳定，新增评论及动态正文均按文本渲染。
    // 构造方法：先快照种子评论，再提交含 HTML 的评论，返回重进并比较身份与时间。
    // 输入数据：林晓种子评论及新增“<img src=x onerror=alert(1)>”。
    // 预期行为：全部评论有唯一 ID 与有效 datetime，重进值不变，恶意文本不创建图片元素。
    const root = enter();
    const detail = readComments(root, record(root, "moment-linxiao"));
    const snapshot = () => [...reader(root).querySelectorAll<HTMLElement>("[data-comment-id]")].map((node) => ({
      id: node.dataset.commentId,
      time: node.querySelector("time")?.getAttribute("datetime"),
      text: node.textContent,
    }));
    const initial = snapshot();
    expect(initial).toHaveLength(1);
    inputText("评论内容", "<img src=x onerror=alert(1)>", detail);
    fireEvent.click(button("发表评论", detail));
    const posted = snapshot();
    expect(posted).toHaveLength(2);
    expect(new Set(posted.map((entry) => entry.id)).size).toBe(2);
    for (const entry of posted) {
      expect(entry.id).toBeTruthy();
      expect(Number.isNaN(Date.parse(entry.time ?? ""))).toBe(false);
    }
    expect(posted[0]).toEqual(initial[0]);
    const added = reader(root).querySelectorAll<HTMLElement>("[data-comment-id]")[1];
    expect(added).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(added.querySelector("img")).toBeNull();
    back(root);
    readComments(root, record(root, "moment-linxiao"));
    expect(snapshot()).toEqual(posted);
  });
});
