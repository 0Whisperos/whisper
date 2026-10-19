import { lazy, Suspense, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { IconButton } from "./ui";
const EmojiPickerPanel = lazy(() => import("./EmojiPickerPanel"));

interface EmojiPickerPopoverProps {
  disabled?: boolean;
  onSelectEmoji: (emoji: string) => void;
}

export function EmojiPickerPopover({ disabled = false, onSelectEmoji }: EmojiPickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const handlePanelKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.eprPart !== "search-input" || event.key !== "ArrowDown") return;
    const firstResult = containerRef.current?.querySelector<HTMLButtonElement>(
      '[role="gridcell"][data-epr-part="emoji"].epr-visible',
    );
    if (!firstResult) return;
    event.preventDefault();
    event.stopPropagation();
    firstResult.focus();
  };

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      containerRef.current?.querySelector<HTMLButtonElement>(".auth-emoji-picker-trigger")?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="auth-emoji-picker-anchor">
      <IconButton
        className="auth-emoji-picker-trigger"
        icon="smile"
        label="表情"
        active={isOpen}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      />
      {isOpen ? (
        <div id={panelId} className="auth-emoji-picker-popover" role="dialog" aria-label="选择表情" onKeyDownCapture={handlePanelKeyDownCapture}>
          <Suspense fallback={<div className="auth-emoji-picker-loading" role="status">正在加载表情</div>}>
            <EmojiPickerPanel onSelectEmoji={(emoji) => {
              onSelectEmoji(emoji);
              setIsOpen(false);
              if (containerRef.current?.contains(document.activeElement)) {
                containerRef.current.querySelector<HTMLButtonElement>(".auth-emoji-picker-trigger")?.focus();
              }
            }} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
