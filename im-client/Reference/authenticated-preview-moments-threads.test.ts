import { fireEvent, within } from "@testing-library/react";
import { button, cards, cleanupPrototype, createUrl, enter, finishImage, images, inputText, nav, readComments, reader, revokeUrl } from "./authenticated-preview-moments.test-utils";

afterEach(cleanupPrototype);

function open(id = "moment-linxiao") {
  const root = enter();
  fireEvent.click(within(cards(root).find((card) => card.dataset.momentId === id)!).getByRole("link", { name: "阅读动态正文" }));
  return root;
}
function top(root: HTMLElement) { return reader(root).querySelector<HTMLFormElement>("[data-moments-comment-editor='top']")!; }
function inline(root: HTMLElement) { return reader(root).querySelector<HTMLFormElement>("[data-moments-comment-editor='reply']"); }
function field(form: HTMLElement) { return within(form).getByLabelText("评论内容") as HTMLTextAreaElement; }
function rows(root: HTMLElement) { return [...reader(root).querySelectorAll<HTMLElement>("[data-comment-id]")]; }
function row(root: HTMLElement, id: string) { return rows(root).find((item) => item.dataset.commentId === id)!; }
function reply(root: HTMLElement, target: HTMLElement) {
  fireEvent.click(within(target).getByRole("button", { name: /^回复 / }));
  const editor = inline(root)!;
  expect(editor).toHaveAttribute("data-reply-to-comment-id", target.dataset.commentId);
  return editor;
}
function write(editor: HTMLElement, value: string, start = value.length, end = start) {
  inputText("评论内容", value, editor);
  field(editor).setSelectionRange(start, end); fireEvent.select(field(editor));
}
function send(editor: HTMLElement) { fireEvent.click(button("发表评论", editor)); }
function postTop(root: HTMLElement, value: string) {
  const initial = new Set(rows(root).map((item) => item.dataset.commentId));
  write(top(root), value); send(top(root));
  return rows(root).find((item) => !initial.has(item.dataset.commentId))!;
}
function postReply(root: HTMLElement, target: HTMLElement, value: string) {
  const initial = new Set(rows(root).map((item) => item.dataset.commentId));
  const editor = reply(root, target); write(editor, value); send(editor);
  return rows(root).find((item) => !initial.has(item.dataset.commentId))!;
}
function select(editor: HTMLElement, name: string) {
  field(editor).focus();
  fireEvent.change(within(editor).getByLabelText("选择评论图片"), { target: { files: [new File(["picture"], name, { type: "image/png" })] } });
}
function released(url: string) { return revokeUrl.mock.calls.filter(([value]) => value === url).length; }
function back(root: HTMLElement) { fireEvent.click(button("返回朋友圈", root)); }
function reopen(root: HTMLElement, id = "moment-linxiao") { readComments(root, cards(root).find((card) => card.dataset.momentId === id)!); }

