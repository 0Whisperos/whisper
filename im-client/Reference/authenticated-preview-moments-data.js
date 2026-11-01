(function () {
  "use strict";
  function illustration(background, foreground, caption) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540" viewBox="0 0 720 540"><rect width="720" height="540" fill="' + background + '"/><circle cx="550" cy="120" r="56" fill="#f6e6a6"/><path d="M0 400 170 190 340 380 490 220 720 410V540H0Z" fill="' + foreground + '"/><path d="M0 455 230 320 400 440 600 300 720 410V540H0Z" fill="#ffffff" opacity=".28"/><text x="40" y="490" fill="#ffffff" font-family="sans-serif" font-size="28">' + caption + '</text></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  var lake = illustration("#b9d6df", "#49736e", "湖边的下午");
  var mountain = illustration("#c6cce0", "#64728f", "山间小路");
  var sunset = illustration("#d9b8a4", "#996f63", "日落之前");
  window.__whisperMomentsProfiles = Object.freeze({
    lin: Object.freeze({ signature: "给忙碌的生活，留一点自己的时间。" }),
    linxiao: Object.freeze({ signature: "在日常里寻找一点新的风景。" }),
    chenmo: Object.freeze({ signature: "骑车、读书，偶尔写一点生活。" }),
    xuyan: Object.freeze({ signature: "收藏日落，也收藏小小的快乐。" }),
    zhouran: Object.freeze({ signature: "认真工作，好好生活。" })
  });
  var records = [
    { id: "moment-linxiao", authorId: "linxiao", text: "周末出门走走。沿着湖边散步，才发现春天已经悄悄来了。", time: "10 分钟前", images: [lake, mountain, sunset], likedBy: ["chenmo"], comments: [{ id: "comment-linxiao-1", authorId: "chenmo", text: "这里好漂亮，下次一起！", time: "5 分钟前", createdAt: "2026-11-01T08:55:00+08:00" }] },
    { id: "moment-self", authorId: "lin", text: "给忙碌的一天留一点空白。今天终于把想读很久的书翻开了。", time: "35 分钟前", images: [], likedBy: ["linxiao", "xuyan"], comments: [] },
    { id: "moment-chenmo", authorId: "chenmo", text: "今天骑行了很远的一段路。出发的时候还在想，究竟什么才算一个值得记住的周末。后来经过河边、旧街和一片刚刚返青的草地，忽然觉得，没有安排的时间也很珍贵。\n\n路上和朋友聊起小时候的夏天，聊起那些没能说完的话题。我们在路边的小店停下来，点了热茶，看着窗外来来往往的人。\n\n回家的时候天色渐暗，风还是有些凉，但心里比出发时轻松了许多。把这一刻记下来，提醒自己下次也别忘了出门。", time: "1 小时前", images: [mountain], likedBy: [], comments: [] },
    { id: "moment-xuyan", authorId: "xuyan", text: "", time: "昨天 17:42", images: [sunset], likedBy: ["lin"], comments: [] },
    { id: "moment-stranger", authorId: "stranger", text: "这条非好友内容不应出现在动态流。", time: "昨天", images: [], likedBy: [], comments: [] }
  ];
  records.find(function (record) { return record.id === "moment-chenmo"; }).comments.push(
    { id: "comment-thread-a", authorId: "linxiao", text: "这样的周末真好，下次一起骑车吧。", time: "50 分钟前", createdAt: "2026-11-01T08:10:00+08:00" },
    { id: "comment-thread-b", authorId: "chenmo", rootCommentId: "comment-thread-a", replyToCommentId: "comment-thread-a", replyToUserId: "linxiao", text: "好呀，路线我已经记下了！", time: "45 分钟前", createdAt: "2026-11-01T08:15:00+08:00" },
    { id: "comment-thread-c", authorId: "xuyan", rootCommentId: "comment-thread-a", replyToCommentId: "comment-thread-b", replyToUserId: "chenmo", text: "也带上我，顺便一起看日落。", time: "40 分钟前", createdAt: "2026-11-01T08:20:00+08:00" }
  );
  records.forEach(function (record) {
    record.comments.forEach(function (comment) { comment.likedBy = ["xuyan"]; Object.freeze(comment.likedBy); Object.freeze(comment); });
    Object.freeze(record.images); Object.freeze(record.likedBy); Object.freeze(record.comments); Object.freeze(record);
  });
  window.__whisperMomentsSeed = Object.freeze(records);
})();
