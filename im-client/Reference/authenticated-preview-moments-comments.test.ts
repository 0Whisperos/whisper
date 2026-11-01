import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { appScript, button, cards, cleanupPrototype, createUrl, enter, finishImage, images, inputText, nav, readComments, reader, revokeUrl } from "./authenticated-preview-moments.test-utils";

afterEach(cleanupPrototype);

function open(id = "moment-linxiao") {
  const root = enter();
  const card = cards(root).find((item) => item.dataset.momentId === id)!;
  fireEvent.click(within(card).getByRole("link", { name: "阅读动态正文" }));
  return root;
}
function input(root: HTMLElement) { return within(reader(root)).getAllByLabelText("评论内容").at(-1) as HTMLTextAreaElement; }
function form(root: HTMLElement) { return input(root).closest("form")!; }
function text(root: HTMLElement, value: string) { inputText("评论内容", value, form(root)); }
function rows(root: HTMLElement) { return [...reader(root).querySelectorAll<HTMLElement>("[data-comment-id]")]; }
function select(root: HTMLElement, files = [new File(["picture"], "评论.png", { type: "image/png" })]) {
  input(root).focus();
  fireEvent.change(within(form(root)).getByLabelText("选择评论图片"), { target: { files } });
}
function urlCount(url: string) { return revokeUrl.mock.calls.filter(([value]) => value === url).length; }

