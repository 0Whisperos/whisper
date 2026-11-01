(function () {
  "use strict";
  window.renderWhisperMomentsComments = function (record, context) {
    var ui = window.WhisperMomentsUI;
    var section = ui.element("section", "moments-comments moments-reader-comments"); section.setAttribute("aria-label", "动态评论");
    section.append(ui.element("h2", "moments-comments-heading", "评论 " + record.comments.length));
    var editor = window.createWhisperCommentEditor(record, context); section.append(editor.node);
    function renderRow(comment, onReply) {
      var person = context.people[comment.authorId] || { name: "好友", avatar: "友", tone: "gray" };
      var row = ui.element("article", "moments-comment"); row.dataset.commentId = comment.id;
      if (comment.rootCommentId) { row.classList.add("is-reply"); row.dataset.parentId = comment.rootCommentId; }
      var copy = ui.element("div", "moments-comment-copy");
      var time = ui.element("time", "moments-comment-time", comment.time); if (comment.createdAt) time.dateTime = comment.createdAt;
      var text = ui.element("p", "moments-comment-text");
      if (comment.rootCommentId && comment.replyToCommentId !== comment.rootCommentId && comment.replyToUserId) {
        var recipient = context.people[comment.replyToUserId];
        text.append(ui.element("span", "moments-comment-reply-label", "回复 @" + (recipient ? recipient.name : comment.replyToName || "好友")), document.createTextNode("："));
      }
      text.append(document.createTextNode(comment.text));
      copy.append(ui.element("strong", "moments-comment-author", person.name), text);
      if (comment.images && comment.images.length) {
        var grid = ui.element("div", "moments-comment-images");
        comment.images.forEach(function (image, index) { grid.append(ui.image(image.url, "查看评论图片 " + (index + 1), function () { context.showImage(image, index); })); }); copy.append(grid);
      }
      var meta = ui.element("div", "moments-comment-meta");
      var like = ui.button("点赞评论", "moments-comment-like", function () { context.likeComment(record.id, comment.id); updateLike(); });
      function updateLike() {
        var value = comment.likedBy.indexOf(context.self.id) >= 0;
        like.setAttribute("aria-label", value ? "取消点赞评论" : "点赞评论"); like.setAttribute("aria-pressed", String(value));
        like.classList.toggle("is-active", value); like.replaceChildren();
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "M7 10H3v11h4m0-11 5-8c3 0 2 5 1 7h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7V10Z"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.5"); svg.append(path);
        like.append(svg, ui.element("span", "moments-comment-like-count", String(comment.likedBy.length)));
      }
      updateLike();
      var reply = ui.button("回复 " + person.name, "moments-comment-reply", onReply); reply.textContent = "回复";
      meta.append(time, like, reply); copy.append(meta, ui.element("div", "moments-comment-reply-slot"));
      row.append(window.WhisperMomentsRender.avatar(person, "moments-comment-avatar"), copy); return row;
    }
    section.append(window.renderWhisperCommentThreads(record, context, renderRow)); return section;
  };
})();
