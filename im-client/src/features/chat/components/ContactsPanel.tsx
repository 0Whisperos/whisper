import { useEffect, useState } from "react";

import type { ChatContact, ChatContactSection, ChatSelfProfile, FriendRequestDirection, FriendRequestDto } from "../types";
import type { useFriendRequests } from "../hooks/useFriendRequests";
import { createFriendRequest, respondToFriendRequest, searchUserByAccount } from "../friendRequestsApi";
import { ChatApiError } from "../api";
import { Avatar, Icon, IconButton } from "./ui";

interface ContactsPanelProps {
  hidden: boolean;
  contacts: ChatContact[];
  sections: ChatContactSection[];
  activeContact: ChatContact | null;
  activeContactId: string;
  statusMessage: string;
  self: ChatSelfProfile;
  apiBaseUrl: string;
  accessToken: string;
  friendRequests: ReturnType<typeof useFriendRequests>;
  onRefreshFriends: () => Promise<void>;
  onSelectContact: (contactId: string) => void;
  onEnterConversation: (contact: ChatContact) => void;
  onReturnToContacts: () => void;
  onToolPreview: (name: string) => void;
}

type ContactPage = "contacts" | "requests";

export function ContactsPanel(props: ContactsPanelProps) {
  const { hidden, contacts, sections, activeContact, activeContactId, statusMessage, self, apiBaseUrl, accessToken, friendRequests, onRefreshFriends, onSelectContact, onEnterConversation, onReturnToContacts, onToolPreview } = props;
  const [page, setPage] = useState<ContactPage>("contacts");
  const [direction, setDirection] = useState<FriendRequestDirection>("incoming");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [account, setAccount] = useState("");
  const [verification, setVerification] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof searchUserByAccount>>>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!hidden) {
      void friendRequests.refresh();
      void onRefreshFriends();
    }
  }, [hidden, friendRequests.refresh, onRefreshFriends]);

  const openRequests = () => {
    setPage("requests");
    setActionError("");
    void friendRequests.refresh();
  };

  const search = async () => {
    const normalized = account.trim();
    if (!normalized) { setSearchError("请输入账号"); return; }
    if (!/^\d{8,12}$/.test(normalized)) { setResult(null); setSearchError("请输入 8–12 位完整数字账号"); return; }
    setSearching(true);
    setSearchError("");
    setResult(null);
    try {
      const found = await searchUserByAccount(apiBaseUrl, accessToken, normalized);
      setResult(found);
      if (!found) setSearchError("没有找到该用户");
    } catch { setSearchError("搜索失败，请稍后重试"); }
    finally { setSearching(false); }
  };

  const submitRequest = async () => {
    if (!result) return;
    setSubmitting(true);
    setSearchError("");
    try {
      await createFriendRequest(apiBaseUrl, accessToken, result.account, verification.trim());
      setVerificationOpen(false);
      setAddDialogOpen(false);
      setVerification("");
      await Promise.all([friendRequests.refresh(), onRefreshFriends()]);
    } catch (caught) {
      if (caught instanceof ChatApiError && caught.code === "friend_request_pending") {
        setSearchError("已发送申请，请在发出的申请中查看");
        void friendRequests.refresh();
      } else setSearchError("发送申请失败，请稍后重试");
    }
    finally { setSubmitting(false); }
  };

  const respond = async (request: FriendRequestDto, action: "accept" | "reject") => {
    setBusyRequestId(request.requestId);
    setActionError("");
    try {
      await respondToFriendRequest(apiBaseUrl, accessToken, request.requestId, action);
      await Promise.all([friendRequests.refresh(), onRefreshFriends()]);
    } catch { setActionError("处理申请失败，请稍后重试"); }
    finally { setBusyRequestId(null); }
  };

  const searchIsSelf = result?.userId === self.userId;
  const existingFriend = result ? contacts.find((contact) => contact.userId === result.userId) : undefined;
  const outgoingPending = result && friendRequests.outgoing.some((request) => request.recipient.userId === result.userId && request.status === "pending");
  const incomingPending = result && friendRequests.incoming.some((request) => request.sender.userId === result.userId && request.status === "pending");
  const currentPageHasIncomingPending = friendRequests.incoming.some((request) => request.status === "pending");

  return (
    <section className="auth-contacts-panel" aria-label="好友" data-contact-page={page} hidden={hidden}>
      <header className="auth-contacts-head">
        <div className="auth-contacts-title">
          <p className="auth-eyebrow">通讯录</p>
          <h1>好友</h1>
        </div>
        <div className="auth-contacts-view-head">
          {page === "requests" ? (
            <>
              <h2>好友申请</h2>
              <div className="auth-request-direction" role="group" aria-label="申请方向">
                <button type="button" aria-pressed={direction === "incoming"} onClick={() => setDirection("incoming")}>收到的申请</button>
                <button type="button" aria-pressed={direction === "outgoing"} onClick={() => setDirection("outgoing")}>发出的申请</button>
              </div>
            </>
          ) : activeContact ? <h2>{activeContact.name}</h2> : null}
          <output className="auth-panel-status" aria-live="polite">{statusMessage}</output>
        </div>
        <IconButton icon="back" label="返回联系人" className="auth-contact-back" onClick={() => page === "requests" ? setPage("contacts") : onReturnToContacts()} />
      </header>
      <div className="auth-contacts-layout">
        <section className="auth-contact-list" aria-label="联系人列表">
          <p className="auth-contact-section-label">发现</p>
          <button type="button" className="auth-system-contact auth-discovery-contact" onClick={() => { setAddDialogOpen(true); setAccount(""); setResult(null); setSearchError(""); }}>
            <span className="auth-system-contact-icon auth-add-friend-icon"><Icon name="plus" /></span>
            <span className="auth-system-contact-copy"><strong>朋友</strong><small>通过账号搜索</small></span>
            <span className="auth-system-contact-chevron" aria-hidden="true">›</span>
          </button>
          <button type="button" className="auth-system-contact auth-discovery-contact" onClick={() => onToolPreview("群聊")}>
            <span className="auth-system-contact-icon auth-group-preview-icon"><Icon name="plus" /></span>
            <span className="auth-system-contact-copy"><strong>群聊</strong><small>敬请期待</small></span>
            <span className="auth-system-contact-chevron" aria-hidden="true">›</span>
          </button>
          <p className="auth-contact-section-label auth-contact-section-spaced">通知</p>
          <button type="button" className={`auth-system-contact auth-discovery-contact auth-new-friends-contact ${page === "requests" ? "is-active" : ""}`} onClick={openRequests}>
            <span className="auth-system-contact-copy"><strong>新的朋友</strong><small>查看好友申请</small></span>
            {friendRequests.pendingCount > 0 ? <b aria-label={`${friendRequests.pendingCount} 个待处理申请`} className="auth-friend-request-badge">{friendRequests.pendingCount > 99 ? "99+" : friendRequests.pendingCount}</b> : null}
            <span className="auth-system-contact-chevron" aria-hidden="true">›</span>
          </button>
          {sections.map((section) => {
            const sectionContacts = contacts.filter((contact) => contact.section === section.id);
            if (!sectionContacts.length) return null;
            return <div key={section.id}><p className="auth-contact-section-label">{section.label}</p>{sectionContacts.map((contact) => <button key={contact.id} type="button" className={`auth-contact-row ${contact.id === activeContactId ? "is-active" : ""}`} onClick={() => { setPage("contacts"); onSelectContact(contact.id); }}><Avatar avatar={contact.avatar} tone={contact.tone} /><span><strong>{contact.name}</strong><small>{contact.status}</small></span></button>)}</div>;
          })}
          {contacts.length === 0 ? <p className="auth-contact-empty-list">好友将在这里出现</p> : null}
        </section>
        {page === "requests" ? (
          <aside className="auth-contact-detail auth-friend-requests-panel" aria-label="好友申请">
            {actionError ? <p role="alert">{actionError}</p> : null}
            {friendRequests.error ? <p role="alert">申请列表加载失败，请重试</p> : null}
            {friendRequests.loading && !(direction === "incoming" ? friendRequests.incoming : friendRequests.outgoing).length ? <p>正在加载申请...</p> : null}
            {(direction === "incoming" ? friendRequests.incoming : friendRequests.outgoing).map((request) => <RequestCard key={request.requestId} request={request} direction={direction} busy={busyRequestId === request.requestId} onRespond={(action) => void respond(request, action)} />)}
            {direction === "incoming" && !currentPageHasIncomingPending && friendRequests.pendingCount > 0 ? <p>当前页没有待处理申请，较早的记录中还有 {friendRequests.pendingCount} 条待处理申请。</p> : null}
            {(direction === "incoming" ? friendRequests.incomingHasMore : friendRequests.outgoingHasMore) ? <button type="button" onClick={() => void friendRequests.loadMore(direction)} disabled={friendRequests.loading}>加载更早记录</button> : null}
            {!friendRequests.loading && !(direction === "incoming" ? friendRequests.incoming : friendRequests.outgoing).length && !(direction === "incoming" && friendRequests.pendingCount > 0) ? <p className="auth-empty-request-state">{direction === "incoming" ? "暂无收到的好友申请。" : "暂无发出的好友申请。"}</p> : null}
          </aside>
        ) : activeContact ? (
          <aside className="auth-contact-detail" aria-label="联系人资料"><Avatar avatar={activeContact.avatar} tone={activeContact.tone} /><h2>{activeContact.name}</h2><p>备注：{activeContact.name}</p><p>账号：{activeContact.account}</p><p>地区：{activeContact.region}</p><p>状态：{activeContact.status}</p><button type="button" onClick={() => onEnterConversation(activeContact)} disabled={!activeContact.conversationId}>发消息</button></aside>
        ) : <aside className="auth-contact-detail auth-empty-contact-state" aria-label="联系人资料"><p>当前没有好友</p></aside>}
      </div>
      {addDialogOpen ? <div className="auth-friend-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddDialogOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="auth-search-title" className="auth-friend-dialog auth-friend-search-dialog">
          <header className="auth-friend-dialog-head"><div><span className="auth-eyebrow">添加好友</span><h2 id="auth-search-title">搜索账号</h2></div><button className="auth-friend-dialog-close" type="button" aria-label="关闭搜索" onClick={() => setAddDialogOpen(false)}>×</button></header>
          <p className="auth-friend-dialog-intro">目前仅支持通过完整账号查找用户。</p>
          <form className="auth-friend-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <label className="auth-friend-field-label" htmlFor="auth-friend-account">对方账号</label>
            <div className="auth-friend-search-line"><input id="auth-friend-account" autoFocus type="search" inputMode="numeric" autoComplete="off" placeholder="例如：00100002" value={account} onChange={(event) => setAccount(event.currentTarget.value)} /><button className="auth-friend-primary" type="submit" disabled={searching}>{searching ? "搜索中..." : "搜索"}</button></div>
          </form>
          <div className="auth-friend-search-results" aria-live="polite"><h3>搜索结果</h3>
            {result ? <div className="auth-friend-profile-card"><Avatar avatar={Array.from(result.nickname.trim() || result.account)[0] ?? "?"} tone="blue" /><div className="auth-friend-profile-copy"><strong>{result.nickname.trim() || result.account}</strong><span>账号 {result.account}</span>{result.signature.trim() ? <p>{result.signature}</p> : null}</div>
              {searchIsSelf ? <button type="button" className="auth-friend-secondary" disabled>发消息</button>
                : existingFriend ? <button type="button" className="auth-friend-secondary" onClick={() => { setAddDialogOpen(false); onEnterConversation(existingFriend); }}>发消息</button>
                  : incomingPending ? <button type="button" className="auth-friend-secondary" onClick={() => { setAddDialogOpen(false); openRequests(); }}>对方向你发来申请</button>
                    : outgoingPending ? <span className="auth-friend-result-status">申请已发送，等待对方处理</span>
                      : <button type="button" className="auth-friend-primary" onClick={() => { setSearchError(""); setAddDialogOpen(false); setVerificationOpen(true); }}>添加好友</button>}
            </div> : <div className={`auth-friend-result-placeholder ${searchError ? "has-error" : ""}`} role={searchError ? "alert" : undefined}>{searchError || "输入账号后点击“搜索”"}</div>}
          </div>
        </section>
      </div> : null}
      {verificationOpen ? <div className="auth-friend-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setVerificationOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="auth-apply-title" className="auth-friend-dialog auth-friend-apply-dialog">
          <header className="auth-friend-dialog-head"><div><span className="auth-eyebrow">新的朋友</span><h2 id="auth-apply-title">申请添加好友</h2></div><button className="auth-friend-dialog-close" type="button" aria-label="关闭申请" onClick={() => setVerificationOpen(false)} disabled={submitting}>×</button></header>
          <div className="auth-friend-apply-target"><div className="auth-friend-profile-card"><Avatar avatar={Array.from(result?.nickname.trim() || result?.account || "?")[0] ?? "?"} tone="blue" /><div className="auth-friend-profile-copy"><strong>{result?.nickname.trim() || result?.account}</strong><span>账号 {result?.account}</span></div></div></div>
          <label className="auth-friend-field-label" htmlFor="auth-friend-verification">验证信息</label>
          <textarea id="auth-friend-verification" className="auth-friend-verification" maxLength={200} rows={4} placeholder="介绍一下自己，让对方知道你是谁" value={verification} onChange={(event) => setVerification(Array.from(event.currentTarget.value).slice(0, 200).join(""))} />
          <p className="auth-friend-field-hint">对方将在好友申请详情中看到这段信息。<span>{Array.from(verification).length}/200</span></p>
          {searchError ? <p role="alert" className="auth-friend-dialog-error">{searchError}</p> : null}
          <div className="auth-friend-dialog-actions"><button className="auth-friend-secondary" type="button" onClick={() => setVerificationOpen(false)} disabled={submitting}>取消</button><button className="auth-friend-primary" type="button" onClick={() => void submitRequest()} disabled={submitting}>{submitting ? "发送中..." : "发送申请"}</button></div>
        </section>
      </div> : null}
    </section>
  );
}

