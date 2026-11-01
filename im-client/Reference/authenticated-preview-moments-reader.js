(function () {
  "use strict";
  window.renderWhisperMomentsReader = function (record, context) {
    var ui = window.WhisperMomentsUI, render = window.WhisperMomentsRender;
    var reader = ui.element("article", "moments-reader"); reader.dataset.momentsReader = ""; reader.dataset.momentId = record.id;
    var head = ui.element("header", "moments-reader-head"); head.append(render.author(context.people[record.authorId]));
    var body = ui.element("div", "moments-reader-content");
    if (record.text) body.append(render.body(record, context, true));
    if (record.images.length) body.append(render.images(record, context));
    body.append(ui.element("time", "moments-card-meta moments-time", record.time), render.actions(record, context), render.likes(record, context.people));
    reader.append(head, body, window.renderWhisperMomentsComments(record, context)); return reader;
  };
})();