describe("朋友圈两层评论与独立回复草稿", () => {
  it("回复归入根评论的子列表，对子评论的回复仍为第二层且计数包含全部回复", () => {
    // 测试目标：验证两层归属、回复顺序、根评论回复无自动提及和回复子评论的对象前缀。
    // 构造方法：对种子根评论A发布B，再回复B生成C，随后再次回复A生成D并返回列表。
    // 输入数据：A=陈默种子评论，B=“下周一起”，C=“收到”，D=“手动 @陈默 见”。
    // 预期行为：B/C/D在A同一子列表按提交顺序排列，只有C自动显示回复对象，无第三层，总数为4。
    const root = open();
    const aId = rows(root)[0].dataset.commentId!;
    const b = postReply(root, row(root, aId), "下周一起"); const bId = b.dataset.commentId!;
    expect(b.querySelector(".moments-comment-text")).toHaveTextContent(/^下周一起$/);
    expect(b.querySelector(".moments-comment-reply-label")).toBeNull();
    const c = postReply(root, row(root, bId), "收到"); const cId = c.dataset.commentId!;
    expect(c).toHaveTextContent("回复 @林澈");
    const d = postReply(root, row(root, aId), "手动 @陈默 见"); const dId = d.dataset.commentId!;
    const children = reader(root).querySelector<HTMLElement>(`[data-comment-thread='${aId}']`)!;
    expect([...children.children].filter((item) => item.matches("[data-comment-id]")).map((item) => (item as HTMLElement).dataset.commentId)).toEqual([bId, cId, dId]);
    for (const id of [bId, cId, dId]) {
      expect(row(root, id)).toHaveAttribute("data-parent-id", aId);
      expect(row(root, id).querySelector("[data-comment-id]")).toBeNull();
    }
    expect(row(root, dId).querySelector(".moments-comment-text")).toHaveTextContent(/^手动 @陈默 见$/);
    expect(within(reader(root)).getByRole("heading", { name: "评论 4" })).toBeInTheDocument();
    back(root);
    const card = cards(root).find((item) => item.dataset.momentId === "moment-linxiao")!;
    expect(button("评论", card).querySelector(".moments-action-count")).toHaveTextContent("4");
  });

  it("顶部编辑器始终独立，最多一个行内编辑器位于被回复评论操作栏之后", () => {
    // 测试目标：验证回复框挂在准确目标下，并且切换根或子评论时不会复制出多个回复框。
    // 构造方法：先创建子评论B，随后依次回复A、B、A，检查表单数量及所在评论位置。
    // 输入数据：陈默根评论A、自行提交的子评论B和三次回复入口点击。
    // 预期行为：顶部表单保持原位；A框在A操作栏后且子列表前，B框在B操作栏后，始终最多两个总表单。
    const root = open();
    const aId = rows(root)[0].dataset.commentId!;
    const bId = postReply(root, row(root, aId), "第二层").dataset.commentId!;
    for (const id of [aId, bId, aId]) {
      const target = row(root, id); const editor = reply(root, target);
      expect(top(root)).toBeInTheDocument();
      expect(top(root).closest("[data-comment-id]")).toBeNull();
      expect(reader(root).querySelectorAll("[data-moments-comment-editor='reply']")).toHaveLength(1);
      expect(reader(root).querySelectorAll("textarea[aria-label='评论内容']")).toHaveLength(2);
      expect(editor.closest("[data-comment-id]")).toBe(target);
      expect(target.querySelector(".moments-comment-meta")!.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      if (id === aId) {
        const children = reader(root).querySelector(`[data-comment-thread='${aId}']`)!;
        expect(editor.compareDocumentPosition(children) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
    fireEvent.click(button("取消回复", inline(root)!));
    expect(inline(root)).toBeNull();
    expect(top(root)).toBeInTheDocument();
  });

  it("顶部、根目标和子目标分别保留文字图片选区，取消或切换回复不清草稿", async () => {
    // 测试目标：验证独立目标草稿的文字、图片、选区与展开状态在切换及取消时保留。
    // 构造方法：创建子评论B，分别编辑顶部、A目标、B目标并选图，再取消并依次重开。
    // 输入数据：三个不同文本及图片、顶部[1,3]、A[2,4]、B[1,2]选区。
    // 预期行为：每个目标恢复自己的内容和选区，顶部不被回复覆盖，所有URL仍有效且无回收。
    const root = open();
    const aId = rows(root)[0].dataset.commentId!;
    const bId = postReply(root, row(root, aId), "已有子评论").dataset.commentId!;
    write(top(root), "顶部草稿", 1, 3); select(top(root), "顶部.png"); await finishImage();
    field(top(root)).setSelectionRange(1, 3); fireEvent.select(field(top(root)));
    let editor = reply(root, row(root, aId)); write(editor, "回复A草稿", 2, 4); select(editor, "A.png"); await finishImage();
    field(editor).setSelectionRange(2, 4); fireEvent.select(field(editor));
    editor = reply(root, row(root, bId)); write(editor, "回复B草稿", 1, 2); select(editor, "B.png"); await finishImage();
    field(editor).setSelectionRange(1, 2); fireEvent.select(field(editor));
    fireEvent.click(button("取消回复", editor));
    expect(inline(root)).toBeNull();
    expect(field(top(root))).toHaveValue("顶部草稿");
    expect([field(top(root)).selectionStart, field(top(root)).selectionEnd]).toEqual([1, 3]);
    const urls = createUrl.mock.results.map((result) => result.value);
    expect(top(root).querySelector("img")).toHaveAttribute("src", urls[0]);
    for (const [id, text, start, end, url] of [[aId, "回复A草稿", 2, 4, urls[1]], [bId, "回复B草稿", 1, 2, urls[2]]] as const) {
      editor = reply(root, row(root, id));
      expect(field(editor)).toHaveValue(text);
      expect([field(editor).selectionStart, field(editor).selectionEnd]).toEqual([start, end]);
      expect(editor.querySelector("img")).toHaveAttribute("src", url);
      expect(button("发表评论", editor)).toBeVisible();
    }
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it("发布只清空当前目标并收起，对其他目标及顶部草稿不产生影响", () => {
    // 测试目标：验证顶部和行内提交互相隔离，切换过的其他回复目标仍保留未发布草稿。
    // 构造方法：为A、B、顶部各存草稿，在B行内开启时先发布顶部，再发布B，最后重开A和B。
    // 输入数据：“A未完成”“B已完成”“顶部已完成”及三个不同提交目标。
    // 预期行为：顶部发布后仅顶部为空且收起；B仍可提交，提交后B为空收起，A原文仍保留。
    const root = open();
    const aId = rows(root)[0].dataset.commentId!;
    const bId = postReply(root, row(root, aId), "子评论B").dataset.commentId!;
    write(reply(root, row(root, aId)), "A未完成");
    write(reply(root, row(root, bId)), "B已完成");
    write(top(root), "顶部已完成"); send(top(root));
    expect(field(top(root))).toHaveValue("");
    expect(within(top(root)).queryByRole("button", { name: "发表评论" })).toBeNull();
    expect(field(inline(root)!)).toHaveValue("B已完成");
    send(inline(root)!);
    expect(inline(root)).toBeNull();
    expect(field(reply(root, row(root, aId)))).toHaveValue("A未完成");
    const emptyB = reply(root, row(root, bId));
    expect(field(emptyB)).toHaveValue("");
    expect(button("发表评论", emptyB)).toBeDisabled();
    expect(rows(root).some((item) => item.querySelector(".moments-comment-text")?.textContent === "顶部已完成")).toBe(true);
    expect(rows(root).some((item) => item.querySelector(".moments-comment-text")?.textContent?.includes("B已完成"))).toBe(true);
  });

  it("列表和主导航往返恢复活动回复目标，另一动态仍使用独立顶部草稿", () => {
    // 测试目标：验证阅读导航保留当前回复位置、选区和目标，并隔离不同动态的编辑内容。
    // 构造方法：在林晓动态根评论写回复，再进入自己的动态写顶部草稿，随后导航返回原动态。
    // 输入数据：A回复“原目标草稿”选区[1,4]、自身动态顶部“另一动态”、消息/好友导航。
    // 预期行为：每条动态恢复独立上下文；林晓仍打开原A行内框且选区原样保留。
    const root = open();
    const aId = rows(root)[0].dataset.commentId!;
    write(reply(root, row(root, aId)), "原目标草稿", 1, 4);
    back(root); reopen(root, "moment-self");
    write(top(root), "另一动态");
    back(root); reopen(root);
    expect(inline(root)).toHaveAttribute("data-reply-to-comment-id", aId);
    expect(field(inline(root)!)).toHaveValue("原目标草稿");
    expect([field(inline(root)!).selectionStart, field(inline(root)!).selectionEnd]).toEqual([1, 4]);
    expect(field(top(root))).toHaveValue("");
    nav("messages"); nav("contacts"); nav("moments");
    expect(inline(root)).toHaveAttribute("data-reply-to-comment-id", aId);
    expect(field(inline(root)!)).toHaveValue("原目标草稿");
    back(root); reopen(root, "moment-self");
    expect(field(top(root))).toHaveValue("另一动态");
    expect(inline(root)).toBeNull();
  });

  it("切换回复期间迟到的图片回调只更新所属草稿，不释放或串入其他目标", async () => {
    // 测试目标：验证目标切换后异步解码结果正确归属，且取消回复不回收仍可继续的图片。
    // 构造方法：A选图未完成时切到B并选图成功，再触发A回调，最后取消并返回A。
    // 输入数据：A待加载图、B成功图、A迟到onload和两次目标切换。
    // 预期行为：B只显示自己的图，A重开显示已成功的A图；两资源在切换及取消后均未回收。
    const root = open();
    const aId = rows(root)[0].dataset.commentId!;
    const bId = postReply(root, row(root, aId), "子评论B").dataset.commentId!;
    select(reply(root, row(root, aId)), "A待加载.png");
    const delayed = images[0].onload;
    const urlA = createUrl.mock.results[0].value;
    select(reply(root, row(root, bId)), "B成功.png"); await finishImage(1);
    const urlB = createUrl.mock.results[1].value;
    delayed?.(); await Promise.resolve();
    expect(inline(root)!.querySelector("img")).toHaveAttribute("src", urlB);
    fireEvent.click(button("取消回复", inline(root)!));
    const editorA = reply(root, row(root, aId));
    expect(editorA.querySelector("img")).toHaveAttribute("src", urlA);
    expect(button("发表评论", editorA)).not.toBeDisabled();
    expect(released(urlA)).toBe(0); expect(released(urlB)).toBe(0);
  });

  it("删除动态及销毁统一释放各目标草稿和已发布回复图片，迟到回调不复活资源", async () => {
    // 测试目标：验证同一动态所有顶部及行内目标的资源均受统一生命周期管理。
    // 构造方法：在自己动态创建A/B，发布B图评论，再给顶部、A、B各选一图并保留最后加载回调，删除后销毁。
    // 输入数据：四张本地图，前三张解码成功、最后一张未完成，以及确认删除和迟到onload。
    // 预期行为：删除时四URL各释放一次，迟到回调及重复销毁均不产生重复释放或复活编辑框。
    const root = open("moment-self");
    const aId = postTop(root, "根评论A").dataset.commentId!;
    let editor = reply(root, row(root, aId)); select(editor, "已发布.png"); await finishImage(); send(editor);
    const bId = rows(root).at(-1)!.dataset.commentId!;
    select(top(root), "顶部草稿.png"); await finishImage();
    select(reply(root, row(root, aId)), "A草稿.png"); await finishImage();
    select(reply(root, row(root, bId)), "B未加载.png");
    const delayed = images.at(-1)!.onload;
    const urls = createUrl.mock.results.map((result) => result.value);
    fireEvent.click(button("删除动态", root));
    delayed?.(); await Promise.resolve();
    expect(reader(root)).toBeNull();
    for (const url of urls) expect(released(url)).toBe(1);
    window.__whisperAuthenticatedPrototype?.destroy(); window.__whisperAuthenticatedPrototype?.destroy();
    for (const url of urls) expect(released(url)).toBe(1);
  });

  it("评论和动态点赞不干扰顶部及行内草稿的文字、图和选区", async () => {
    // 测试目标：验证两个同时存在的编辑器在文章及评论点赞局部更新后保持独立状态。
    // 构造方法：顶部写文保选区、A回复选图写文后，依次切换评论点赞和动态点赞。
    // 输入数据：顶部“顶部不丢”[1,2]、回复“行内不丢”[2,3]及一张回复图。
    // 预期行为：两份草稿和选区均不变，回复图片URL保持有效，点赞状态正常更新。
    const root = open();
    const aId = rows(root)[0].dataset.commentId!;
    write(top(root), "顶部不丢", 1, 2);
    let editor = reply(root, row(root, aId)); select(editor, "回复图.png"); await finishImage(); write(editor, "行内不丢", 2, 3);
    fireEvent.click(button("点赞评论", row(root, aId)));
    expect(button("取消点赞评论", row(root, aId))).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button("点赞", reader(root)));
    expect(button("取消点赞", reader(root))).toHaveAttribute("aria-pressed", "true");
    editor = inline(root)!;
    expect(field(top(root))).toHaveValue("顶部不丢");
    expect([field(top(root)).selectionStart, field(top(root)).selectionEnd]).toEqual([1, 2]);
    expect(field(editor)).toHaveValue("行内不丢");
    expect([field(editor).selectionStart, field(editor).selectionEnd]).toEqual([2, 3]);
    expect(editor.querySelector("img")).toHaveAttribute("src", createUrl.mock.results[0].value);
    expect(revokeUrl).not.toHaveBeenCalled();
  });
});
