"use client";

import { useCallback, useEffect, useRef } from "react";

import { useFeedback } from "./feedback-provider";

/** Guards browser close and same-origin link navigation, while restoring focus through MUI Dialog. */
export function useUnsavedChanges(dirty: boolean, message = "تغییرات ذخیره‌نشده از دست می‌روند.") {
  const feedback = useFeedback();
  const bypass = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey
      )
        return;
      const link =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.href === window.location.href) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      event.preventDefault();
      void feedback
        .confirm({
          title: "تغییرات ذخیره‌نشده",
          description: message,
          confirmLabel: "خروج بدون ذخیره",
          dangerous: true,
        })
        .then((accepted) => {
          if (accepted) window.location.assign(destination.href);
        });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, feedback, message]);
  return useCallback(() => {
    bypass.current = true;
  }, []);
}
