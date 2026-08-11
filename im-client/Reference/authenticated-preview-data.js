(function () {
  "use strict";

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.getOwnPropertyNames(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  window.__whisperAuthenticatedPrototypeData = deepFreeze({
    self: { id: "lin", name: "林澈", avatar: "林", tone: "blue" },
    sessions: [
      { id: "files", name: "文件传输助手", avatar: "文", tone: "gray", type: "assistant", preview: "已保存到本机", time: "10:42", pinned: true },
      { id: "linxiao", name: "林晓", avatar: "晓", tone: "teal", type: "direct", preview: "晚饭回家吃吗？", time: "10:28", unread: 2 },
      { id: "family", name: "家庭群", avatar: "家", tone: "gold", type: "group", preview: "妈妈：周末一起吃饭", time: "09:50", mentionsMe: true },
      { id: "product", name: "产品讨论组", avatar: "产", tone: "blue", type: "group", preview: "周然：版本说明已更新", time: "昨天", unread: 5 },
      { id: "zhouran", name: "周然", avatar: "周", tone: "orange", type: "direct", preview: "收到，明天同步", time: "昨天", draft: true },
      { id: "chenmo", name: "陈默", avatar: "陈", tone: "purple", type: "direct", preview: "骑行路线我来定", time: "周二", muted: true },
      { id: "bike", name: "骑行小队", avatar: "骑", tone: "green", type: "group", preview: "阿舟：周六七点集合", time: "周二", unread: 3 },
      { id: "xuyan", name: "许言", avatar: "许", tone: "rose", type: "direct", preview: "下午茶别忘了", time: "周一" }
    ],
    conversations: {
      files: { id: "files", type: "assistant", name: "文件传输助手", avatar: "文", tone: "gray", status: "仅自己可见", participants: {
        assistant: { name: "文件传输助手", avatar: "文", tone: "gray" }
      }, messages: [
        { senderId: "assistant", senderName: "文件传输助手", side: "left", text: "会议纪要.pdf 已保存到本机。", time: "10:36", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "好的，稍后打开。", time: "10:42", showTime: false, showAvatar: true, receipt: "已送达" }
      ] },
      linxiao: { id: "linxiao", type: "direct", name: "林晓", avatar: "晓", tone: "teal", status: "在线", participants: {
        linxiao: { name: "林晓", avatar: "晓", tone: "teal" }
      }, messages: [
        { senderId: "linxiao", senderName: "林晓", side: "left", text: "晚饭回家吃吗？", time: "10:25", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "好，我六点前到。", time: "10:28", showTime: false, showAvatar: true, receipt: "已读" }
      ] },
      family: { id: "family", type: "group", name: "家庭群", avatar: "家", tone: "gold", status: "4 位成员", participants: {
        mum: { name: "妈妈", avatar: "妈", tone: "rose" },
        dad: { name: "爸爸", avatar: "爸", tone: "teal" }
      }, messages: [
        { senderId: "mum", senderName: "妈妈", side: "left", text: "周末一起吃饭，想吃什么？", time: "09:40", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "dad", senderName: "爸爸", side: "left", text: "我负责订位置。", time: "09:42", showTime: false, showAvatar: true, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "我都可以，听你们安排。", time: "09:50", showTime: false, showAvatar: true, receipt: "已读" },
        { senderId: "mum", senderName: "妈妈", side: "left", text: "周末一起吃饭，想吃什么？", time: "09:40", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "dad", senderName: "爸爸", side: "left", text: "我负责订位置。", time: "09:42", showTime: false, showAvatar: true, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "我都可以，听你们安排。", time: "09:50", showTime: false, showAvatar: true, receipt: "已读" },
        { senderId: "mum", senderName: "妈妈", side: "left", text: "周末一起吃饭，想吃什么？", time: "09:40", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "dad", senderName: "爸爸", side: "left", text: "我负责订位置。", time: "09:42", showTime: false, showAvatar: true, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "我都可以，听你们安排。", time: "09:50", showTime: false, showAvatar: true, receipt: "已读" }
      ] },
      product: { id: "product", type: "group", name: "产品讨论组", avatar: "产", tone: "blue", status: "12 位成员", participants: {
        zhou: { name: "周然", avatar: "周", tone: "orange" }
      }, messages: [
        { senderId: "zhou", senderName: "周然", side: "left", text: "@林澈 版本说明已更新，麻烦看下最后两项。", time: "昨天 16:20", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "zhou", senderName: "周然", side: "left", text: "截图也放到共享文件夹了。", time: "昨天 16:21", showTime: false, showAvatar: false, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "收到，我午饭前确认。", time: "昨天 16:25", showTime: false, showAvatar: true, receipt: "已读" }
      ] },
      zhouran: { id: "zhouran", type: "direct", name: "周然", avatar: "周", tone: "orange", status: "手机在线", participants: {
        zhou: { name: "周然", avatar: "周", tone: "orange" }
      }, messages: [
        { senderId: "zhou", senderName: "周然", side: "left", text: "明天十点同步可以吗？", time: "昨天 18:04", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "可以，我会准备好。", time: "昨天 18:05", showTime: false, showAvatar: true, receipt: "已送达" }
      ] },
      chenmo: { id: "chenmo", type: "direct", name: "陈默", avatar: "陈", tone: "purple", status: "离线", participants: {
        chen: { name: "陈默", avatar: "陈", tone: "purple" }
      }, messages: [
        { senderId: "chen", senderName: "陈默", side: "left", text: "骑行路线我来定。", time: "周二 20:12", showTime: true, showAvatar: true, receipt: "" }
      ] },
      bike: { id: "bike", type: "group", name: "骑行小队", avatar: "骑", tone: "green", status: "8 位成员", participants: {
        zhou: { name: "阿舟", avatar: "舟", tone: "green" },
        chen: { name: "陈默", avatar: "陈", tone: "purple" }
      }, messages: [
        { senderId: "zhou", senderName: "阿舟", side: "left", text: "周六七点在北门集合。", time: "周二 19:30", showTime: true, showAvatar: true, receipt: "" },
        { senderId: "chen", senderName: "陈默", side: "left", text: "记得带水和补胎工具。", time: "周二 19:31", showTime: false, showAvatar: true, receipt: "" },
        { senderId: "lin", senderName: "林澈", side: "right", text: "收到。", time: "周二 19:35", showTime: false, showAvatar: true, receipt: "已送达" }
      ] },
      xuyan: { id: "xuyan", type: "direct", name: "许言", avatar: "许", tone: "rose", status: "忙碌中", participants: {
        xu: { name: "许言", avatar: "许", tone: "rose" }
      }, messages: [
        { senderId: "xu", senderName: "许言", side: "left", text: "下午茶别忘了。", time: "周一 14:00", showTime: true, showAvatar: true, receipt: "" }
      ] }
    },
    contacts: [
      { id: "linxiao", name: "林晓", avatar: "晓", tone: "teal", account: "linxiao", region: "上海", status: "在线", conversationId: "linxiao", section: "L" },
      { id: "chenmo", name: "陈默", avatar: "陈", tone: "purple", account: "chenmo", region: "杭州", status: "离线", conversationId: "chenmo", section: "C" },
      { id: "xuyan", name: "许言", avatar: "许", tone: "rose", account: "xuyan", region: "北京", status: "忙碌中", conversationId: "xuyan", section: "X" },
      { id: "zhouran", name: "周然", avatar: "周", tone: "orange", account: "zhouran", region: "深圳", status: "手机在线", conversationId: "zhouran", section: "Z" }
    ],
    contactSections: [{ id: "C", label: "C" }, { id: "L", label: "L" }, { id: "X", label: "X" }, { id: "Z", label: "Z" }]
  });
})();
