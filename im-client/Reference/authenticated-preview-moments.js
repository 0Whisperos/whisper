(function () {
  "use strict";
  window.createWhisperMoments = function (options) {
    var ui = window.WhisperMomentsUI, render = window.WhisperMomentsRender, root = options.root;
    var people = Object.create(null), profiles = window.__whisperMomentsProfiles || {};
    [options.self].concat(options.contacts || []).forEach(function (person) {
      people[person.id] = Object.assign({}, person, { signature: person.signature || (profiles[person.id] || {}).signature || "" });
    });
    var self = people[options.self.id];
    var records = (window.__whisperMomentsSeed || []).filter(function (record) { return people[record.authorId]; }).map(function (record) {
      return { id: record.id, authorId: record.authorId, text: record.text, time: record.time,
        images: record.images.map(function (url) { return { url: url, owned: false }; }), likedBy: record.likedBy.slice(),
        comments: record.comments.map(function (comment, index) { return {
          id: comment.id || record.id + "-comment-" + index, authorId: comment.authorId, text: comment.text,
          time: comment.time || "刚刚", createdAt: comment.createdAt || new Date().toISOString(),
          images: (comment.images || []).map(function (url) { return { url: url, owned: false }; }), likedBy: (comment.likedBy || []).slice(),
          rootCommentId: comment.rootCommentId || null, replyToUserId: comment.replyToUserId || null, replyToCommentId: comment.replyToCommentId || null, replyToName: comment.replyToName || ""
        }; }) };
    });
    var filter = "all", active = false, disposed = false, preview = null, nextId = 0, nextCommentId = 0;
    var selectedId = null, listScroll = 0, readerScroll = 0, entry = null, commentState = window.createWhisperCommentState();
    root.replaceChildren();
    var head = ui.element("header", "moments-head");
    var title = ui.element("div", "moments-title"); title.append(ui.element("h1", "", "朋友圈"), ui.element("p", "moments-visibility", "自己和好友可见"));
    var publish = ui.button("发布动态", "moments-primary"); publish.dataset.momentsPublish = "";
    var status = ui.element("p", "moments-status visually-hidden"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.dataset.momentsStatus = "";
    var scroll = ui.element("div", "moments-scroll"); scroll.dataset.momentsScroll = "";
    var content = ui.element("div", "moments-content");
    var profile = ui.element("section", "moments-profile");
    var intro = ui.element("div", ""); intro.append(ui.element("h2", "", self.name), ui.element("p", "", "和朋友们分享生活里的小事")); profile.append(render.avatar(self), intro);
    var tabs = ui.element("div", "moments-tabs"); tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", "筛选动态");
    var all = ui.button("全部动态", "moments-tab", function () { selectFilter("all"); }); all.dataset.momentsFilter = "all";
    var mine = ui.button("我的动态", "moments-tab", function () { selectFilter("mine"); }); mine.dataset.momentsFilter = "mine"; tabs.append(all, mine);
    var feed = ui.element("div", "moments-feed"); feed.dataset.momentsFeed = "";
    content.append(profile, tabs, feed); scroll.append(content); root.append(head, scroll);
    function recordById(id) { return records.find(function (record) { return record.id === id; }); }
    function focus(node) { if (node) node.focus({ preventScroll: true }); }
    function focusComments() {
      var input = scroll.querySelector("[aria-label='评论内容']");
      if (!input) return;
      var section = input.closest(".moments-comments");
      if (section && typeof section.scrollIntoView === "function") section.scrollIntoView({ block: "start" });
      focus(input);
    }
    function closePreview(restore) { if (preview) { preview.destroy(restore); preview = null; } }
    function showImage(image, index) {
      if (disposed || !active) return; closePreview(false);
      preview = ui.modal(root, "图片预览", "关闭图片预览", function () { closePreview(); });
      preview.overlay.dataset.momentsViewer = ""; preview.dialog.classList.add("moments-image-dialog"); preview.dialog.append(ui.image(image.url, "动态图片 " + (index + 1)));
    }
    function release(record) {
      record.images.forEach(commentState.releaseImage);
      record.comments.forEach(function (comment) { comment.images.forEach(commentState.releaseImage); });
      commentState.release(record.id);
    }
    function visibleCard(id) { return Array.from(feed.querySelectorAll("[data-moment-id]")).find(function (card) { return card.dataset.momentId === id; }); }
    function renderFeed() {
      all.setAttribute("aria-pressed", String(filter === "all")); mine.setAttribute("aria-pressed", String(filter === "mine"));
      all.classList.toggle("is-active", filter === "all"); mine.classList.toggle("is-active", filter === "mine");
      feed.replaceChildren(); var visible = records.filter(function (record) { return filter !== "mine" || record.authorId === self.id; });
      if (!visible.length) feed.append(ui.element("p", "moments-empty", filter === "mine" ? "还没有发布动态，记录你的第一份日常吧。" : "还没有动态，和好友分享这一刻吧。"));
      visible.forEach(function (record) { feed.append(render.card(record, context)); });
    }
    function listHead() { head.classList.remove("is-reading"); head.replaceChildren(title, publish, status); root.dataset.momentsView = "feed"; }
    function returnToFeed(restoreFocus) {
      if (disposed) return; closePreview(false); commentState.detach(); selectedId = null; readerScroll = 0;
      listHead(); renderFeed(); scroll.replaceChildren(content); scroll.scrollTop = listScroll;
      if (restoreFocus !== false) {
        var card = entry && visibleCard(entry.id);
        var selector = entry && entry.source === "link" ? "[data-moments-read]" : entry && entry.source === "comment" ? "[data-moments-comment]" : "[data-moments-read-body]";
        focus(card && card.querySelector(selector) || (filter === "mine" ? mine : all));
      }
    }
    function deleteReading() {
      var record = recordById(selectedId);
      if (disposed || !record || record.authorId !== self.id || !window.confirm("确定删除这条动态吗？")) return;
      release(record); records = records.filter(function (candidate) { return candidate !== record; });
      returnToFeed(); status.textContent = "动态已删除";
    }
    function renderReader() {
      var record = recordById(selectedId); if (!record) { returnToFeed(); return; } commentState.detach();
      head.classList.add("is-reading"); root.dataset.momentsView = "reader";
      var back = ui.button("返回朋友圈", "moments-back", function () { returnToFeed(); }); back.dataset.momentsBack = "";
      var heading = ui.element("h1", "moments-reader-title", "阅读全文"); heading.tabIndex = -1;
      head.replaceChildren(back, heading);
      if (record.authorId === self.id) { var remove = ui.button("删除动态", "moments-delete moments-reader-delete", deleteReading); remove.dataset.momentsDelete = ""; head.append(remove); }
      head.append(status); scroll.replaceChildren(window.renderWhisperMomentsReader(record, context));
    }
    function openReading(id, source, focusComment) {
      if (disposed || !active || !recordById(id)) return;
      if (selectedId === id) { if (focusComment) focusComments(); return; }
      listScroll = scroll.scrollTop; entry = { id: id, source: source }; selectedId = id; readerScroll = 0; closePreview(false);
      renderReader(); scroll.scrollTop = 0;
      if (focusComment) focusComments(); else focus(head.querySelector(".moments-reader-title"));
    }
    function selectFilter(value) { filter = value; listScroll = 0; renderFeed(); scroll.scrollTop = 0; }
    function refreshCurrent(selector, id) {
      var position = scroll.scrollTop;
      if (selectedId) renderReader(); else renderFeed();
      scroll.scrollTop = position;
      var area = selectedId ? scroll : visibleCard(id); focus(area && (typeof selector === "function" ? selector(area) : area.querySelector(selector)));
    }
    var context = { people: people, self: self, commentState: commentState, open: openReading, showImage: showImage,
      like: function (id) {
        var record = recordById(id); if (disposed || !record) return;
        var index = record.likedBy.indexOf(self.id); if (index < 0) record.likedBy.push(self.id); else record.likedBy.splice(index, 1);
        var area = selectedId ? scroll.querySelector(".moments-reader-content") : visibleCard(id);
        if (area) {
          var actions = area.querySelector(".moments-actions"), likes = area.querySelector("[data-moments-likes]");
          if (actions) actions.replaceWith(render.actions(record, context));
          if (likes) likes.replaceWith(render.likes(record, people));
          focus(area.querySelector("[data-moments-like]"));
        }
      },
      likeComment: function (id, commentId) {
        var record = recordById(id), comment = record && record.comments.find(function (item) { return item.id === commentId; });
        if (disposed || !comment) return;
        var index = comment.likedBy.indexOf(self.id); if (index < 0) comment.likedBy.push(self.id); else comment.likedBy.splice(index, 1);
      },
      comment: function (id, targetId) {
        var record = recordById(id); if (disposed || !record) return;
        var target = targetId && record.comments.find(function (comment) { return comment.id === targetId; });
        if (targetId && !target) return;
        var payload = commentState.take(id, targetId); if (!payload) return;
        record.comments.push({ id: "comment-new-" + (++nextCommentId), authorId: self.id, text: payload.text, images: payload.images,
          likedBy: [], rootCommentId: target ? target.rootCommentId || target.id : null,
          replyToUserId: target ? target.authorId : null, replyToCommentId: target ? target.id : null,
          replyToName: target && people[target.authorId] ? people[target.authorId].name : "", time: "刚刚", createdAt: new Date().toISOString() });
        if (targetId) commentState.setActiveTarget(id, null);
        refreshCurrent(function (area) {
          if (targetId) return Array.from(area.querySelectorAll("[data-comment-id]")).find(function (row) { return row.dataset.commentId === targetId; }).querySelector(".moments-comment-reply");
          var heading = area.querySelector(".moments-comments-heading"); heading.tabIndex = -1; return heading;
        }, id); status.textContent = targetId ? "回复已发表" : "评论已发表";
      }
    };
    var composer = window.createWhisperMomentsComposer({ root: root, onPublish: function (text, images) {
      if (disposed) { images.forEach(function (image) { URL.revokeObjectURL(image.url); }); return; }
      records.unshift({ id: "moment-new-" + (++nextId), authorId: self.id, text: text, images: images, time: "刚刚", likedBy: [], comments: [] });
      renderFeed(); listScroll = 0; scroll.scrollTop = 0; status.textContent = "动态发布成功";
    } });
    function openComposer() { if (!disposed && active && !selectedId) composer.open(); }
    publish.addEventListener("click", openComposer); listHead(); renderFeed();
    return {
      setActive: function (value) {
        if (disposed || active === value) return;
        active = value;
        if (!active) { if (selectedId) readerScroll = scroll.scrollTop; else listScroll = scroll.scrollTop; composer.close(false); closePreview(false); }
        else scroll.scrollTop = selectedId ? readerScroll : listScroll;
      },
      destroy: function () {
        if (disposed) return; disposed = true; composer.destroy(); closePreview(false); records.forEach(release); records = []; commentState.destroy();
        publish.removeEventListener("click", openComposer); root.replaceChildren();
      }
    };
  };
})();
