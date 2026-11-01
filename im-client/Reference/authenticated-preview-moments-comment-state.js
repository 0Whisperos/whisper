(function () {
  "use strict";
  window.createWhisperCommentState = function () {
    var drafts = Object.create(null), activeTargets = Object.create(null), disposed = false, sequence = 0;
    function key(id, targetId) { return JSON.stringify([id, targetId || null]); }
    function get(id, targetId) {
      var draftKey = key(id, targetId);
      if (!drafts[draftKey]) drafts[draftKey] = { recordId: id, targetId: targetId || null, text: "", images: [], expanded: false, start: 0, end: 0, error: "", notify: null };
      return drafts[draftKey];
    }
    function notify(draft) { if (draft.notify) draft.notify(); }
    function imageError(draft) {
      return draft.images.some(function (image) { return image.state === "error"; }) ? "图片加载失败，请重新加载或移除后重试" : "";
    }
    function releaseImage(image) {
      image.version += 1;
      if (image.loader) { image.loader.onload = null; image.loader.onerror = null; }
      if (image.owned && image.url) URL.revokeObjectURL(image.url);
      image.owned = false; image.url = "";
    }
    function decode(draft, image) {
      var version = ++image.version; image.state = "loading";
      if (image.loader) { image.loader.onload = null; image.loader.onerror = null; }
      var loader = new Image(); image.loader = loader;
      function finish(success) {
        if (disposed || image.version !== version || draft.images.indexOf(image) < 0) return;
        loader.onload = null; loader.onerror = null; image.state = success ? "ready" : "error";
        draft.error = imageError(draft); notify(draft);
      }
      loader.onload = function () { finish(true); }; loader.onerror = function () { finish(false); }; loader.src = image.url;
    }
    function choose(id, files, targetId) {
      if (disposed) return; var draft = get(id, targetId), allowed = ["image/jpeg", "image/png", "image/webp"];
      if (draft.images.length + files.length > 9) draft.error = "每条评论最多选择 9 张图片";
      else if (files.some(function (file) { return allowed.indexOf(file.type) < 0; })) draft.error = "仅支持 JPEG、PNG 或 WebP 图片";
      else if (files.some(function (file) { return file.size > 20 * 1024 * 1024; })) draft.error = "单张图片不能超过 20 MiB";
      else {
        draft.error = "";
        files.forEach(function (file) {
          var image = { id: "comment-image-" + (++sequence), file: file, url: "", owned: true, state: "loading", version: 0, loader: null };
          try { image.url = URL.createObjectURL(file); } catch (_) { draft.error = "无法读取图片，请重新选择"; return; }
          draft.images.push(image); decode(draft, image);
        });
      }
      draft.expanded = true; notify(draft);
    }
    function valid(draft) {
      return Boolean(draft.text.trim() || draft.images.length) && Array.from(draft.text).length <= 500
        && draft.images.every(function (image) { return image.state === "ready"; });
    }
    return {
      drafts: drafts, get: get, choose: choose, valid: valid,
      retry: function (id, image, targetId) { if (disposed) return; var draft = get(id, targetId); decode(draft, image); draft.error = imageError(draft); notify(draft); },
      remove: function (id, image, targetId) { if (disposed) return; var draft = get(id, targetId); releaseImage(image); draft.images = draft.images.filter(function (item) { return item !== image; }); draft.error = imageError(draft); notify(draft); },
      take: function (id, targetId) {
        var draft = get(id, targetId); if (disposed || !valid(draft)) return null;
        var payload = { text: draft.text.trim(), images: draft.images.map(function (image) {
          image.version += 1; if (image.loader) { image.loader.onload = null; image.loader.onerror = null; }
          return { url: image.url, owned: true };
        }) };
        draft.images = []; draft.text = ""; draft.expanded = false; draft.start = draft.end = 0; draft.error = "";
        return payload;
      },
      detach: function () { Object.keys(drafts).forEach(function (id) { drafts[id].notify = null; }); },
      activeTarget: function (id) { return activeTargets[id] || null; },
      setActiveTarget: function (id, targetId) { activeTargets[id] = targetId || null; },
      release: function (id) {
        Object.keys(drafts).forEach(function (draftKey) { if (drafts[draftKey].recordId !== id) return; drafts[draftKey].images.forEach(releaseImage); drafts[draftKey].notify = null; delete drafts[draftKey]; });
        delete activeTargets[id];
      },
      destroy: function () { disposed = true; Object.keys(drafts).forEach(function (id) { drafts[id].images.forEach(releaseImage); drafts[id].notify = null; }); },
      releaseImage: releaseImage
    };
  };
})();
