import type { ChatContact, ChatContactSection } from "../types";
import { Avatar, Icon, IconButton } from "./ui";

interface ContactsPanelProps {
  hidden: boolean;
  contacts: ChatContact[];
  sections: ChatContactSection[];
  activeContact: ChatContact;
  activeContactId: string;
  statusMessage: string;
  onSelectContact: (contactId: string) => void;
  onEnterConversation: (contact: ChatContact) => void;
  onReturnToContacts: () => void;
  onToolPreview: (name: string) => void;
}

export function ContactsPanel({
  hidden,
  contacts,
  sections,
  activeContact,
  activeContactId,
  statusMessage,
  onSelectContact,
  onEnterConversation,
  onReturnToContacts,
  onToolPreview,
}: ContactsPanelProps) {
  return (
    <section className="auth-contacts-panel" aria-label="好友" hidden={hidden}>
      <header className="auth-contacts-head">
        <div>
          <p className="auth-eyebrow">通讯录</p>
          <h1>好友</h1>
        </div>
        <output className="auth-panel-status" aria-live="polite">{statusMessage}</output>
        <IconButton icon="plus" label="添加好友" onClick={() => onToolPreview("新的朋友")} />
        <IconButton icon="back" label="返回联系人" className="auth-contact-back" onClick={onReturnToContacts} />
      </header>
      <div className="auth-contacts-layout">
        <section className="auth-contact-list" aria-label="联系人列表">
          {["新的朋友", "群聊"].map((name) => (
            <button key={name} type="button" className="auth-system-contact" onClick={() => onToolPreview(name)}>
              <Icon name="plus" />
              <span>{name}</span>
            </button>
          ))}
          {sections.map((section) => {
            const sectionContacts = contacts.filter((contact) => contact.section === section.id);
            if (sectionContacts.length === 0) {
              return null;
            }
            return (
              <div key={section.id}>
                <p className="auth-contact-section-label">{section.label}</p>
                {sectionContacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    className={`auth-contact-row ${contact.id === activeContactId ? "is-active" : ""}`}
                    onClick={() => onSelectContact(contact.id)}
                  >
                    <Avatar avatar={contact.avatar} tone={contact.tone} />
                    <span>
                      <strong>{contact.name}</strong>
                      <small>{contact.status}</small>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </section>
        <aside className="auth-contact-detail" aria-label="联系人资料">
          <Avatar avatar={activeContact.avatar} tone={activeContact.tone} />
          <h2>{activeContact.name}</h2>
          <p>备注：{activeContact.name}</p>
          <p>账号：{activeContact.account}</p>
          <p>地区：{activeContact.region}</p>
          <p>状态：{activeContact.status}</p>
          <button type="button" onClick={() => onEnterConversation(activeContact)} disabled={!activeContact.conversationId}>
            发消息
          </button>
        </aside>
      </div>
    </section>
  );
}
