(function () {
  "use strict";
  window.createWhisperCommentEditor = function (record, context, options) {
    options = options || {};
    var targetComment = options.target || null, targetId = targetComment && targetComment.id;
    var ui = window.WhisperMomentsUI, state = context.commentState, draft = state.get(record.id, targetId), panel = null;
    var form = ui.element("form", "moments-comment-form"), editor = ui.element("div", "moments-comment-editor");
    form.dataset.momentsCommentEditor = targetId ? "reply" : "top";
    if (targetId) { form.dataset.replyToCommentId = targetId; form.setAttribute("aria-label", "回复 " + options.targetName); form.classList.add("moments-comment-reply-form"); }
    var input = ui.element("textarea", "moments-comment-input"); input.rows = 1;
    input.setAttribute("aria-label", "评论内容"); input.placeholder = targetId ? targetComment.rootCommentId ? "回复 @" + options.targetName : "回复这条评论" : "发一条友善的评论"; input.value = draft.text;
    input.setSelectionRange(draft.start, draft.end);
    var target = ui.element("div", "moments-comment-reply-target"), grid = ui.element("div", "moments-comment-draft-images moments-draft-grid");
    var toolbar = ui.element("footer", "moments-comment-toolbar"), tools = ui.element("div", "moments-comment-tools");
    var picker = ui.element("div", "moments-comment-picker"); picker.hidden = true;
    picker.id = "moments-comment-picker-" + record.id + "-" + (targetId || "top");
    var status = ui.element("p", "moments-comment-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    var send = ui.element("button", "moments-comment-submit", "发布"); send.type = "submit"; send.setAttribute("aria-label", "发表评论");
    function saveCaret() { draft.start = input.selectionStart; draft.end = input.selectionEnd; }
    function hasDraft() { return Boolean(draft.text.trim() || draft.images.length); }
    function update() {
      form.classList.toggle("is-editing", draft.expanded); toolbar.hidden = !draft.expanded;
      emoji.setAttribute("aria-expanded", String(panel === "emoji")); mention.setAttribute("aria-expanded", String(panel === "mention"));
      send.disabled = !state.valid(draft); status.textContent = Array.from(draft.text).length > 500 ? "评论不能超过 500 字" : draft.error;
      target.hidden = !targetId;
    }
    function renderImages() {
      grid.replaceChildren(); grid.hidden = !draft.images.length;
      draft.images.forEach(function (image, index) {
        var item = ui.element("div", "moments-draft-item"), picture = ui.element("img", "");
        picture.src = image.url; picture.alt = "待发布评论图片 " + (index + 1);
        item.append(picture, ui.element("span", "moments-image-state", image.state === "ready" ? image.file.name : image.state === "loading" ? "图片加载中…" : "图片加载失败"));
        if (image.state === "error") item.append(ui.button("重新加载评论图片", "moments-retry", function () { state.retry(record.id, image, targetId); }));
        item.append(ui.button("移除评论图片 " + (index + 1), "moments-remove-image", function () { state.remove(record.id, image, targetId); input.focus(); })); grid.append(item);
      }); update();
    }
    draft.notify = renderImages;
    function insert(text) {
      var start = Math.min(draft.start, input.value.length), end = Math.min(draft.end, input.value.length);
      input.value = input.value.slice(0, start) + text + input.value.slice(end); draft.text = input.value;
      draft.start = draft.end = start + text.length; draft.expanded = true;
      panel = null; picker.hidden = true; input.focus(); input.setSelectionRange(draft.start, draft.end); update();
    }
    function showPicker(kind) {
      if (document.activeElement === input) saveCaret();
      panel = panel === kind ? null : kind; picker.replaceChildren(); picker.hidden = !panel;
      picker.dataset.picker = panel === "mention" ? "mentions" : "emoji";
      if (panel === "emoji") ["😀", "😊", "😂", "❤️", "👍", "🎉", "🌸", "☀️"].forEach(function (emoji) {
        var button = ui.button("插入表情 " + emoji, "moments-comment-emoji", function () { insert(emoji); }); button.textContent = emoji; picker.append(button);
      });
      if (panel === "mention") Object.keys(context.people).filter(function (id) { return id !== context.self.id; }).forEach(function (id) {
        var person = context.people[id], option = ui.button("提及 " + person.name, "moments-comment-mention", function () { insert("@" + person.name + " "); }); option.textContent = person.name; picker.append(option);
      });
      draft.expanded = true; update();
    }
    function toolIcon(button, pathData) {
      button.title = button.getAttribute("aria-label"); button.textContent = "";
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", pathData); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.7"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path); button.append(svg);
    }
    var emoji = ui.button("添加表情", "moments-comment-tool", function () { showPicker("emoji"); }); toolIcon(emoji, "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 14c2 3 6 3 8 0M8 9h.01M16 9h.01");
    var mention = ui.button("@好友", "moments-comment-tool", function () { showPicker("mention"); }); toolIcon(mention, "M16 8v7c0 3 5 2 5-3a9 9 0 1 0-4 7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z");
    emoji.setAttribute("aria-controls", picker.id); mention.setAttribute("aria-controls", picker.id);
    var imageButton = ui.button("添加评论图片", "moments-comment-tool", function () { file.click(); }); toolIcon(imageButton, "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 17l6-6 4 4 3-3 5 5M8 7h.01");
    var file = ui.element("input", "visually-hidden"); file.type = "file"; file.multiple = true; file.accept = "image/jpeg,image/png,image/webp"; file.setAttribute("aria-label", "选择评论图片"); file.tabIndex = -1;
    file.addEventListener("change", function () { state.choose(record.id, Array.from(file.files || []), targetId); file.value = ""; input.focus(); });
    tools.append(emoji, mention, imageButton, file); toolbar.append(tools, send);
    input.addEventListener("focus", function () { draft.expanded = true; update(); });
    input.addEventListener("input", function () { draft.text = input.value; draft.expanded = true; saveCaret(); update(); });
    ["select", "click", "keyup", "blur"].forEach(function (name) { input.addEventListener(name, saveCaret); });
    form.addEventListener("focusout", function (event) {
      if (form.contains(event.relatedTarget)) return;
      panel = null; picker.hidden = true;
      if (!hasDraft()) draft.expanded = false;
      update();
    });
    form.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel) { event.preventDefault(); event.stopPropagation(); panel = null; picker.hidden = true; input.focus(); update(); }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault(); draft.text = input.value; saveCaret();
      if (!state.valid(draft)) { update(); return; }
      context.comment(record.id, targetId);
    });
    if (targetId) target.append(ui.button("取消回复", "moments-comment-cancel-reply", function () { saveCaret(); if (options.onCancel) options.onCancel(); }));
    editor.append(target, input, grid, toolbar, picker, status); form.append(window.WhisperMomentsRender.avatar(context.self, "moments-comment-avatar"), editor); renderImages();
    return { node: form, focus: function () { input.focus(); input.setSelectionRange(draft.start, draft.end); },
      detach: function () { saveCaret(); if (draft.notify === renderImages) draft.notify = null; } };
  };
})();
