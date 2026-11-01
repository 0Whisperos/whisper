(function () {
  "use strict";
  window.createWhisperMomentsComposer = function (options) {
    var ui = window.WhisperMomentsUI;
    var text = "", images = [], modal = null, disposed = false, sequence = 0;
    var body, grid, status, submit;
    function release(item) {
      item.version += 1;
      if (item.loader) { item.loader.onload = null; item.loader.onerror = null; }
      if (item.url) URL.revokeObjectURL(item.url);
      item.url = "";
    }
    function report(message) { if (status) status.textContent = message; }
    function updateSubmit() {
      if (!submit) return;
      submit.disabled = (!text.trim() && !images.length) || Array.from(text).length > 2000
        || images.some(function (image) { return image.state !== "ready"; });
    }
    function decode(item) {
      var version = ++item.version;
      item.state = "loading";
      if (item.loader) { item.loader.onload = null; item.loader.onerror = null; }
      var loader = new Image(); item.loader = loader;
      function finish(success) {
        if (disposed || item.version !== version || images.indexOf(item) < 0) return;
        item.state = success ? "ready" : "error";
        loader.onload = null; loader.onerror = null;
        renderImages();
        if (!success) report("图片加载失败，请重新加载或移除后重试");
        else if (images.every(function (image) { return image.state === "ready"; })) report("");
      }
      loader.onload = function () { finish(true); };
      loader.onerror = function () { finish(false); };
      loader.src = item.url;
    }
    function renderImages() {
      if (!grid) return;
      grid.replaceChildren();
      images.forEach(function (item, index) {
        var tile = ui.element("div", "moments-draft-item"); tile.dataset.momentsImageId = item.id;
        var picture = ui.element("img", ""); picture.src = item.url; picture.alt = "待发布图片 " + (index + 1);
        var description = ui.element("span", "moments-image-state", item.state === "loading" ? "图片加载中…" : item.state === "error" ? "图片加载失败" : item.file.name);
        tile.append(picture, description);
        if (item.state === "error") tile.append(ui.button("重新加载图片", "moments-retry", function () { decode(item); renderImages(); }));
        var remove = ui.button("移除图片 " + (index + 1), "moments-remove-image", function () {
          release(item); images = images.filter(function (candidate) { return candidate !== item; });
          renderImages(); report("");
        });
        remove.dataset.momentsRemoveImage = item.id; tile.append(remove); grid.append(tile);
      });
      updateSubmit();
    }
    function choose(files) {
      if (disposed) return;
      if (images.length + files.length > 9) { report("每条动态最多选择 9 张图片"); return; }
      var allowed = ["image/jpeg", "image/png", "image/webp"];
      if (files.some(function (file) { return allowed.indexOf(file.type) < 0; })) { report("仅支持 JPEG、PNG 或 WebP 图片"); return; }
      if (files.some(function (file) { return file.size > 20 * 1024 * 1024; })) { report("单张图片不能超过 20 MiB"); return; }
      report("");
      files.forEach(function (file) {
        var item = { id: "draft-" + (++sequence), file: file, url: "", state: "loading", version: 0, loader: null };
        try { item.url = URL.createObjectURL(file); } catch (_) { report("无法读取图片，请重新选择"); return; }
        images.push(item); decode(item);
      });
      renderImages();
    }
    function close(restore) {
      if (!modal) return;
      var current = modal; modal = null;
      body = null; grid = null; status = null; submit = null;
      current.destroy(restore);
    }
    function publish() {
      updateSubmit(); if (!submit || submit.disabled || disposed) return;
      var transferred = images.map(function (item) { return { url: item.url, owned: true }; });
      var content = text.trim();
      images.forEach(function (item) { item.version += 1; if (item.loader) { item.loader.onload = null; item.loader.onerror = null; } });
      images = []; text = "";
      close(); options.onPublish(content, transferred);
    }
    return {
      open: function () {
        if (disposed || modal) return;
        modal = ui.modal(options.root, "发布动态", "关闭发布窗口", function () { close(); });
        modal.overlay.dataset.momentsComposer = "";
        var label = ui.element("label", "moments-field", "记录这一刻");
        body = ui.element("textarea", "moments-textarea"); body.rows = 5; body.value = text;
        body.setAttribute("aria-label", "动态正文"); body.placeholder = "分享生活中的新鲜事…";
        body.dataset.momentsText = "";
        body.addEventListener("input", function () {
          text = body.value; report(Array.from(text).length > 2000 ? "动态正文不能超过 2000 字" : ""); updateSubmit();
        });
        label.append(body);
        var hint = ui.element("p", "moments-hint", "最多 2000 字 · 9 张图片 · JPEG / PNG / WebP · 单张不超过 20 MiB");
        var pickerLabel = ui.element("label", "moments-field moments-picker", "添加图片");
        var picker = ui.element("input", ""); picker.type = "file"; picker.multiple = true;
        picker.accept = "image/jpeg,image/png,image/webp"; picker.setAttribute("aria-label", "选择动态图片"); picker.dataset.momentsFiles = "";
        picker.addEventListener("change", function () { choose(Array.from(picker.files || [])); picker.value = ""; }); pickerLabel.append(picker);
        grid = ui.element("div", "moments-draft-grid"); grid.dataset.momentsDraftImages = "";
        status = ui.element("p", "moments-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
        var actions = ui.element("footer", "moments-dialog-actions");
        var cancel = ui.button("取消", "moments-secondary", function () { close(); });
        submit = ui.button("确认发布", "moments-primary", publish); submit.dataset.momentsSubmit = "";
        actions.append(cancel, submit);
        modal.dialog.append(label, hint, pickerLabel, grid, ui.element("p", "moments-visibility", "自己和好友可见"), status, actions);
        renderImages(); body.focus();
      },
      close: close,
      destroy: function () { if (disposed) return; disposed = true; close(false); images.forEach(release); images = []; text = ""; }
    };
  };
})();
