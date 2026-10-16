export type ViewerIconName = "previous" | "next" | "zoom-out" | "zoom-in" | "rotate" | "download";

/** Code-native icons keep the titlebar crisp at every Windows display scale. */
export function ViewerIcon({ name }: { name: ViewerIconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    data-viewer-icon={name}>
    {name === "previous" && <path d="m14.5 5-7 7 7 7" />}
    {name === "next" && <path d="m9.5 5 7 7-7 7" />}
    {(name === "zoom-in" || name === "zoom-out") && <>
      <circle cx="9.5" cy="9.5" r="6.5" />
      <path d="m14.2 14.2 6.3 6.3M6.5 9.5h6" />
      {name === "zoom-in" && <path d="M9.5 6.5v6" />}
    </>}
    {name === "rotate" && <>
      <rect x="8" y="10" width="13" height="11" rx="0.5" />
      <path d="M3 10a6 6 0 0 1 6-6h9m-3.5-3L18 4l-3.5 3" />
    </>}
    {name === "download" && <>
      <path d="M12 3v11m-4-4 4 4 4-4" />
      <path d="M5 15v5h14v-5" />
    </>}
  </svg>;
}
