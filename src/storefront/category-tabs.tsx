"use client";

import { useEffect, useState } from "react";

import styles from "./menu.module.css";
import { categoryAnchor } from "./menu-model";

export function CategoryTabs({
  categories,
}: {
  categories: readonly { id: string; name: string }[];
}) {
  const [active, setActive] = useState(categories[0]?.id ?? "");
  useEffect(() => {
    if (!categories.length) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let current = categories[0].id;
        for (const category of categories) {
          const section = document.getElementById(categoryAnchor(category.id));
          if (section && section.getBoundingClientRect().top <= 160) current = category.id;
        }
        setActive(current);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [categories]);
  return (
    <nav className={styles.tabs} aria-label="دسته‌بندی‌های منو">
      <div className={styles.tabsScroller}>
        {categories.map((category) => (
          <a
            key={category.id}
            href={`#${categoryAnchor(category.id)}`}
            className={active === category.id ? styles.tabActive : styles.tab}
            aria-current={active === category.id ? "location" : undefined}
            onClick={(event) => {
              const target = document.getElementById(categoryAnchor(category.id));
              if (!target) return;
              event.preventDefault();
              history.replaceState(null, "", `#${categoryAnchor(category.id)}`);
              target.scrollIntoView({
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
                block: "start",
              });
              setActive(category.id);
            }}
          >
            {category.name}
          </a>
        ))}
      </div>
    </nav>
  );
}
