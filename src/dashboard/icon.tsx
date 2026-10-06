import type { DashboardLink } from "./navigation";

type Name =
  | DashboardLink["icon"]
  | "menu"
  | "search"
  | "bell"
  | "logout"
  | "close"
  | "chevron"
  | "grip"
  | "arrowUp"
  | "arrowDown"
  | "store"
  | "phone"
  | "printer"
  | "creditCard";
const paths: Record<Name, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h4",
  coffee: "M4 7h13v7a6.5 6.5 0 0 1-13 0z M17 8h2a3 3 0 0 1 0 6h-2 M3 20h16",
  category: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  inventory: "M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10",
  media: "M4 4h16v16H4z M7 16l4-4 3 3 2-2 3 3 M8 8h.01",
  customers:
    "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M18 14a4 4 0 0 1 4 4v2 M17 4a3 3 0 0 1 0 6",
  admins: "M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z M9 11a3 3 0 1 1 6 0 M7 18a5 5 0 0 1 10 0",
  settings:
    "M12 2v3 M12 19v3 M4.9 4.9L7 7 M17 17l2.1 2.1 M2 12h3 M19 12h3 M4.9 19.1L7 17 M17 7l2.1-2.1 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M17 17l5 5",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  logout: "M9 4H4v16h5 M14 8l4 4-4 4 M8 12h10",
  close: "M5 5l14 14 M19 5L5 19",
  chevron: "M9 5l6 7-6 7",
  grip: "M9 5h.01 M15 5h.01 M9 12h.01 M15 12h.01 M9 19h.01 M15 19h.01",
  arrowUp: "M12 19V5 M6 11l6-6 6 6",
  arrowDown: "M12 5v14 M18 13l-6 6-6-6",
  store: "M3 10h18l-2-6H5z M5 10v10h14V10 M9 20v-6h6v6 M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0",
  phone: "M5 3h14v18H5z M9 7h6 M10 17h4",
  printer: "M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v7H6z M18 12h.01",
  creditCard: "M3 5h18v14H3z M3 10h18 M7 15h4",
};

export function DashboardIcon({ name }: { name: Name }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
