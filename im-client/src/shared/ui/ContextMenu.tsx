import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./contextMenu.css";

export interface ContextMenuItem { label: string; onSelect: () => void; disabled?: boolean }
interface ContextMenuProps {
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
  ariaLabel?: string;
  portalRoot?: HTMLElement;
}

export function ContextMenu({ position, items, onClose, ariaLabel = "操作菜单", portalRoot = document.body }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [location, setLocation] = useState(position);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setLocation({ x: Math.max(4, Math.min(position.x, window.innerWidth - bounds.width - 4)),
      y: Math.max(4, Math.min(position.y, window.innerHeight - bounds.height - 4)) });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [position.x, position.y]);
  useEffect(() => {
    const outside = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) onCloseRef.current(); };
    const close = () => onCloseRef.current();
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return createPortal(<div ref={menuRef} role="menu" aria-label={ariaLabel} className="whisper-context-menu"
    style={{ left: location.x, top: location.y }} onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Tab") { event.preventDefault(); onCloseRef.current(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
      onClick={() => { onCloseRef.current(); item.onSelect(); }}>{item.label}</button>)}
  </div>, portalRoot);
}
