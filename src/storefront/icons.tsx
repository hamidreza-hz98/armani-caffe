import type { SVGProps } from "react";

type IconName =
  | "contact"
  | "user"
  | "cart"
  | "close"
  | "phone"
  | "instagram"
  | "telegram"
  | "whatsapp"
  | "map"
  | "arrow";

export function StorefrontIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    contact: (
      <>
        <path d="M4 5h16v11H9l-5 4V5Z" />
        <path d="M8 9h8M8 12h5" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
    cart: (
      <>
        <path d="M3 5h2l2 11h11l2-8H6" />
        <circle cx="9" cy="20" r="1" />
        <circle cx="17" cy="20" r="1" />
      </>
    ),
    close: <path d="m5 5 14 14M19 5 5 19" />,
    phone: (
      <path d="M7 3h3l1 4-2 2a15 15 0 0 0 6 6l2-2 4 1v3a3 3 0 0 1-3 3A15 15 0 0 1 4 6a3 3 0 0 1 3-3Z" />
    ),
    instagram: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r=".6" />
      </>
    ),
    telegram: (
      <>
        <path d="m3 11 18-8-5 18-4-7-5-2-4-1Z" />
        <path d="m7 12 10-6-5 8" />
      </>
    ),
    whatsapp: (
      <>
        <path d="M20 11a8 8 0 0 1-12 7l-4 2 1-5a8 8 0 1 1 15-4Z" />
        <path d="M9 9c1 3 3 5 6 6" />
      </>
    ),
    map: (
      <>
        <path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z" />
        <circle cx="12" cy="9" r="2" />
      </>
    ),
    arrow: <path d="m14 5-7 7 7 7M7 12h14" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
