import type { PageId } from "./store";

function Icon({ children }: { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS: Record<PageId, () => JSX.Element> = {
  overview: () => (
    <Icon>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </Icon>
  ),
  topology: () => (
    <Icon>
      <circle cx="3" cy="8" r="1.6" />
      <circle cx="13" cy="3.5" r="1.6" />
      <circle cx="13" cy="12.5" r="1.6" />
      <path d="M4.4 7.2 11.6 4.2M4.4 8.8 11.6 11.8" />
    </Icon>
  ),
  devices: () => (
    <Icon>
      <rect x="5" y="5" width="6" height="6" rx="1" />
      <path d="M8 2.2v2.8M8 11v2.8M2.2 8H5M11 8h2.8" />
      <circle cx="3.2" cy="3.2" r="0.9" />
      <circle cx="12.8" cy="3.2" r="0.9" />
      <circle cx="3.2" cy="12.8" r="0.9" />
      <circle cx="12.8" cy="12.8" r="0.9" />
    </Icon>
  ),
  activity: () => (
    <Icon>
      <path d="M1.5 8h3l1.6-4.4L8.4 12l1.6-4H14.5" />
    </Icon>
  ),
  traffic: () => (
    <Icon>
      <path d="M2 5h9M8.5 2.5 11 5l-2.5 2.5" />
      <path d="M14 11H5M7.5 8.5 5 11l2.5 2.5" />
    </Icon>
  ),
  rules: () => (
    <Icon>
      <path d="M8 1.8 13 3.6v3.6c0 3.4-2.2 5.6-5 7-2.8-1.4-5-3.6-5-7V3.6Z" />
      <path d="m5.8 7.8 1.6 1.6 3-3.2" />
    </Icon>
  ),
  attacks: () => (
    <Icon>
      <circle cx="8" cy="8" r="3.2" />
      <circle cx="8" cy="8" r="0.4" fill="currentColor" />
      <path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15" />
    </Icon>
  ),
  incident: () => (
    <Icon>
      <path d="M8 2.2 14.6 13.6H1.4Z" />
      <path d="M8 6.5v3.3M8 11.9v.1" />
    </Icon>
  ),
  resources: () => (
    <Icon>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.2" />
      <path d="M6.5 1.5v2M9.5 1.5v2M6.5 12.5v2M9.5 12.5v2M1.5 6.5h2M1.5 9.5h2M12.5 6.5h2M12.5 9.5h2" />
    </Icon>
  ),
  experiments: () => (
    <Icon>
      <path d="M6.2 1.8v4.4L2.6 12.4a1.4 1.4 0 0 0 1.2 2.1h8.4a1.4 1.4 0 0 0 1.2-2.1L9.8 6.2V1.8" />
      <path d="M5.2 1.8h5.6M4.6 10.4h6.8" />
    </Icon>
  ),
  compare: () => (
    <Icon>
      <path d="M3 13.5V7.5M8 13.5v-11M13 13.5v-7" />
      <path d="M1.5 13.5h13" />
    </Icon>
  ),
  hardware: () => (
    <Icon>
      <rect x="4" y="4" width="8" height="8" rx="1" />
      <rect x="6.5" y="6.5" width="3" height="3" rx="0.4" />
      <path d="M6 1.5v2.5M10 1.5v2.5M6 12v2.5M10 12v2.5M1.5 6H4M1.5 10H4M12 6h2.5M12 10h2.5" />
    </Icon>
  ),
  registry: () => (
    <Icon>
      <ellipse cx="8" cy="3.6" rx="5" ry="1.9" />
      <path d="M3 3.6v8.8c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V3.6" />
      <path d="M3 8c0 1 2.2 1.9 5 1.9s5-.9 5-1.9" />
    </Icon>
  ),
  docs: () => (
    <Icon>
      <path d="M3 2.2h7.2a1.8 1.8 0 0 1 1.8 1.8v9.8H4.8A1.8 1.8 0 0 1 3 12V2.2Z" />
      <path d="M3 2.2A1.8 1.8 0 0 0 1.2 4v8.4A1.8 1.8 0 0 0 3 14.2M5.5 5.5h4M5.5 8h4" />
    </Icon>
  )
};

export function PageIcon({ id }: { id: PageId }) {
  const Component = ICONS[id];
  return Component ? <Component /> : null;
}
