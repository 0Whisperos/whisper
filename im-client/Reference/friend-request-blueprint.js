(function () {
  "use strict";

  var root = document.querySelector("[data-blueprint-root]");
  if (!root) return;

  var users = {
    a: { id: "a", nickname: "林澈", account: "00100001", initial: "林" },
    b: { id: "b", nickname: "周宁", account: "00100002", initial: "周" },
    c: { id: "c", nickname: "顾言", account: "00100003", initial: "顾" },
    d: { id: "d", nickname: "许遥", account: "00100004", initial: "许" }
  };
  var friendships = new Set(["a:c"]);
  var requests = [
    { id: 1, from: "d", to: "b", verification: "你好，我是许遥，想认识你。", state: "pending" },
    { id: 2, from: "a", to: "c", verification: "我们已是好友。", state: "accepted" },
    { id: 3, from: "a", to: "d", verification: "你好，我想加你为好友。", state: "rejected" }
  ];
  var online = { a: true, b: true, c: false, d: false };
  var state = { current: "a", view: "requests", requestDirection: "incoming", applyTarget: null, searchedAccount: "", notice: null, nextRequestId: 4, selectedRequest: null, lastFocus: null };

  var currentUser = root.querySelector("[data-current-user]");
  var peerToggle = root.querySelector("[data-toggle-peer-online]");
  var peerNotice = root.querySelector("[data-peer-notice]");
  var pendingCount = root.querySelector("[data-pending-count]");
  var viewTitle = root.querySelector("[data-view-title]");
  var directionGroup = root.querySelector("[data-request-direction-group]");
  var detailPanel = root.querySelector("[data-detail-panel]");
  var friendList = root.querySelector("[data-friend-list]");
  var emptyFriendList = root.querySelector(".bp-empty-list");
  var searchDialog = root.querySelector("[data-search-dialog]");
  var searchForm = root.querySelector("[data-search-form]");
  var accountInput = root.querySelector("[data-account-input]");
  var searchResult = root.querySelector("[data-search-result]");
  var searchPlaceholder = root.querySelector("[data-search-placeholder]");
  var applyDialog = root.querySelector("[data-apply-dialog]");
  var applyTarget = root.querySelector("[data-apply-target]");
  var verificationInput = root.querySelector("[data-verification-input]");
  var status = root.querySelector("[data-status]");
  if (!currentUser || !peerToggle || !peerNotice || !pendingCount || !detailPanel || !searchDialog || !accountInput || !searchResult || !applyDialog || !applyTarget || !verificationInput || !status) return;

  function element(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function button(content, className, attribute, value) {
    var node = element("button", className, content);
    node.type = "button";
    node.setAttribute(attribute, value === undefined ? "" : String(value));
    return node;
  }

  function avatar(user) {
    var node = element("span", "bp-avatar", user.initial);
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  function friendshipKey(first, second) {
    return [first, second].sort().join(":");
  }

  function areFriends(first, second) {
    return friendships.has(friendshipKey(first, second));
  }

  function findRequest(first, second) {
    return requests.find(function (request) {
      return request.from === first && request.to === second || request.from === second && request.to === first;
    });
  }

  function pendingFor(userId) {
    return requests.filter(function (request) { return request.to === userId && request.state === "pending"; });
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function activeDialog() {
    if (!applyDialog.hidden) return applyDialog;
    if (!searchDialog.hidden) return searchDialog;
    return null;
  }

  function showDialog(dialog, focusTarget) {
    var open = activeDialog();
    if (!open) state.lastFocus = document.activeElement;
    if (open && open !== dialog) open.hidden = true;
    dialog.hidden = false;
    if (focusTarget) focusTarget.focus();
  }

  function closeDialog(dialog) {
    dialog.hidden = true;
    if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
    state.lastFocus = null;
  }

  function returnToSearch() {
    state.applyTarget = null;
    applyDialog.hidden = true;
    searchDialog.hidden = false;
    accountInput.focus();
  }

  function closeAllDialogs() {
    applyDialog.hidden = true;
    searchDialog.hidden = true;
    if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
    state.lastFocus = null;
  }

  function peerId() { return state.current === "a" ? "b" : "a"; }

  function renderHeader() {
    var self = users[state.current];
    var peer = users[peerId()];
    currentUser.textContent = self.nickname + " · " + self.account;
    root.querySelectorAll("[data-switch-user]").forEach(function (node) {
      node.setAttribute("aria-pressed", String(node.getAttribute("data-switch-user") === state.current));
    });
    peerToggle.setAttribute("aria-pressed", String(online[peer.id]));
    peerToggle.textContent = peer.nickname + (online[peer.id] ? "在线" : "离线");
    if (state.notice && state.notice.to === peer.id && online[peer.id]) {
      peerNotice.textContent = peer.nickname + "实时收到申请 · 未处理 " + pendingFor(peer.id).length + " 条";
    } else if (online[peer.id]) {
      peerNotice.textContent = "对方在线，可实时看到申请";
    } else {
      peerNotice.textContent = "对方离线，上线后会看到申请";
    }
    var count = pendingFor(self.id).length;
    pendingCount.textContent = String(count);
    pendingCount.hidden = count === 0;
    renderContacts();
  }

  function renderContacts() {
    if (!friendList) {
      friendList = element("div", "bp-friend-list");
      friendList.setAttribute("data-friend-list", "");
      if (emptyFriendList) emptyFriendList.after(friendList);
    }
    friendList.replaceChildren();
    var friends = Object.values(users).filter(function (user) { return user.id !== state.current && areFriends(state.current, user.id); });
    if (emptyFriendList) emptyFriendList.hidden = friends.length > 0;
    friends.forEach(function (friend) {
      var entry = button(friend.nickname + " · " + friend.account, "bp-nav-row bp-friend-row", "data-open-friend", friend.id);
      entry.setAttribute("aria-label", "查看好友 " + friend.nickname);
      entry.classList.toggle("is-selected", state.view === "friend:" + friend.id || state.view === "chat:" + friend.id);
      friendList.appendChild(entry);
    });
  }

  function setView(view) {
    state.view = view;
    root.querySelectorAll("[data-open-requests]").forEach(function (node) {
      node.classList.toggle("is-selected", view === "requests");
    });
    renderContacts();
    renderDetails();
  }

  function profileBlock(user) {
    var profile = element("div", "bp-profile-card");
    profile.appendChild(avatar(user));
    var text = element("div", "bp-profile-copy");
    text.appendChild(element("strong", "bp-profile-name", user.nickname));
    text.appendChild(element("span", "bp-card-meta", "账号 " + user.account));
    profile.appendChild(text);
    return profile;
  }

  function renderRequests() {
    detailPanel.replaceChildren();
    var outgoing = state.requestDirection === "outgoing";
    var visible = requests.filter(function (request) {
      return outgoing ? request.from === state.current : request.to === state.current;
    }).slice().reverse();
    if (!visible.length) {
      detailPanel.appendChild(element("p", "bp-empty-state", outgoing ? "暂无发出的好友申请。" : "暂无收到的好友申请。"));
      return;
    }
    visible.forEach(function (request) {
      var other = users[outgoing ? request.to : request.from];
      var card = element("article", "bp-request-card");
      card.setAttribute("data-request-card", "");
      card.setAttribute("data-request-id", String(request.id));
      card.setAttribute("data-request-direction-card", outgoing ? "outgoing" : "incoming");
      card.tabIndex = 0;
      card.classList.toggle("is-selected", state.selectedRequest === request.id);
      card.appendChild(profileBlock(other));
      var stateText = outgoing
        ? request.state === "pending" ? "未处理" : request.state === "accepted" ? "已通过" : "已拒绝"
        : request.state === "pending" ? "待处理" : request.state === "accepted" ? "已同意" : "已拒绝";
      var label = element("span", "bp-request-state", stateText);
      card.appendChild(label);
      card.appendChild(element("p", "bp-field-label", outgoing ? "我发送的验证信息" : "验证信息"));
      var verification = element("p", "bp-verification", request.verification || "未填写验证信息");
      verification.setAttribute("data-request-verification", "");
      card.appendChild(verification);
      var actions = element("div", "bp-inline-actions");
      if (!outgoing && request.state === "pending") {
        actions.appendChild(button("同意", "bp-primary", "data-request-accept", request.id));
        actions.appendChild(button("拒绝", "bp-secondary", "data-request-reject", request.id));
      }
      card.appendChild(actions);
      detailPanel.appendChild(card);
    });
  }

  function renderChat() {
    var peer = users[state.view.slice(5)];
    if (!peer || !areFriends(state.current, peer.id)) return setView("requests");
    detailPanel.replaceChildren();
    detailPanel.appendChild(profileBlock(peer));
    detailPanel.appendChild(element("p", "bp-empty-state", "你与 " + peer.nickname + " 已成为好友。这里仅模拟进入单聊，尚未连接聊天服务。"));
    detailPanel.appendChild(button("返回新的朋友", "bp-secondary", "data-back-requests"));
  }

  function renderFriendProfile() {
    var friend = users[state.view.slice(7)];
    if (!friend || !areFriends(state.current, friend.id)) return setView("requests");
    detailPanel.replaceChildren();
    var wrapper = element("div", "bp-friend-profile");
    wrapper.appendChild(profileBlock(friend));
    wrapper.appendChild(element("p", "bp-card-meta", "已是好友。选择下方按钮可进入模拟单聊。"));
    wrapper.appendChild(button("进入单聊", "bp-primary", "data-open-chat", friend.id));
    detailPanel.appendChild(wrapper);
  }

  function renderDetails() {
    var title = state.view.indexOf("chat:") === 0 ? "单聊预览"
      : state.view.indexOf("friend:") === 0 ? "好友资料"
        : state.view === "groups" ? "群聊" : "好友申请";
    if (viewTitle) viewTitle.textContent = title;
    detailPanel.setAttribute("aria-label", title + "内容");
    if (directionGroup) directionGroup.hidden = state.view !== "requests";
    root.querySelectorAll("[data-request-direction]").forEach(function (control) {
      var selected = control.getAttribute("data-request-direction") === state.requestDirection;
      control.setAttribute("aria-pressed", String(selected));
      control.classList.toggle("is-selected", selected);
    });
    if (state.view.indexOf("chat:") === 0) renderChat();
    else if (state.view.indexOf("friend:") === 0) renderFriendProfile();
    else if (state.view === "groups") {
      detailPanel.replaceChildren();
      detailPanel.appendChild(element("p", "bp-empty-state", "群聊敬请期待。"));
    } else renderRequests();
  }

  function searchStatus(target) {
    if (target.id === state.current) return "这是你自己的账号";
    if (areFriends(state.current, target.id)) return "已经是好友";
    var request = findRequest(state.current, target.id);
    if (request && request.state === "pending") {
      return request.from === state.current ? "申请已发送，等待对方处理" : "对方向你发来了申请，请到新的朋友处理";
    }
    return null;
  }

  function renderSearchResult() {
    var account = state.searchedAccount;
    searchResult.replaceChildren();
    searchResult.hidden = false;
    if (searchPlaceholder) searchPlaceholder.hidden = true;
    if (!/^\d{8,12}$/.test(account)) {
      searchResult.appendChild(element("p", "bp-empty-state", "请输入 8–12 位完整数字账号。"));
      return;
    }
    var target = Object.values(users).find(function (user) { return user.account === account; });
    if (!target) {
      searchResult.appendChild(element("p", "bp-empty-state", "没有找到该账号，请检查后重试。"));
      return;
    }
    var card = profileBlock(target);
    card.setAttribute("data-search-profile", "");
    var reason = searchStatus(target);
    if (reason) card.appendChild(element("span", "bp-card-meta", reason));
    else card.appendChild(button("添加", "bp-primary", "data-search-add", target.id));
    searchResult.appendChild(card);
  }

  function openSearch() {
    state.searchedAccount = "";
    accountInput.value = "";
    searchResult.hidden = true;
    searchResult.replaceChildren();
    if (searchPlaceholder) searchPlaceholder.hidden = false;
    showDialog(searchDialog, accountInput);
  }

  function openApply(targetId) {
    var target = users[targetId];
    if (!target || searchStatus(target)) return;
    state.applyTarget = targetId;
    applyTarget.replaceChildren(profileBlock(target));
    verificationInput.value = "";
    showDialog(applyDialog, verificationInput);
  }

  function sendRequest() {
    var targetId = state.applyTarget;
    if (!targetId || !users[targetId] || searchStatus(users[targetId])) {
      closeDialog(applyDialog);
      return;
    }
    var verification = verificationInput.value.trim();
    var previous = findRequest(state.current, targetId);
    if (previous && previous.state === "rejected") {
      previous.from = state.current;
      previous.to = targetId;
      previous.verification = verification;
      previous.state = "pending";
      requests.splice(requests.indexOf(previous), 1);
      requests.push(previous);
    } else {
      requests.push({ id: state.nextRequestId++, from: state.current, to: targetId, verification: verification, state: "pending" });
    }
    state.notice = online[targetId] ? { to: targetId } : null;
    state.applyTarget = null;
    closeAllDialogs();
    setStatus("申请已发送给 " + users[targetId].nickname + (online[targetId] ? "，对方在线可立即看到。" : "，对方上线后可看到。"));
    renderHeader();
    if (state.view === "requests") renderDetails();
  }

  function resolveRequest(id, accepted) {
    var request = requests.find(function (entry) { return entry.id === id; });
    if (!request || request.to !== state.current || request.state !== "pending") return;
    request.state = accepted ? "accepted" : "rejected";
    if (accepted) friendships.add(friendshipKey(request.from, request.to));
    setStatus(accepted ? "已同意 " + users[request.from].nickname + " 的申请，现可进入单聊。" : "已拒绝 " + users[request.from].nickname + " 的申请。");
    renderHeader();
    renderDetails();
  }

  root.addEventListener("click", function (event) {
    var requestCard = event.target.closest("[data-request-card]");
    if (requestCard) {
      state.selectedRequest = Number(requestCard.getAttribute("data-request-id"));
      detailPanel.querySelectorAll("[data-request-card]").forEach(function (card) {
        card.classList.toggle("is-selected", card === requestCard);
      });
    }
    var target = event.target.closest("button");
    if (!target || !root.contains(target)) return;
    if (target.matches("[data-switch-user]")) {
      var next = target.getAttribute("data-switch-user");
      if (!users[next]) return;
      if (activeDialog()) closeAllDialogs();
      state.current = next;
      online[next] = true;
      state.notice = null;
      state.requestDirection = "incoming";
      state.selectedRequest = null;
      setStatus("已切换到 " + users[next].nickname + "；未处理申请已从演示数据加载。");
      renderHeader();
      setView("requests");
    } else if (target.matches("[data-toggle-peer-online]")) {
      var peer = peerId();
      online[peer] = !online[peer];
      state.notice = null;
      renderHeader();
    } else if (target.matches("[data-open-search]")) openSearch();
    else if (target.matches("[data-close-search]")) closeDialog(searchDialog);
    else if (target.matches("[data-search-add]")) openApply(target.getAttribute("data-search-add"));
    else if (target.matches("[data-cancel-apply]")) returnToSearch();
    else if (target.matches("[data-send-request]")) sendRequest();
    else if (target.matches("[data-request-direction]")) {
      var direction = target.getAttribute("data-request-direction");
      if (direction !== "incoming" && direction !== "outgoing") return;
      state.requestDirection = direction;
      state.selectedRequest = null;
      setView("requests");
    }
    else if (target.matches("[data-open-requests], [data-back-requests]")) setView("requests");
    else if (target.matches("[data-group-preview]")) setView("groups");
    else if (target.matches("[data-request-accept]")) resolveRequest(Number(target.getAttribute("data-request-accept")), true);
    else if (target.matches("[data-request-reject]")) resolveRequest(Number(target.getAttribute("data-request-reject")), false);
    else if (target.matches("[data-open-friend]")) setView("friend:" + target.getAttribute("data-open-friend"));
    else if (target.matches("[data-open-chat]")) setView("chat:" + target.getAttribute("data-open-chat"));
  });

  if (searchForm) searchForm.addEventListener("submit", function (event) {
    event.preventDefault();
    state.searchedAccount = accountInput.value.trim();
    renderSearchResult();
  });
  root.querySelectorAll("[data-search-dialog], [data-apply-dialog]").forEach(function (dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        if (dialog === applyDialog) returnToSearch();
        else closeDialog(dialog);
      }
    });
  });
  document.addEventListener("keydown", function (event) {
    var dialog = activeDialog();
    if (!dialog) {
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-request-card]")) {
        event.preventDefault();
        event.target.click();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (dialog === applyDialog) returnToSearch();
      else closeDialog(dialog);
      return;
    }
    if (event.key !== "Tab") return;
    var focusable = Array.from(dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled])"));
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  renderHeader();
  renderDetails();
})();
