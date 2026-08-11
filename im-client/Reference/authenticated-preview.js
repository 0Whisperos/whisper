(function () {
  "use strict";

  var storageKey = "whisper.authenticatedPrototype.themeMode";
  var root = document.documentElement;
  var shell = document.querySelector("[data-app-shell]");
  if (!shell) return;

  if (window.__whisperAuthenticatedPrototype) window.__whisperAuthenticatedPrototype.destroy();

  var data = window.__whisperAuthenticatedPrototypeData;
  var error = document.querySelector("[data-prototype-error]");
  if (!data) {
    if (error) error.hidden = false;
    return;
  }

  var state = { view: "messages", conversation: "linxiao", contact: "linxiao", mobilePanel: "sessions", menuOpen: false, detailOpen: false, themeMode: "system" };
  var layout = { rail: 56, sidebar: window.innerWidth < 900 ? 240 : 280, composer: 180, railTouched: false, sidebarTouched: false, composerTouched: false, drag: null };
  var cleanups = [];
  var menuTrigger = null;
  var detailTrigger = null;
  var messageScrollTop = 0;
  var drafts = Object.create(null);
  var renderedConversation = null;
  var input = document.querySelector("textarea[aria-label='输入消息']");
  var send = document.querySelector("[aria-label='发送消息']");
  var search = document.querySelector("[aria-label='搜索会话']");
  var media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : { matches: false, addEventListener: function () {}, removeEventListener: function () {} };

  function add(node, event, handler) {
    node.addEventListener(event, handler);
    cleanups.push(function () { node.removeEventListener(event, handler); });
  }

  function isNarrow() { return window.innerWidth < 680; }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function defaultSidebarWidth() {
    return window.innerWidth < 900 ? 240 : 280;
  }

  function layoutBounds() {
    var viewportWidth = Math.max(window.innerWidth || 0, 680);
    var viewportHeight = Math.max(window.innerHeight || 0, 300);
    var railMax = isNarrow() ? 184 : Math.max(56, Math.min(184, viewportWidth - 220 - 360));
    var sidebarMax = isNarrow() ? 420 : Math.max(220, Math.min(420, viewportWidth - layout.rail - 360));
    var composerMax = isNarrow() ? 320 : Math.max(120, Math.min(320, viewportHeight - 60 - 120));
    return {
      rail: { min: 56, max: railMax },
      sidebar: { min: 220, max: sidebarMax },
      composer: { min: 120, max: composerMax }
    };
  }

  function clampLayout() {
    if (isNarrow()) return;
    var bounds = layoutBounds();
    layout.rail = clamp(layout.rail, bounds.rail.min, bounds.rail.max);
    bounds = layoutBounds();
    layout.sidebar = clamp(layout.sidebar, bounds.sidebar.min, bounds.sidebar.max);
    layout.composer = clamp(layout.composer, bounds.composer.min, bounds.composer.max);
  }

  function applyLayout() {
    var bounds = layoutBounds();
    shell.style.setProperty("--rail-width", layout.rail + "px");
    shell.style.setProperty("--sidebar-width", layout.sidebar + "px");
    shell.style.setProperty("--composer-height", layout.composer + "px");
    shell.dataset.railExpanded = layout.rail >= 120 ? "true" : "false";
    document.querySelectorAll("[data-resizer]").forEach(function (resizer) {
      var kind = resizer.dataset.resizer;
      resizer.setAttribute("aria-valuemin", String(bounds[kind].min));
      resizer.setAttribute("aria-valuemax", String(Math.round(bounds[kind].max)));
      resizer.setAttribute("aria-valuenow", String(Math.round(layout[kind])));
    });
  }

  function updateLayout(kind, value, markTouched) {
    layout[kind] = value;
    if (markTouched) layout[kind + "Touched"] = true;
    clampLayout();
    applyLayout();
  }

  function finishLayoutDrag(event) {
    var drag = layout.drag;
    if (!drag || (event && event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
    layout.drag = null;
    drag.handle.classList.remove("is-dragging");
    if (drag.handle.hasPointerCapture && drag.handle.hasPointerCapture(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }
  }

  function resetLayout(kind) {
    if (kind === "rail") layout.rail = 56;
    if (kind === "sidebar") layout.sidebar = defaultSidebarWidth();
    if (kind === "composer") layout.composer = 180;
    layout[kind + "Touched"] = false;
    clampLayout();
    applyLayout();
  }

  function setupLayoutResizers() {
    document.querySelectorAll("[data-resizer]").forEach(function (handle) {
      var kind = handle.dataset.resizer;
      add(handle, "pointerdown", function (event) {
        if (isNarrow() || (event.pointerType === "mouse" && event.button !== 0)) return;
        finishLayoutDrag();
        layout.drag = { kind: kind, handle: handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startValue: layout[kind] };
        handle.classList.add("is-dragging");
        if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      add(handle, "pointermove", function (event) {
        var drag = layout.drag;
        if (!drag || drag.handle !== handle || drag.pointerId !== event.pointerId) return;
        var delta = drag.kind === "composer" ? drag.startY - event.clientY : event.clientX - drag.startX;
        updateLayout(drag.kind, drag.startValue + delta, true);
      });
      add(handle, "pointerup", finishLayoutDrag);
      add(handle, "pointercancel", finishLayoutDrag);
      add(handle, "lostpointercapture", finishLayoutDrag);
      add(handle, "dblclick", function (event) {
        if (isNarrow()) return;
        event.preventDefault();
        resetLayout(kind);
      });
      add(handle, "keydown", function (event) {
        if (isNarrow()) return;
        var bounds = layoutBounds()[kind];
        var next = layout[kind];
        if (event.key === "Home") next = bounds.min;
        else if (event.key === "End") next = bounds.max;
        else if (kind === "composer" && event.key === "ArrowUp") next += 8;
        else if (kind === "composer" && event.key === "ArrowDown") next -= 8;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next -= 8;
        else if (event.key === "ArrowRight" || event.key === "ArrowDown") next += 8;
        else return;
        event.preventDefault();
        updateLayout(kind, next, true);
      });
    });
    clampLayout();
    applyLayout();
  }

  function createIcon(id) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function createAvatar(item, extraClass) {
    var avatar = document.createElement("span");
    avatar.className = "person-avatar " + (item.tone || "gray") + (extraClass ? " " + extraClass : "");
    avatar.textContent = item.avatar;
    return avatar;
  }

  function resolveMessageProfile(conversation, message) {
    if (message.senderId === data.self.id) return data.self;
    if (conversation.participants && conversation.participants[message.senderId]) return conversation.participants[message.senderId];
    return { name: message.senderName, avatar: message.senderName.slice(0, 1), tone: conversation.tone };
  }

  function showStatus(message, scope) {
    var selector = scope === "session" ? "[data-session-status]" : scope === "contacts" ? "[data-contact-status]" : "[data-chat-status]";
    var status = document.querySelector(selector);
    if (status) status.textContent = message;
  }

  function resolveToolScope(target) {
    if (target.closest(".chat-panel") || target.closest(".detail-panel")) return "chat";
    if (target.closest(".session-panel")) return "session";
    if (target.closest(".contacts-panel") || state.view === "contacts") return "contacts";
    return "session";
  }

  function safeReadTheme() {
    try {
      var saved = window.localStorage.getItem(storageKey);
      return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    } catch (_) {
      return "system";
    }
  }

  function safeSaveTheme(mode) {
    try { window.localStorage.setItem(storageKey, mode); } catch (_) {}
  }

  function appliedTheme() { return state.themeMode === "system" ? (media.matches ? "dark" : "light") : state.themeMode; }

  function applyTheme() {
    var theme = appliedTheme();
    root.dataset.themeMode = state.themeMode;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll("[data-theme-option]").forEach(function (option) {
      var checked = option.getAttribute("data-theme-option") === state.themeMode;
      option.setAttribute("aria-checked", checked ? "true" : "false");
      option.tabIndex = checked ? 0 : -1;
    });
  }

  function setMenu(open, trigger) {
    state.menuOpen = open;
    if (open && trigger) menuTrigger = trigger;
    var menu = document.querySelector("[data-theme-menu]");
    document.querySelectorAll("[aria-label='账号与设置']").forEach(function (button) { button.setAttribute("aria-expanded", open ? "true" : "false"); });
    if (menu) menu.hidden = !open;
    if (open) {
      var checked = document.querySelector("[data-theme-option][aria-checked='true']");
      if (checked) checked.focus();
    }
  }

  function closeMenu(returnFocus) {
    if (!state.menuOpen) return;
    setMenu(false);
    if (returnFocus) {
      var fallback = document.querySelector(isNarrow() ? ".bottom-nav [aria-label='账号与设置']" : ".function-rail [aria-label='账号与设置']");
      (menuTrigger || fallback)?.focus();
    }
    menuTrigger = null;
  }

  function setTheme(mode, close) {
    state.themeMode = mode;
    safeSaveTheme(mode);
    applyTheme();
    if (close !== false) closeMenu(true);
  }

  function setDetail(open, trigger, returnFocus) {
    state.detailOpen = open;
    if (open && trigger) detailTrigger = trigger;
    var panel = document.querySelector("[data-detail-panel]");
    document.querySelectorAll("[data-detail-trigger]").forEach(function (button) { button.setAttribute("aria-expanded", open ? "true" : "false"); });
    if (panel) panel.hidden = !open;
    if (open) {
      var firstAction = panel && panel.querySelector("button");
      if (firstAction) firstAction.focus();
    } else if (returnFocus && detailTrigger) {
      detailTrigger.focus();
    }
    if (!open) {
      detailTrigger = null;
    }
  }

  function renderSessions() {
    var list = document.querySelector("[data-session-list]");
    if (!list) return;
    list.replaceChildren();
    data.sessions.forEach(function (session) {
      var row = document.createElement("button");
      var copy = document.createElement("span");
      var name = document.createElement("strong");
      var preview = document.createElement("small");
      var meta = document.createElement("span");
      var time = document.createElement("time");
      row.type = "button";
      row.className = "session-row" + (session.id === state.conversation ? " is-active" : "");
      row.dataset.conversationId = session.id;
      row.appendChild(createAvatar(session));
      copy.className = "session-copy";
      name.textContent = session.name;
      preview.textContent = (session.draft ? "[草稿] " : "") + (session.mentionsMe ? "[@我] " : "") + session.preview;
      copy.append(name, preview);
      meta.className = "session-meta";
      time.textContent = session.time;
      meta.appendChild(time);
      if (session.unread) {
        var unread = document.createElement("b");
        unread.textContent = String(session.unread);
        meta.appendChild(unread);
      }
      if (session.pinned || session.muted) {
        var flags = document.createElement("span");
        flags.className = "session-flags";
        flags.textContent = (session.pinned ? "置顶 " : "") + (session.muted ? "免打扰" : "");
        meta.appendChild(flags);
      }
      row.append(copy, meta);
      list.appendChild(row);
    });
  }

  function renderMessages(conversation, scrollToLatest) {
    var list = document.querySelector("[data-message-list]");
    if (!list) return;
    list.replaceChildren();
    conversation.messages.forEach(function (message) {
      if (message.showTime) {
        var separator = document.createElement("time");
        separator.className = "message-time";
        separator.textContent = message.time;
        list.appendChild(separator);
      }
      var row = document.createElement("article");
      var body = document.createElement("div");
      var bubble = document.createElement("p");
      var footer = document.createElement("footer");
      var profile = resolveMessageProfile(conversation, message);
      row.className = "message-row " + (message.side === "right" ? "self" : "") + (!message.showAvatar ? " compact" : "");
      row.appendChild(createAvatar(profile, "message-avatar"));
      body.className = "message-body" + (message.side === "right" && message.receipt ? " has-receipt" : "");
      if (conversation.type === "group" && message.side === "left" && message.showAvatar) {
        var sender = document.createElement("small");
        sender.className = "message-sender";
        sender.textContent = message.senderName;
        body.appendChild(sender);
      }
      bubble.className = "message-bubble";
      bubble.textContent = message.text;
      footer.className = "message-footer";
      if (message.side === "right" && message.receipt) {
        var receipt = document.createElement("span");
        var receiptLabel = message.receipt === "已读" ? "已读" : "未读";
        receipt.className = "message-receipt " + (message.receipt === "已读" ? "is-read" : "is-pending");
        receipt.setAttribute("role", "img");
        receipt.setAttribute("aria-label", receiptLabel);
        if (message.receipt === "已读") {
          var receiptIcon = createIcon("icon-check");
          receiptIcon.setAttribute("aria-hidden", "true");
          receipt.appendChild(receiptIcon);
        }
        var receiptText = document.createElement("span");
        receiptText.className = "visually-hidden";
        receiptText.textContent = receiptLabel;
        receipt.appendChild(receiptText);
        footer.appendChild(receipt);
      }
      body.append(bubble, footer);
      row.appendChild(body);
      list.appendChild(row);
    });
    if (scrollToLatest) {
      list.scrollTop = list.scrollHeight;
      messageScrollTop = list.scrollTop;
    } else {
      list.scrollTop = messageScrollTop;
    }
  }

  function renderContacts() {
    var list = document.querySelector("[data-contact-list]");
    var detail = document.querySelector("[data-contact-detail]");
    var contact = data.contacts.filter(function (item) { return item.id === state.contact; })[0];
    if (list) {
      list.replaceChildren();
      ["新的朋友", "群聊"].forEach(function (name) {
        var system = document.createElement("button");
        var label = document.createElement("span");
        system.type = "button";
        system.className = "system-contact";
        system.dataset.tool = name;
        system.appendChild(createIcon(name === "群聊" ? "icon-message" : "icon-plus"));
        label.textContent = name;
        system.appendChild(label);
        list.appendChild(system);
      });
      data.contactSections.forEach(function (section) {
        var group = data.contacts.filter(function (item) { return item.section === section.id; });
        if (!group.length) return;
        var label = document.createElement("p");
        label.className = "contact-section-label";
        label.textContent = section.label;
        list.appendChild(label);
        group.forEach(function (item) {
          var row = document.createElement("button");
          var copy = document.createElement("span");
          var name = document.createElement("strong");
          var status = document.createElement("small");
          row.type = "button";
          row.className = "contact-row" + (item.id === state.contact ? " is-active" : "");
          row.dataset.contactId = item.id;
          row.appendChild(createAvatar(item));
          name.textContent = item.name;
          status.textContent = item.status;
          copy.append(name, status);
          row.appendChild(copy);
          list.appendChild(row);
        });
      });
    }
    if (detail && contact) {
      detail.replaceChildren();
      detail.appendChild(createAvatar(contact));
      var heading = document.createElement("h2");
      heading.textContent = contact.name;
      detail.appendChild(heading);
      [["备注", contact.name], ["账号", contact.account], ["地区", contact.region], ["状态", contact.status]].forEach(function (pair) {
        var line = document.createElement("p");
        line.textContent = pair[0] + "：" + pair[1];
        detail.appendChild(line);
      });
      var start = document.createElement("button");
      var canStartConversation = contact.conversationId && data.conversations[contact.conversationId];
      start.type = "button";
      start.textContent = canStartConversation ? "发消息" : "暂无可用会话";
      if (canStartConversation) start.dataset.enterChat = contact.conversationId;
      else start.disabled = true;
      detail.appendChild(start);
    }
  }

  function updateSendState() {
    if (!input || !send) return;
    send.disabled = !input.value.trim();
    send.classList.toggle("ready", !send.disabled);
  }

  function restoreConversationDraft() {
    if (!input || state.conversation === renderedConversation) return;
    input.value = drafts[state.conversation] || "";
    renderedConversation = state.conversation;
    updateSendState();
  }

  function render(scrollMessagesToLatest) {
    shell.dataset.view = state.view;
    shell.dataset.activeConversation = state.conversation;
    shell.dataset.activeContact = state.contact;
    shell.dataset.mobilePanel = state.mobilePanel;
    var contacts = document.querySelector(".contacts-panel");
    if (contacts) contacts.hidden = state.view !== "contacts";
    document.querySelectorAll("[data-view-target]").forEach(function (button) {
      var active = button.getAttribute("data-view-target") === state.view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    renderSessions();
    var conversation = data.conversations[state.conversation] || data.conversations.linxiao;
    var title = document.querySelector("[data-chat-title]");
    var presence = document.querySelector("[data-chat-presence]");
    var avatar = document.querySelector("[data-chat-avatar]");
    if (title) title.textContent = conversation.name;
    if (presence) presence.textContent = conversation.status;
    if (avatar) { avatar.textContent = conversation.avatar; avatar.className = "person-avatar chat-avatar " + conversation.tone; }
    renderMessages(conversation, scrollMessagesToLatest);
    renderContacts();
    restoreConversationDraft();
    var mainTitle = document.querySelector("[data-main-title]");
    if (mainTitle) mainTitle.textContent = "好友";
  }

  state.themeMode = safeReadTheme();
  applyTheme();
  setMenu(false);
  setDetail(false);
  setupLayoutResizers();
  var messageList = document.querySelector("[data-message-list]");
  if (messageList) add(messageList, "scroll", function () { messageScrollTop = messageList.scrollTop; });
  if (input && send) {
    add(input, "input", function () { drafts[state.conversation] = input.value; updateSendState(); });
    add(send, "click", function () { showStatus("发送仅作界面预览", "chat"); });
  }
  if (search) add(search, "input", function () { showStatus("搜索仅作界面预览", "session"); });
  render(true);

  add(window, "resize", function () {
    finishLayoutDrag();
    if (!isNarrow() && !layout.sidebarTouched) layout.sidebar = defaultSidebarWidth();
    clampLayout();
    applyLayout();
    if (state.menuOpen) menuTrigger = document.querySelector(isNarrow() ? ".bottom-nav [aria-label='账号与设置']" : ".function-rail [aria-label='账号与设置']");
    render();
  });
  if (media.addEventListener) add(media, "change", function () { if (state.themeMode === "system") applyTheme(); });

  add(document, "click", function (event) {
    var target = event.target.closest && event.target.closest("[data-conversation-id],[data-contact-id],[data-view-target],[data-enter-chat],[data-detail-trigger],[data-tool],[aria-label='账号与设置'],[data-theme-option],[aria-label='返回会话'],[aria-label='返回联系人']");
    if (!target) return;
    if (target.matches("[data-conversation-id]")) { state.conversation = target.dataset.conversationId; state.view = "messages"; if (isNarrow()) state.mobilePanel = "chat"; render(true); return; }
    if (target.matches("[data-contact-id]")) { state.contact = target.dataset.contactId; if (isNarrow()) state.mobilePanel = "contact-detail"; render(); return; }
    if (target.matches("[data-enter-chat]")) {
      if (!data.conversations[target.dataset.enterChat]) { showStatus("暂无可用会话", "contacts"); return; }
      state.conversation = target.dataset.enterChat;
      state.view = "messages";
      state.mobilePanel = isNarrow() ? "chat" : "sessions";
      render(true);
      return;
    }
    if (target.matches("[data-view-target]")) { state.view = target.dataset.viewTarget; state.mobilePanel = state.view === "contacts" ? "contacts" : "sessions"; closeMenu(false); render(); return; }
    if (target.matches("[data-detail-trigger]")) { setDetail(!state.detailOpen, target, true); return; }
    if (target.matches("[aria-label='返回会话']")) { state.mobilePanel = "sessions"; render(); return; }
    if (target.matches("[aria-label='返回联系人']")) { state.mobilePanel = "contacts"; render(); return; }
    if (target.matches("[aria-label='账号与设置']")) { setMenu(!state.menuOpen, target); return; }
    if (target.matches("[data-theme-option]")) { setTheme(target.dataset.themeOption); return; }
    if (target.matches("[data-tool]")) {
      showStatus(target.dataset.tool + "仅作界面预览", resolveToolScope(target));
    }
  });

  add(document, "click", function (event) {
    var panel = document.querySelector("[data-detail-panel]");
    if (state.detailOpen && panel && !panel.contains(event.target) && !event.target.closest("[data-detail-trigger]")) setDetail(false, null, false);
    var accountMenu = document.querySelector("[data-theme-menu]");
    if (state.menuOpen && accountMenu && !accountMenu.contains(event.target) && !event.target.closest("[aria-label='账号与设置']")) closeMenu(false);
  });

  add(document, "keydown", function (event) {
    if (event.key === "Escape") {
      if (state.detailOpen) { setDetail(false, null, true); return; }
      if (state.menuOpen) { closeMenu(true); return; }
    }
    if (!event.target || !event.target.matches("[data-theme-option]")) return;
    var options = Array.prototype.slice.call(document.querySelectorAll("[data-theme-option]"));
    var index = options.indexOf(event.target);
    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].indexOf(event.key) !== -1) {
      event.preventDefault();
      var next = options[(index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
      setTheme(next.dataset.themeOption, false);
      next.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setTheme(event.target.dataset.themeOption);
    }
  });

  var logout = document.querySelector("[data-logout]");
  if (logout) add(logout, "click", function (event) { if (window.confirm("确定要退出当前账号吗？")) root.dataset.logoutState = "confirmed"; else event.preventDefault(); });
  window.__whisperAuthenticatedPrototype = { destroy: function () { cleanups.splice(0).forEach(function (cleanup) { cleanup(); }); } };
})();
