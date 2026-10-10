import type { ReactNode, SVGProps } from "react";

/**
 * The app's icon set: inline SVG, 24-unit grid, 1.5px stroke, round caps —
 * drawn to sit with Lucide. Render at 16px (dense rows, buttons) or 20px
 * (navigation). Every icon is decorative by default (aria-hidden); give the
 * control around it an aria-label instead of labelling the icon.
 *
 *   <IconPlus size={16} />
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function make(name: string, paths: ReactNode) {
  function Icon({ size = 20, strokeWidth = 1.5, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const IconOverview = make("IconOverview", (
  <>
    <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
    <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
  </>
));

export const IconBuilding = make("IconBuilding", (
  <>
    <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
    <path d="M16 9h2a2 2 0 0 1 2 2v10" />
    <path d="M2.5 21h19" />
    <path d="M8 7h4M8 11h4M8 15h4" />
  </>
));

export const IconHome = make("IconHome", (
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    <path d="M10 21v-6h4v6" />
  </>
));

export const IconCalendar = make("IconCalendar", (
  <>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </>
));

export const IconWrench = make("IconWrench", (
  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
));

export const IconMessage = make("IconMessage", (
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
));

export const IconFolder = make("IconFolder", (
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
));

export const IconFile = make("IconFile", (
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </>
));

export const IconUsers = make("IconUsers", (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </>
));

export const IconKey = make("IconKey", (
  <>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" />
  </>
));

export const IconShield = make("IconShield", (
  <>
    <path d="M12 21.5c4.5-1.6 7.5-5 7.5-9.5V5.5L12 2.5 4.5 5.5V12c0 4.5 3 7.9 7.5 9.5z" />
    <path d="m9 12 2 2 4-4" />
  </>
));

export const IconSliders = make("IconSliders", (
  <>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1.5 14h5M9.5 8h5M17.5 16h5" />
  </>
));

/** Settings, in every layout: the one gear that opens the Settings page or menu. */
export const IconSettings = make("IconSettings", (
  <>
    <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </>
));

export const IconArchive = make("IconArchive", (
  <>
    <rect x="2.5" y="3.5" width="19" height="5" rx="1" />
    <path d="M4.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4" />
  </>
));

export const IconDownload = make("IconDownload", (
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
));

export const IconBell = make("IconBell", (
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>
));

export const IconLogOut = make("IconLogOut", (
  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
));

export const IconSearch = make("IconSearch", (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
));

export const IconPlus = make("IconPlus", <path d="M12 5v14M5 12h14" />);
export const IconX = make("IconX", <path d="M18 6 6 18M6 6l12 12" />);
export const IconCheck = make("IconCheck", <path d="M20 6 9 17l-5-5" />);
export const IconChevronLeft = make("IconChevronLeft", <path d="m15 18-6-6 6-6" />);
export const IconChevronRight = make("IconChevronRight", <path d="m9 18 6-6-6-6" />);
export const IconChevronDown = make("IconChevronDown", <path d="m6 9 6 6 6-6" />);
export const IconChevronUpDown = make("IconChevronUpDown", <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />);
export const IconArrowUp = make("IconArrowUp", <path d="M12 19V5M5 12l7-7 7 7" />);
export const IconArrowDown = make("IconArrowDown", <path d="M12 5v14M19 12l-7 7-7-7" />);

export const IconMore = make("IconMore", (
  <>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </>
));

export const IconGrid = make("IconGrid", (
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </>
));

export const IconSidebar = make("IconSidebar", (
  <>
    <rect x="3" y="3.5" width="18" height="17" rx="2" />
    <path d="M9 3.5v17" />
  </>
));

export const IconPencil = make("IconPencil", (
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </>
));

export const IconTrash = make("IconTrash", (
  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
));

export const IconAlert = make("IconAlert", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4.5M12 16h.01" />
  </>
));

export const IconInbox = make("IconInbox", (
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>
));

export const IconReceipt = make("IconReceipt", (
  <>
    <path d="M5 3v18l2.5-1.5L10 21l2-1.5 2 1.5 2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5z" />
    <path d="M9 9h6M9 13h6" />
  </>
));

/** A car: the mileage log (a33). */
export const IconCar = make("IconCar", (
  <>
    <path d="M5 16.5h14" />
    <path d="M6.5 16.5V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.5L6 9h12l2 4.5V18a1 1 0 0 1-1 1h-.5a1 1 0 0 1-1-1v-1.5" />
    <path d="M7.5 9 8.6 6.2A1.5 1.5 0 0 1 10 5.2h4a1.5 1.5 0 0 1 1.4 1L16.5 9" />
    <path d="M7.5 13h1M15.5 13h1" />
  </>
));

/** A line climbing past a baseline: returns, growth (a31). */
export const IconTrend = make("IconTrend", (
  <>
    <path d="M3 20h18" />
    <path d="M4 16l5-5 4 3 7-8" />
    <path d="M15 6h5v5" />
  </>
));

export const IconTable = make("IconTable", (
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M9 10v10" />
  </>
));

export const IconCards = make("IconCards", (
  <>
    <rect x="3" y="4" width="8" height="7" rx="1.5" />
    <rect x="13" y="4" width="8" height="7" rx="1.5" />
    <rect x="3" y="13" width="8" height="7" rx="1.5" />
    <rect x="13" y="13" width="8" height="7" rx="1.5" />
  </>
));

export const IconExternal = make("IconExternal", (
  <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
));

export const IconPhone = make("IconPhone", (
  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
));

export const IconUser = make("IconUser", (
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>
));
