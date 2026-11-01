(function () {
  "use strict";
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, className, action) {
    var node = element("button", className, label);
    node.type = "button"; node.setAttribute("aria-label", label);
    if (action) node.addEventListener("click", action);
    return node;
  }
  function modal(root, title, closeLabel, onClose) {
    var overlay = element("div", "moments-overlay");
    var dialog = element("section", "moments-dialog");
    var heading = element("h2", "", title);
    heading.id = "moments-dialog-" + Math.random().toString(36).slice(2);
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", heading.id); dialog.tabIndex = -1;
    var header = element("header", "moments-dialog-head");
    var close = button(closeLabel, "moments-close", function () { onClose(); });
    header.append(heading, close); dialog.append(header); overlay.append(dialog);
    var previous = document.activeElement;
    var destroyed = false;
    function keydown(event) {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return; }
      if (event.key !== "Tab") return;
      var focusable = Array.from(dialog.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex='0']"))
        .filter(function (node) { return !node.closest("[hidden]") && getComputedStyle(node).visibility !== "hidden"; });
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    overlay.addEventListener("click", function (event) { if (event.target === overlay) onClose(); });
    document.addEventListener("keydown", keydown, true);
    root.append(overlay); close.focus();
    return { dialog: dialog, overlay: overlay, destroy: function (restore) {
      if (destroyed) return; destroyed = true;
      document.removeEventListener("keydown", keydown, true); overlay.remove();
      if (restore !== false && previous && previous.isConnected && !previous.closest("[hidden]")) previous.focus();
    } };
  }
  function image(source, label, onOpen) {
    var wrapper = element("div", "moments-image");
    var open = onOpen ? button(label, "moments-image-button", onOpen) : element("div", "moments-image-button");
    open.textContent = "";
    var picture = element("img", ""); picture.alt = label; picture.src = source;
    var failure = element("div", "moments-image-error"); failure.hidden = true;
    failure.append(element("span", "", "图片加载失败"));
    var retry = button("重新加载图片", "moments-retry", function () {
      failure.hidden = true; picture.hidden = false;
      picture.src = ""; picture.src = source;
    });
    failure.append(retry);
    picture.addEventListener("error", function () { picture.hidden = true; failure.hidden = false; open.disabled = true; });
    picture.addEventListener("load", function () { picture.hidden = false; failure.hidden = true; open.disabled = false; });
    open.append(picture); wrapper.append(open, failure);
    return wrapper;
  }
  window.WhisperMomentsUI = { element: element, button: button, modal: modal, image: image };
})();
