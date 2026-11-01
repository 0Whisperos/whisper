(function () {
  "use strict";
  var ui = window.WhisperMomentsUI;
  function icon(kind) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("class", "moments-action-icon");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", kind === "like" ? "M12 5 22 19H2Z" : "M4 4h16v12H9l-5 4V4Z");
    path.setAttribute("fill", kind === "like" ? "currentColor" : "none");
    if (kind !== "like") { path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.6"); path.setAttribute("stroke-linejoin", "round"); }
    svg.append(path); return svg;
  }
  function avatar(person, className) {
    return ui.element("span", "person-avatar moments-avatar " + (person.tone || "blue") + (className ? " " + className : ""), person.avatar || person.name.slice(0, 1));
  }
  function author(person) {
    var node = ui.element("div", "moments-author");
    var copy = ui.element("div", "moments-author-copy");
    copy.append(ui.element("strong", "moments-author-name", person.name), ui.element("p", "moments-signature", person.signature || "这位朋友还没有填写签名"));
    node.append(avatar(person), copy); return node;
  }
  function hasTextSelection() {
    var selection = window.getSelection && window.getSelection();
    return Boolean(selection && !selection.isCollapsed && String(selection).trim());
  }
  function body(record, context, full) {
    var node = ui.element("div", "moments-body");
    var long = Array.from(record.text).length > 160;
    var text = full || !long ? record.text : Array.from(record.text).slice(0, 160).join("") + "…";
    var paragraph = ui.element("p", "moments-text", text);
    if (!full) {
      paragraph.setAttribute("role", "link"); paragraph.tabIndex = 0;
      paragraph.setAttribute("aria-label", "阅读动态正文"); paragraph.dataset.momentsReadBody = "";
      paragraph.addEventListener("click", function (event) {
        if (event.defaultPrevented || hasTextSelection()) return;
        context.open(record.id, "body", false);
      });
      paragraph.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); event.stopPropagation(); context.open(record.id, "body", false);
      });
    }
    node.append(paragraph);
    if (!full && long) {
      var link = ui.element("a", "moments-read-link", "阅读全文");
      link.href = "#moments/read/" + encodeURIComponent(record.id); link.setAttribute("aria-label", "阅读全文"); link.dataset.momentsRead = "";
      link.addEventListener("click", function (event) { event.preventDefault(); event.stopPropagation(); context.open(record.id, "link", false); }); node.append(link);
    }
    return node;
  }
  function images(record, context) {
    var grid = ui.element("div", "moments-grid"); grid.dataset.imageCount = String(record.images.length);
    record.images.forEach(function (image, index) {
      grid.append(ui.image(image.url, "查看动态图片 " + (index + 1), function () { context.showImage(image, index); }));
    }); return grid;
  }
  function likes(record, people) {
    var node = ui.element("p", "moments-likes"); node.dataset.momentsLikes = "";
    if (record.likedBy.length) node.textContent = record.likedBy.map(function (id) { return people[id] ? people[id].name : "好友"; }).join("、") + " 赞过";
    else node.hidden = true;
    return node;
  }
  function actions(record, context) {
    var node = ui.element("div", "moments-actions");
    var liked = record.likedBy.indexOf(context.self.id) >= 0;
    var like = ui.button(liked ? "取消点赞" : "点赞", "moments-like" + (liked ? " is-active" : ""), function () { context.like(record.id); });
    var likeCount = ui.element("span", "moments-action-count", String(record.likedBy.length)); likeCount.id = "moments-like-count-" + record.id;
    like.textContent = ""; like.append(icon("like"), ui.element("span", "moments-action-label", liked ? "已点赞" : "点赞"), likeCount); like.setAttribute("aria-describedby", likeCount.id);
    like.dataset.momentsLike = ""; like.setAttribute("aria-pressed", String(liked));
    var comment = ui.button("评论", "moments-comment-action", function () { context.open(record.id, "comment", true); });
    var commentCount = ui.element("span", "moments-action-count", String(record.comments.length)); commentCount.id = "moments-comment-count-" + record.id;
    comment.textContent = ""; comment.append(icon("comment"), commentCount, ui.element("span", "moments-action-label", "条评论")); comment.setAttribute("aria-describedby", commentCount.id);
    comment.dataset.momentsComment = ""; node.append(like, comment); return node;
  }
  function card(record, context) {
    var card = ui.element("article", "moments-card"); card.dataset.momentId = record.id;
    var head = ui.element("header", "moments-card-head"); head.append(author(context.people[record.authorId])); card.append(head);
    if (record.text) card.append(body(record, context, false));
    if (record.images.length) card.append(images(record, context));
    card.append(ui.element("time", "moments-card-meta moments-time", record.time), actions(record, context), likes(record, context.people));
    return card;
  }
  window.WhisperMomentsRender = { avatar: avatar, author: author, body: body, images: images, likes: likes, actions: actions, card: card };
})();
