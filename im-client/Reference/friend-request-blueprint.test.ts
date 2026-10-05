import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

const referenceDir = resolve(process.cwd(), "Reference");
const htmlPath = resolve(referenceDir, "friend-request-blueprint.html");
const scriptPath = resolve(referenceDir, "friend-request-blueprint.js");

function element<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  expect(found, `应找到 ${selector}`).not.toBeNull();
  return found!;
}

function click(selector: string): void {
  element<HTMLElement>(selector).click();
}

function fill(selector: string, value: string): void {
  const input = element<HTMLInputElement | HTMLTextAreaElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function search(account: string): void {
  click("[data-open-search]");
  expect(element("[data-search-dialog]")).not.toHaveAttribute("hidden");
  fill("[data-account-input]", account);
  click("[data-search-submit]");
}

function sendTo(account: string, verification = "你好，我是林澈，想认识你。") {
  search(account);
  click("[data-search-add]");
  expect(element("[data-apply-dialog]")).not.toHaveAttribute("hidden");
  fill("[data-verification-input]", verification);
  click("[data-send-request]");
}

function switchUser(user: "a" | "b") {
  click(`[data-switch-user='${user}']`);
}

function requestCard(account: string): HTMLElement {
  const card = Array.from(document.querySelectorAll<HTMLElement>("[data-request-card]"))
    .find((item) => item.textContent?.includes(account));
  expect(card, `应显示账号 ${account} 的申请`).toBeDefined();
  return card!;
}

function pendingCount(): number {
  return Number(element("[data-pending-count]").textContent?.trim());
}

function expectViewTitle(title: string): void {
  expect(element("[data-view-title]")).toHaveTextContent(title);
  const repeatedHeadings = Array.from(element("[data-detail-panel]").querySelectorAll("h1, h2, h3"))
    .filter((heading) => heading.textContent?.trim() === title);
  expect(repeatedHeadings).toHaveLength(0);
}

beforeEach(() => {
  document.open();
  document.write(readFileSync(htmlPath, "utf8"));
  document.close();
  window.eval(readFileSync(scriptPath, "utf8"));
});

describe("添加好友独立蓝图", () => {
  it("四种右侧视图共用顶栏标题且内容区不重复标题", () => {
    // 测试目标：验证申请、群聊、好友资料和模拟单聊的标题只出现在顶栏。
    // 构造方法：载入蓝图后依次进入群聊、现有好友 C 的资料和模拟单聊，再返回申请。
    // 输入数据：初始 A 账号，现有好友 C=00100003，四种视图入口。
    // 预期行为：顶栏依次显示好友申请、群聊、好友资料、单聊预览、好友申请；右侧内容没有同名标题。
    expectViewTitle("好友申请");
    click("[data-group-preview]");
    expectViewTitle("群聊");
    expect(element("[data-detail-panel]")).toHaveTextContent("群聊敬请期待");
    click("[data-friend-list] [data-open-friend='c']");
    expectViewTitle("好友资料");
    expect(element("[data-detail-panel]")).toHaveTextContent("顾言");
    click("[data-open-chat]");
    expectViewTitle("单聊预览");
    expect(element("[data-detail-panel]")).toHaveTextContent("顾言");
    click("[data-back-requests]");
    expectViewTitle("好友申请");
  });

  it("按完整账号命中用户并在发送前显示其资料", () => {
    // 测试目标：验证“+ 朋友”只按完整账号搜索，并从结果卡进入申请弹框。
    // 构造方法：加载真实蓝图 DOM 和脚本，打开搜索框，搜索 B 并点击添加。
    // 输入数据：B 的账号 00100002。
    // 预期行为：结果包含 B 的昵称和账号，申请弹框显示同一目标且可填写验证信息。
    search("00100002");
    expect(element("[data-search-profile]")).toHaveTextContent("周宁");
    expect(element("[data-search-profile]")).toHaveTextContent("00100002");
    click("[data-search-add]");
    expect(element("[data-apply-target]")).toHaveTextContent("周宁");
    expect(element("[data-apply-target]")).toHaveTextContent("00100002");
    expect(element<HTMLTextAreaElement>("[data-verification-input]")).toBeVisible();
  });

  it("对非法账号、未命中账号、自身和已有好友给出可辨别反馈", () => {
    // 测试目标：验证仅接受数字账号搜索，且不会向自己或已有好友发起申请。
    // 构造方法：在同一搜索弹框中依次输入四种账号，每次点击搜索并检查结果。
    // 输入数据：abc、00109999、当前账号 00100001、现有好友 00100003。
    // 预期行为：前两者无可添加用户，自身和好友显示状态但不提供可执行的添加按钮。
    search("abc");
    expect(element("[data-search-result]")).not.toHaveTextContent("周宁");
    expect(document.querySelector("[data-search-add]")).toBeNull();

    fill("[data-account-input]", "00109999");
    click("[data-search-submit]");
    expect(document.querySelector("[data-search-add]")).toBeNull();

    fill("[data-account-input]", "00100001");
    click("[data-search-submit]");
    expect(element("[data-search-result]")).toHaveTextContent("林澈");
    const selfAdd = document.querySelector<HTMLButtonElement>("[data-search-add]");
    if (selfAdd) expect(selfAdd).toBeDisabled();

    fill("[data-account-input]", "00100003");
    click("[data-search-submit]");
    expect(element("[data-search-result]")).toHaveTextContent("顾言");
    const friendAdd = document.querySelector<HTMLButtonElement>("[data-search-add]");
    if (friendAdd) expect(friendAdd).toBeDisabled();
  });

  it("取消申请不产生请求，空验证信息仍可发送", () => {
    // 测试目标：验证取消不改变接收方待处理数量，验证信息可留空发送。
    // 构造方法：A 搜索 B 并取消申请，再次搜索、清空文本并发送，切到 B 查看。
    // 输入数据：B=00100002，验证信息为空字符串。
    // 预期行为：取消后 B 仅有预置申请；发送后 B 多出 A 的申请，空验证内容被如实展示。
    search("00100002");
    click("[data-search-add]");
    click("[data-cancel-apply]");
    switchUser("b");
    expect(pendingCount()).toBe(1);

    switchUser("a");
    sendTo("00100002", "");
    expect(element("[data-status]")).toHaveTextContent("申请已发送");
    switchUser("b");
    expect(pendingCount()).toBe(2);
    click("[data-open-requests]");
    requestCard("00100001").click();
    expect(element("[data-detail-panel]")).toHaveTextContent("林澈");
    expect(element("[data-detail-panel]")).toHaveTextContent("00100001");
  });

  it("重复发起申请不会创建第二条待处理记录", () => {
    // 测试目标：验证同一发送方对同一接收方不能生成重复待处理申请。
    // 构造方法：A 对 B 发送一次申请，重新搜索 B 并尝试再次添加，然后切到 B。
    // 输入数据：A=00100001，B=00100002，两次申请内容分别为“一次”和“二次”。
    // 预期行为：B 只看到一条来自 A 的待处理申请，待处理数含预置申请共为 2。
    sendTo("00100002", "一次");
    search("00100002");
    const secondAdd = document.querySelector<HTMLButtonElement>("[data-search-add]");
    if (secondAdd && !secondAdd.disabled) {
      secondAdd.click();
      fill("[data-verification-input]", "二次");
      click("[data-send-request]");
    }
    switchUser("b");
    click("[data-open-requests]");
    expect(pendingCount()).toBe(2);
    expect(Array.from(document.querySelectorAll("[data-request-card]"))
      .filter((card) => card.textContent?.includes("00100001"))).toHaveLength(1);
  });

  it("多条申请直接显示在右侧，顺序与操作保持正常", () => {
    // 测试目标：验证 B 的申请列表从卡片起始、待处理数保留且每条申请可独立操作。
    // 构造方法：保留预置 D 请求，再让 A 发给 B；B 打开新朋友，依次处理 A 与 D。
    // 输入数据：D=00100004、A=00100001，A 验证信息为“我是林澈”。
    // 预期行为：顶栏仍是好友申请，首个内容节点是新申请 A，随后是 D；同意 A、拒绝 D 后数量递减。
    sendTo("00100002", "我是林澈");
    switchUser("b");
    expect(pendingCount()).toBe(2);
    click("[data-open-requests]");
    expect(pendingCount()).toBe(2);
    expectViewTitle("好友申请");
    const panel = element("[data-detail-panel]");
    const cards = Array.from(panel.querySelectorAll<HTMLElement>("[data-request-card]"));
    expect(cards).toHaveLength(2);
    expect(panel.firstElementChild).toBe(cards[0]);
    expect(cards[0]).toHaveTextContent("林澈");
    expect(cards[0]).toHaveTextContent("00100001");
    expect(cards[0]).toHaveTextContent("我是林澈");
    expect(cards[1]).toHaveTextContent("许遥");
    expect(cards[1]).toHaveTextContent("00100004");
    expect(cards[1]).toHaveTextContent("你好，我是许遥，想认识你。");
    expect(cards[0].querySelector("[data-request-accept]")).not.toBeNull();
    expect(cards[1].querySelector("[data-request-reject]")).not.toBeNull();
    cards[0].querySelector<HTMLElement>("[data-request-accept]")!.click();
    expect(pendingCount()).toBe(1);
    requestCard("00100004").querySelector<HTMLElement>("[data-request-reject]")!.click();
    expect(pendingCount()).toBe(0);
    expectViewTitle("好友申请");
  });

  it("同意申请后双方成为好友，但需手动打开模拟单聊", () => {
    // 测试目标：验证同意请求建立双向好友关系且不会自动跳转到聊天。
    // 构造方法：A 申请 B；B 在详情同意，检查当前界面，再切回 A 打开聊天入口。
    // 输入数据：A=00100001、B=00100002、验证信息“认识一下”。
    // 预期行为：B 待处理数回到 1；双方好友资料可见；仅点击模拟单聊按钮后才显示聊天预览。
    sendTo("00100002", "认识一下");
    switchUser("b");
    click("[data-open-requests]");
    requestCard("00100001").click();
    click("[data-request-accept]");
    expect(pendingCount()).toBe(1);
    expect(element("[data-friend-list]")).toHaveTextContent("林澈");
    expect(element("[data-friend-list]")).toHaveTextContent("00100001");
    click("[data-friend-list] [data-open-friend='a']");
    expectViewTitle("好友资料");
    expect(element("[data-detail-panel]")).toHaveTextContent("林澈");
    expect(element("[data-detail-panel]")).not.toHaveTextContent("单聊预览");

    switchUser("a");
    expect(element("[data-friend-list]")).toHaveTextContent("周宁");
    expect(element("[data-friend-list]")).toHaveTextContent("00100002");
    click("[data-friend-list] [data-open-friend='b']");
    expectViewTitle("好友资料");
    expect(element("[data-detail-panel]")).toHaveTextContent("周宁");
    expect(element("[data-detail-panel]")).not.toHaveTextContent("单聊预览");
    click("[data-open-chat]");
    expectViewTitle("单聊预览");
    expect(element("[data-detail-panel]")).toHaveTextContent("周宁");
  });

  it("拒绝申请后仅清除该条待处理状态且不建立好友", () => {
    // 测试目标：验证拒绝不会误处理其他申请，也不会产生好友关系。
    // 构造方法：B 有预置 D 请求时，再让 A 发给 B；B 选中 A 并拒绝。
    // 输入数据：A=00100001、B=00100002、D=00100004。
    // 预期行为：B 待处理数量从 2 降为 1，D 申请仍可查看，A/B 无好友聊天入口。
    sendTo("00100002");
    switchUser("b");
    click("[data-open-requests]");
    requestCard("00100001").click();
    click("[data-request-reject]");
    expect(pendingCount()).toBe(1);
    requestCard("00100004").click();
    expect(element("[data-detail-panel]")).toHaveTextContent("许遥");
    switchUser("a");
    expect(element("[data-friend-list]").querySelector("[data-open-friend='b']")).toBeNull();
  });

  it("离线接收方上线后仍能看到申请", () => {
    // 测试目标：验证对方离线时发送的申请会在其上线后保留。
    // 构造方法：先切换为对方离线，A 发送给 B，再切换到 B 查看请求。
    // 输入数据：B=00100002，验证信息“离线时发送”。
    // 预期行为：离线发送不会丢失，B 上线后待处理数为 2，详情保留验证信息。
    click("[data-toggle-peer-online]");
    expect(element("[data-toggle-peer-online]")).toHaveAttribute("aria-pressed", "false");
    sendTo("00100002", "离线时发送");
    switchUser("b");
    expect(pendingCount()).toBe(2);
    click("[data-open-requests]");
    requestCard("00100001").click();
    expect(element("[data-detail-panel]")).toHaveTextContent("离线时发送");
  });

  it("接收方在线时立即显示收到申请的预览提示", () => {
    // 测试目标：验证在线演示模式在发出申请后立即更新对方收到申请的提示。
    // 构造方法：保持 B 在线，A 发送申请，检查页面提示并切到 B 的新朋友列表。
    // 输入数据：B=00100002，验证信息“在线时发送”。
    // 预期行为：A 立即看到实时收到提示，B 无需重载页面即可看到来自 A 的申请。
    expect(element("[data-toggle-peer-online]")).toHaveAttribute("aria-pressed", "true");
    sendTo("00100002", "在线时发送");
    expect(element("[data-peer-notice]")).toHaveTextContent("实时收到申请");
    switchUser("b");
    expect(pendingCount()).toBe(2);
    click("[data-open-requests]");
    expect(requestCard("00100001")).toHaveTextContent("在线时发送");
  });

  it("默认显示收到的申请，发出页展示预置已通过和已拒绝记录", () => {
    // 测试目标：验证申请方向默认值及发出卡的对方资料、我的验证信息和只读状态。
    // 构造方法：A 初始进入新的朋友，切到发出的申请并读取两条预置卡片。
    // 输入数据：A→C 已通过，验证“我们已是好友。”；A→D 已拒绝，验证“你好，我想加你为好友。”。
    // 预期行为：默认收到被选中；发出卡显示 C、D 的昵称账号、验证与状态，均无同意拒绝按钮。
    expect(element("[data-request-direction='incoming']")).toHaveAttribute("aria-pressed", "true");
    expect(element("[data-request-direction='outgoing']")).toHaveAttribute("aria-pressed", "false");
    click("[data-request-direction='outgoing']");
    expect(element("[data-request-direction='outgoing']")).toHaveAttribute("aria-pressed", "true");
    expectViewTitle("好友申请");
    const accepted = requestCard("00100003");
    expect(accepted).toHaveTextContent("顾言");
    expect(accepted).toHaveTextContent("我们已是好友。");
    expect(accepted).toHaveTextContent("已通过");
    const rejected = requestCard("00100004");
    expect(rejected).toHaveTextContent("许遥");
    expect(rejected).toHaveTextContent("你好，我想加你为好友。");
    expect(rejected).toHaveTextContent("已拒绝");
    for (const card of [accepted, rejected]) {
      expect(card).toHaveTextContent("我发送的验证信息");
      expect(card.querySelector("[data-request-accept], [data-request-reject]")).toBeNull();
    }
  });

  it("发出申请在接收方同意后从未处理更新为已通过", () => {
    // 测试目标：验证 A 发给 B 的出站记录随 B 的同意实时更新，且出站不能直接操作。
    // 构造方法：A 发申请并切到发出页；B 切到收到页同意；A 再看发出页。
    // 输入数据：A→B，验证“请通过我的申请”。
    // 预期行为：发出卡先显示未处理，B 同意后同卡显示已通过，无同意或拒绝按钮。
    sendTo("00100002", "请通过我的申请");
    click("[data-request-direction='outgoing']");
    expect(requestCard("00100002")).toHaveTextContent("未处理");
    expect(requestCard("00100002").querySelector("[data-request-accept], [data-request-reject]")).toBeNull();
    switchUser("b");
    expect(element("[data-request-direction='incoming']")).toHaveAttribute("aria-pressed", "true");
    requestCard("00100001").querySelector<HTMLElement>("[data-request-accept]")!.click();
    switchUser("a");
    click("[data-request-direction='outgoing']");
    expect(requestCard("00100002")).toHaveTextContent("已通过");
    expect(requestCard("00100002")).toHaveTextContent("请通过我的申请");
  });

  it("停留在发出页搜索并发送后立即看到新的未处理卡", () => {
    // 测试目标：验证从发出的申请页发起新申请后，当前列表立即刷新且保留方向。
    // 构造方法：A 先切到发出页，点击左栏朋友入口搜索 B，在申请弹框发送并观察同一页面。
    // 输入数据：B=00100002，验证信息“从发出页发送”。
    // 预期行为：方向仍为发出，B 的新卡立即显示未处理和验证信息，无需再次切换方向。
    click("[data-request-direction='outgoing']");
    sendTo("00100002", "从发出页发送");
    expect(element("[data-request-direction='outgoing']")).toHaveAttribute("aria-pressed", "true");
    expectViewTitle("好友申请");
    const card = requestCard("00100002");
    expect(card).toHaveTextContent("周宁");
    expect(card).toHaveTextContent("未处理");
    expect(card).toHaveTextContent("从发出页发送");
  });

  it("发出申请在接收方拒绝后更新为已拒绝", () => {
    // 测试目标：验证 A 发给 B 的出站记录随 B 的拒绝更新。
    // 构造方法：A 发申请，B 在收到页拒绝，A 返回发出页查看状态。
    // 输入数据：A→B，验证“这是一条待拒绝申请”。
    // 预期行为：A 的 B 卡显示已拒绝且保留原验证信息，不出现接收方操作按钮。
    sendTo("00100002", "这是一条待拒绝申请");
    switchUser("b");
    requestCard("00100001").querySelector<HTMLElement>("[data-request-reject]")!.click();
    switchUser("a");
    click("[data-request-direction='outgoing']");
    const card = requestCard("00100002");
    expect(card).toHaveTextContent("已拒绝");
    expect(card).toHaveTextContent("这是一条待拒绝申请");
    expect(card.querySelector("[data-request-accept], [data-request-reject]")).toBeNull();
  });

  it("出站为空时显示空态，未处理徽标只计收到的申请", () => {
    // 测试目标：验证 B 无发出申请时的空态，并确认出站切换不消费收到的待处理徽标。
    // 构造方法：先核对 A 的出站预置记录不计入徽标，再切到 B 的发出页并返回收到页。
    // 输入数据：A 有两条已处理出站；B 有 D→B 一条未处理入站、无出站。
    // 预期行为：A 徽标为 0；B 出站为空并显示专属文案，徽标始终为 1，返回仍可见 D 申请。
    expect(pendingCount()).toBe(0);
    expect(element("[data-pending-count]")).toHaveAttribute("hidden");
    switchUser("b");
    expect(pendingCount()).toBe(1);
    click("[data-request-direction='outgoing']");
    expect(element("[data-detail-panel]")).toHaveTextContent("暂无发出的好友申请");
    expect(document.querySelector("[data-request-card]")).toBeNull();
    expect(pendingCount()).toBe(1);
    click("[data-request-direction='incoming']");
    expect(pendingCount()).toBe(1);
    expect(requestCard("00100004")).toHaveTextContent("许遥");
  });

  it("离开申请视图隐藏方向切换，返回保留方向而切号重置收到", () => {
    // 测试目标：验证方向切换只在申请视图显示，并在导航返回与模拟账号切换时使用正确状态。
    // 构造方法：A 选发出，分别进入群聊、好友资料和模拟单聊，返回申请后切到 B。
    // 输入数据：A 的发出方向、群聊与 C 好友入口、B 切号按钮。
    // 预期行为：三个非申请视图都隐藏方向组；返回仍选发出；切到 B 重置为收到并显示 D 申请。
    click("[data-request-direction='outgoing']");
    click("[data-group-preview]");
    expect(element("[data-request-direction-group]")).not.toBeVisible();
    click("[data-open-requests]");
    expect(element("[data-request-direction-group]")).toBeVisible();
    expect(element("[data-request-direction='outgoing']")).toHaveAttribute("aria-pressed", "true");
    expect(requestCard("00100003")).toHaveTextContent("已通过");
    click("[data-friend-list] [data-open-friend='c']");
    expect(element("[data-request-direction-group]")).not.toBeVisible();
    click("[data-open-chat]");
    expect(element("[data-request-direction-group]")).not.toBeVisible();
    click("[data-back-requests]");
    expect(element("[data-request-direction='outgoing']")).toHaveAttribute("aria-pressed", "true");
    switchUser("b");
    expect(element("[data-request-direction='incoming']")).toHaveAttribute("aria-pressed", "true");
    expect(requestCard("00100004")).toHaveTextContent("待处理");
  });
});
