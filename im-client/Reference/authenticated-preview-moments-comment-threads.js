(function () {
  "use strict";
  window.renderWhisperCommentThreads = function (record, context, renderRow) {
    var ui = window.WhisperMomentsUI, state = context.commentState;
    var list = ui.element("div", "moments-comment-list"), slots = Object.create(null), buttons = Object.create(null), current = null;
    list.dataset.momentsCommentList = "";
    function find(id) { return record.comments.find(function (comment) { return comment.id === id; }); }
    function unmount() { if (current) { current.detach(); current.node.remove(); current = null; } }
    function cancel() {
      var previous = state.activeTarget(record.id); unmount(); state.setActiveTarget(record.id, null);
      if (buttons[previous]) buttons[previous].focus({ preventScroll: true });
    }
    function open(comment, shouldFocus) {
      if (current && state.activeTarget(record.id) === comment.id) { if (shouldFocus) current.focus(); return; }
      unmount(); state.setActiveTarget(record.id, comment.id);
      var person = context.people[comment.authorId] || { name: "好友" };
      current = window.createWhisperCommentEditor(record, context, { target: comment, targetName: person.name, onCancel: cancel });
      slots[comment.id].append(current.node); if (shouldFocus) current.focus();
    }
    function row(comment) {
      var node = renderRow(comment, function () { open(comment, true); });
      slots[comment.id] = node.querySelector(".moments-comment-reply-slot"); buttons[comment.id] = node.querySelector(".moments-comment-reply"); return node;
    }
    if (!record.comments.length) list.append(ui.element("p", "moments-empty-comments", "还没有评论，来说两句吧。"));
    record.comments.filter(function (comment) { return !comment.rootCommentId; }).forEach(function (root) {
      var thread = ui.element("div", "moments-comment-thread"), replies = ui.element("div", "moments-comment-replies"); replies.dataset.commentThread = root.id;
      thread.append(row(root));
      record.comments.filter(function (comment) { return comment.rootCommentId === root.id; }).forEach(function (comment) { replies.append(row(comment)); });
      replies.hidden = !replies.childElementCount; thread.append(replies); list.append(thread);
    });
    var active = find(state.activeTarget(record.id)); if (active && slots[active.id]) open(active, false);
    return list;
  };
})();
