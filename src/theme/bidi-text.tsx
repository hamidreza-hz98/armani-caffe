import type { ReactNode } from "react";

export function LtrText({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" style={{ unicodeBidi: "isolate" }}>
      {children}
    </bdi>
  );
}