describe("朋友圈评论编辑", () => {
  it("默认收起，聚焦展开工具和发布，空草稿失焦收起而非空草稿保留", async () => {
    // 测试目标：验证紧凑输入、按需展开和失焦草稿保留的完整用户状态。
    // 构造方法：从正文进入阅读，用真实鼠标聚焦、离开输入，再分别输入空白及非空文字。
    // 输入数据：空草稿、空白串和“想说的话”，外部目标为返回朋友圈按钮。
    // 预期行为：初始不显示发布，聚焦出现三工具和发布；空白失焦收起，有文字失焦仍展开。
    const root = open();
    const user = userEvent.setup({ document });
    expect(within(reader(root)).queryByRole("button", { name: "发表评论" })).toBeNull();
    await user.click(input(root));
    for (const label of ["添加表情", "@好友", "添加评论图片", "发表评论"]) expect(button(label, reader(root))).toBeVisible();
    expect(button("发表评论", reader(root))).toHaveTextContent("发布");
    expect(button("发表评论", reader(root))).toBeDisabled();
    await user.click(within(reader(root)).getByRole("heading", { name: "评论 1" }));
    expect(within(reader(root)).queryByRole("button", { name: "发表评论" })).toBeNull();
    inputText("评论内容", "  \n ", reader(root));
    await user.click(within(reader(root)).getByRole("heading", { name: "评论 1" }));
    expect(within(reader(root)).queryByRole("button", { name: "发表评论" })).toBeNull();
    inputText("评论内容", "想说的话", reader(root));
    await user.click(within(reader(root)).getByRole("heading", { name: "评论 1" }));
    expect(button("发表评论", reader(root))).toBeVisible();
  });

  it("点击表情及好友菜单不折叠编辑器，并在选区插入文字且恢复光标", async () => {
    // 测试目标：验证工具内焦点移动不会收起编辑器，并尊重当前正文光标或选区。
    // 构造方法：输入四字正文选中间二字，点击表情；再将光标放开头通过好友菜单提及。
    // 输入数据：“春夏秋冬”、选区[1,3]、表情😀和好友林晓。
    // 预期行为：变为“春😀冬”，随后开头出现@林晓；工具可用且输入焦点恢复至插入位置。
    const root = open();
    const user = userEvent.setup({ document });
    inputText("评论内容", "春夏秋冬", reader(root));
    input(root).setSelectionRange(1, 3);
    fireEvent.select(input(root));
    await user.click(button("添加表情", reader(root)));
    expect(button("发表评论", reader(root))).toBeVisible();
    await user.click(button("插入表情 😀", reader(root)));
    expect(input(root)).toHaveValue("春😀冬");
    expect(input(root)).toHaveFocus();
    expect(input(root).selectionStart).toBe(3);
    input(root).setSelectionRange(0, 0);
    fireEvent.select(input(root));
    await user.click(button("@好友", reader(root)));
    expect(within(reader(root)).queryByRole("button", { name: "提及 陌生人" })).toBeNull();
    await user.click(button("提及 林晓", reader(root)));
    expect(input(root).value).toMatch(/^@林晓\s+春😀冬$/);
    expect(input(root)).toHaveFocus();
    expect(input(root).selectionStart).toBe(input(root).value.indexOf("春"));
  });

  it("空编辑器内点击工具与 Escape 关闭菜单后仍可继续输入", async () => {
    // 测试目标：验证空草稿时菜单点击不被失焦处理吞掉，并能通过键盘退出菜单。
    // 构造方法：聚焦空输入打开表情菜单，用 Escape 关闭，再从好友菜单添加提及。
    // 输入数据：空草稿、Escape 和提及陈默。
    // 预期行为：工具菜单可正常打开，Escape 只关闭菜单；提及插入后发布可用。
    const root = open();
    const user = userEvent.setup({ document });
    await user.click(input(root));
    await user.click(button("添加表情", reader(root)));
    expect(button("插入表情 😀", reader(root))).toBeVisible();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(within(reader(root)).queryByRole("button", { name: "插入表情 😀" })).toBeNull();
    await user.click(button("@好友", reader(root)));
    await user.click(button("提及 陈默", reader(root)));
    expect(input(root).value).toContain("@陈默");
    expect(button("发表评论", reader(root))).not.toBeDisabled();
  });

  it.each(["", "这张照片送给你"])("纯图片或图文评论发布并转交 URL 所有权：%j", async (text) => {
    // 测试目标：验证评论选图、图文与纯图提交，以及发布后 URL 从草稿转给评论。
    // 构造方法：编辑文字并选图，模拟解码成功后发布，往返列表与主导航，再销毁原型。
    // 输入数据：评论.png、空正文或“这张照片送给你”。
    // 预期行为：加载时禁用提交；成功后新增带图评论、草稿清空；导航不释放，销毁恰一次。
    const root = open();
    const before = rows(root).length;
    inputText("评论内容", text, reader(root));
    select(root);
    expect(button("发表评论", reader(root))).toBeDisabled();
    await finishImage();
    const url = createUrl.mock.results[0].value;
    expect(button("发表评论", reader(root))).not.toBeDisabled();
    fireEvent.click(button("发表评论", reader(root)));
    expect(rows(root)).toHaveLength(before + 1);
    const posted = rows(root).at(-1)!;
    expect(posted.querySelector("img")).toHaveAttribute("src", url);
    if (text) expect(posted).toHaveTextContent(text);
    expect(input(root)).toHaveValue("");
    expect(within(form(root)).queryByRole("img")).toBeNull();
    fireEvent.click(button("返回朋友圈", root));
    readComments(root, cards(root).find((card) => card.dataset.momentId === "moment-linxiao")!);
    nav("messages"); nav("contacts"); nav("moments");
    expect(rows(root).at(-1)!.querySelector("img")).toHaveAttribute("src", url);
    expect(urlCount(url)).toBe(0);
    fireEvent.click(button("查看评论图片 1", rows(root).at(-1)!));
    expect(within(root).getByRole("dialog", { name: "图片预览" })).toBeVisible();
    fireEvent.click(button("关闭图片预览", root));
    window.__whisperAuthenticatedPrototype?.destroy();
    expect(urlCount(url)).toBe(1);
  });

  it("图片解码失败保留草稿并可重试，移除后精确释放本地资源", async () => {
    // 测试目标：验证评论图片失败、重试、移除和保留正文的恢复流程。
    // 构造方法：选图失败后重试成功，读取当前预览，再移除图片并发布剩余文字。
    // 输入数据：“文字不能丢”、评论.png、error/load 解码回调。
    // 预期行为：失败禁用提交且文字不丢，重试后可发；移除回收所有已分配 URL 且正文可发布。
    const root = open();
    inputText("评论内容", "文字不能丢", reader(root));
    select(root);
    await finishImage(0, false);
    expect(reader(root)).toHaveTextContent(/失败/);
    expect(input(root)).toHaveValue("文字不能丢");
    expect(button("发表评论", reader(root))).toBeDisabled();
    fireEvent.click(button("重新加载评论图片", reader(root)));
    await finishImage();
    expect(button("发表评论", reader(root))).not.toBeDisabled();
    fireEvent.click(button("移除评论图片 1", reader(root)));
    expect(within(form(root)).queryByRole("img")).toBeNull();
    for (const result of createUrl.mock.results) expect(urlCount(result.value)).toBe(1);
    expect(button("发表评论", reader(root))).not.toBeDisabled();
    fireEvent.click(button("发表评论", reader(root)));
    expect(rows(root).at(-1)).toHaveTextContent("文字不能丢");
  });

  it("一张图片失败后另一张成功或被移除仍保留错误，重试失败图片后恢复提交", async () => {
    // 测试目标：验证混合图片状态不会因为其他图片成功或移除而隐藏剩余失败提示。
    // 构造方法：同时选择两图，先令第一张失败、第二张成功；移除第二张，再重试第一张。
    // 输入数据：失败图.png、成功图.png，以及按 error、load、移除、retry/load 的操作顺序。
    // 预期行为：图片保持选择顺序，失败提示一直保留且禁止发布，最后重试成功才清提示并允许发布。
    const root = open();
    select(root, [new File(["bad"], "失败图.png", { type: "image/png" }), new File(["good"], "成功图.png", { type: "image/png" })]);
    const urls = createUrl.mock.results.map((result) => result.value);
    await finishImage(0, false);
    await finishImage(1);
    expect([...form(root).querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(urls);
    expect(within(form(root)).getByRole("status")).toHaveTextContent(/图片.*失败/);
    expect(button("发表评论", reader(root))).toBeDisabled();
    fireEvent.click(button("移除评论图片 2", form(root)));
    expect(within(form(root)).getByRole("status")).toHaveTextContent(/图片.*失败/);
    expect(button("发表评论", reader(root))).toBeDisabled();
    fireEvent.click(button("重新加载评论图片", form(root)));
    await finishImage();
    expect(within(form(root)).getByRole("status")).toHaveTextContent(/^$/);
    expect(button("发表评论", reader(root))).not.toBeDisabled();
  });

  it("评论点赞可逆且不丢正在编辑的回复、文字、图片与光标", async () => {
    // 测试目标：验证点赞评论的局部更新不会销毁正在编辑的草稿及输入位置。
    // 构造方法：开始回复、输入文字并选图，将光标放中间，再点赞及取消种子评论。
    // 输入数据：“正在编辑的回复”、光标3和评论.png。
    // 预期行为：点赞aria状态双向更新；文字、图片、回复目标与光标不变，URL未释放。
    const root = open();
    fireEvent.click(button("回复 陈默", rows(root)[0]));
    text(root, "正在编辑的回复");
    select(root); await finishImage();
    const url = createUrl.mock.results[0].value;
    input(root).setSelectionRange(3, 3); fireEvent.select(input(root));
    fireEvent.click(button("点赞评论", rows(root)[0]));
    expect(button("取消点赞评论", rows(root)[0])).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button("取消点赞评论", rows(root)[0]));
    expect(button("点赞评论", rows(root)[0])).toHaveAttribute("aria-pressed", "false");
    expect(input(root)).toHaveValue("正在编辑的回复");
    expect(input(root).selectionStart).toBe(3);
    expect(button("取消回复", form(root))).toBeInTheDocument();
    expect(form(root).querySelector("img")).toHaveAttribute("src", url);
    expect(urlCount(url)).toBe(0);
  });

  it("动态点赞与导航重绘保留评论草稿、图片、回复对象和选区", async () => {
    // 测试目标：验证文章级点赞及视图往返不会重置评论编辑上下文。
    // 构造方法：准备图文回复和选区，点赞动态后经过列表、消息及好友导航返回。
    // 输入数据：“保存我的选区”、选区[2,5]、评论.png、回复陈默。
    // 预期行为：各次重绘后草稿及选区原样保留，选图 URL 不被回收。
    const root = open();
    fireEvent.click(button("回复 陈默", rows(root)[0]));
    text(root, "保存我的选区");
    select(root); await finishImage();
    const url = createUrl.mock.results[0].value;
    input(root).setSelectionRange(2, 5); fireEvent.select(input(root));
    fireEvent.click(button("点赞", reader(root)));
    expect(input(root).selectionStart).toBe(2);
    expect(input(root).selectionEnd).toBe(5);
    fireEvent.click(button("返回朋友圈", root));
    readComments(root, cards(root).find((card) => card.dataset.momentId === "moment-linxiao")!);
    nav("messages"); nav("contacts"); nav("moments");
    expect(input(root)).toHaveValue("保存我的选区");
    expect(input(root).selectionStart).toBe(2);
    expect(input(root).selectionEnd).toBe(5);
    expect(button("取消回复", form(root))).toBeInTheDocument();
    expect(form(root).querySelector("img")).toHaveAttribute("src", url);
    expect(urlCount(url)).toBe(0);
  });

  it("删除自己的动态同时释放已发布及草稿评论图片，销毁不会重复回收", async () => {
    // 测试目标：验证评论图片随所属动态删除而释放，包括未发布的另一份草稿。
    // 构造方法：打开自己的动态发布一张评论图，再准备第二张评论图并删除动态。
    // 输入数据：两次评论.png 选图和确认删除自身动态。
    // 预期行为：两资源删除时恰一次回收，重复销毁原型不追加释放。
    const root = open("moment-self");
    select(root); await finishImage();
    fireEvent.click(button("发表评论", reader(root)));
    select(root); await finishImage();
    const urls = createUrl.mock.results.map((result) => result.value);
    fireEvent.click(button("删除动态", root));
    expect(reader(root)).toBeNull();
    for (const url of urls) expect(urlCount(url)).toBe(1);
    window.__whisperAuthenticatedPrototype?.destroy();
    window.__whisperAuthenticatedPrototype?.destroy();
    for (const url of urls) expect(urlCount(url)).toBe(1);
  });

  it("移除或重初始化后迟到的图片回调不会恢复废弃草稿或重复释放 URL", async () => {
    // 测试目标：验证异步图片解码在移除及实例重建后的隔离和资源回收。
    // 构造方法：保存首张图片load回调并移除，再选第二张图片后重新执行主脚本。
    // 输入数据：两张未解码评论图片、各自迟到的成功回调和一次原型重初始化。
    // 预期行为：移除及销毁各释放一次，迟到回调不产生图片，新实例评论草稿为空。
    const root = open();
    select(root);
    const firstCallback = images[0].onload;
    const firstUrl = createUrl.mock.results[0].value;
    fireEvent.click(button("移除评论图片 1", form(root)));
    firstCallback?.(); await Promise.resolve();
    expect(form(root).querySelector("img")).toBeNull();
    expect(urlCount(firstUrl)).toBe(1);
    select(root);
    const secondCallback = images.at(-1)!.onload;
    const secondUrl = createUrl.mock.results.at(-1)!.value;
    window.eval(appScript());
    secondCallback?.(); await Promise.resolve();
    nav("moments"); readComments(root, cards(root)[0]);
    expect(input(root)).toHaveValue("");
    expect(form(root).querySelector("img")).toBeNull();
    expect(urlCount(secondUrl)).toBe(1);
  });

  it("空白及500字Unicode边界正确校验，评论和提及内容按普通文本显示", () => {
    // 测试目标：验证空白、Unicode长度边界和文本安全，不因富编辑工具引入HTML执行。
    // 构造方法：依次输入空白、500/501个emoji和含HTML文本，最后正常提交。
    // 输入数据：空白串、🌸重复500/501次及“<img src=x onerror=alert(1)> @林晓”。
    // 预期行为：空白和超长禁用、500字允许；提交只生成文本，不创建恶意图片。
    const root = open();
    inputText("评论内容", " \n ", reader(root));
    expect(button("发表评论", reader(root))).toBeDisabled();
    inputText("评论内容", "🌸".repeat(500), reader(root));
    expect(button("发表评论", reader(root))).not.toBeDisabled();
    inputText("评论内容", "🌸".repeat(501), reader(root));
    expect(button("发表评论", reader(root))).toBeDisabled();
    const text = "<img src=x onerror=alert(1)> @林晓";
    inputText("评论内容", text, reader(root));
    fireEvent.click(button("发表评论", reader(root)));
    expect(rows(root).at(-1)).toHaveTextContent(text);
    expect(rows(root).at(-1)!.querySelector("img")).toBeNull();
  });

  it.each(["数量", "格式", "大小", "读取异常"])("选图%s拒绝后保留已有图文草稿", async (kind) => {
    // 测试目标：验证评论图片约束及浏览器异常不会破坏已经完成的草稿。
    // 构造方法：先选有效图并输入文字，再提交超数量、错误格式、大文件或URL分配失败。
    // 输入数据：已读评论.png、九张追加图、text/plain、20MiB+1字节图片或抛错URL函数。
    // 预期行为：错误可见，原图文不丢，违规文件不占用URL，原草稿仍可提交。
    const root = open();
    inputText("评论内容", "我的原始草稿", reader(root));
    select(root); await finishImage();
    const url = createUrl.mock.results[0].value;
    const tooLarge = new File(["image"], "过大.png", { type: "image/png" });
    Object.defineProperty(tooLarge, "size", { value: 20 * 1024 * 1024 + 1 });
    const files = kind === "数量" ? Array.from({ length: 9 }, (_, index) => new File(["image"], `${index}.png`, { type: "image/png" }))
      : kind === "格式" ? [new File(["text"], "伪装.png", { type: "text/plain" })] : kind === "大小" ? [tooLarge] : undefined;
    if (kind === "读取异常") createUrl.mockImplementationOnce(() => { throw new Error("无法读取"); });
    select(root, files);
    expect(reader(root)).toHaveTextContent(kind === "数量" ? /最多.*9/ : kind === "格式" ? /JPEG.*PNG.*WebP/ : kind === "大小" ? /20 MiB/ : /无法读取/);
    expect(input(root)).toHaveValue("我的原始草稿");
    expect(form(root).querySelector("img")).toHaveAttribute("src", url);
    expect(button("发表评论", reader(root))).not.toBeDisabled();
    expect(urlCount(url)).toBe(0);
  });
});