function RequestCard({ request, direction, busy, onRespond }: { request: FriendRequestDto; direction: FriendRequestDirection; busy: boolean; onRespond: (action: "accept" | "reject") => void }) {
  const person = direction === "incoming" ? request.sender : request.recipient;
  const stateText = direction === "outgoing"
    ? request.status === "pending" ? "未处理" : request.status === "accepted" ? "已通过" : "已拒绝"
    : request.status === "pending" ? "待处理" : request.status === "accepted" ? "已同意" : "已拒绝";
  return <article className="auth-request-card">
    <span className="auth-request-state">{stateText}</span>
    <div className="auth-request-profile">
      <Avatar avatar={Array.from(person.nickname.trim() || person.account)[0] ?? "?"} tone="blue" />
      <div className="auth-request-profile-copy"><strong>{person.nickname.trim() || person.account}</strong><span>账号：{person.account}</span></div>
    </div>
    <p className="auth-request-field-label">{direction === "outgoing" ? "我发送的验证信息" : "验证信息"}</p>
    <p className="auth-request-verification">{request.verificationMessage || "未填写验证信息"}</p>
    <small className="auth-request-time">{new Date(request.createdAt).toLocaleString("zh-CN")} · {stateText}</small>
    {direction === "incoming" && request.status === "pending" ? <div className="auth-request-actions"><button className="auth-friend-primary" type="button" disabled={busy} onClick={() => onRespond("accept")}>{busy ? "处理中..." : "同意"}</button><button className="auth-friend-secondary" type="button" disabled={busy} onClick={() => onRespond("reject")}>拒绝</button></div> : null}
  </article>;
}
