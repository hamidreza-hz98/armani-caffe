"use client";

import { Button, Drawer, IconButton } from "@mui/material";
import { useState } from "react";

import type { ContactLink } from "./contact-links";
import { StorefrontIcon } from "./icons";
import styles from "./storefront.module.css";

export function ContactSheet({
  links,
  address,
}: {
  links: readonly ContactLink[];
  address: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        className={styles.contactTrigger}
        variant="outlined"
        onClick={() => setOpen(true)}
        startIcon={<StorefrontIcon name="contact" />}
        aria-label="ارتباط با ما"
      >
        ارتباط با ما
      </Button>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => setOpen(false)}
        ModalProps={{ keepMounted: true }}
        slotProps={{
          paper: {
            className: styles.sheetPaper,
            role: "dialog",
            "aria-labelledby": "contact-title",
          },
        }}
      >
        <div className={styles.sheetHandle} aria-hidden="true" />
        <div className={styles.sheetHeading}>
          <div>
            <h2 id="contact-title">ارتباط با کافه آرمانی</h2>
            <p>راه‌های ارتباط و مسیریابی</p>
          </div>
          <IconButton
            onClick={() => setOpen(false)}
            aria-label="بستن پنجره ارتباط"
            className={styles.sheetClose}
          >
            <StorefrontIcon name="close" />
          </IconButton>
        </div>
        <div className={styles.sheetContent}>
          {links.length ? (
            <ul className={styles.contactList}>
              {links.map((link) => (
                <li key={link.kind}>
                  <a
                    href={link.href}
                    target={link.kind === "phone" ? undefined : "_blank"}
                    rel={link.kind === "phone" ? undefined : "noopener noreferrer"}
                    dir="rtl"
                    aria-label={`${link.label}، ${link.detail}`}
                  >
                    <span className={styles.contactIcon}>
                      <StorefrontIcon name={link.kind} />
                    </span>
                    <span className={styles.contactText}>
                      <strong>{link.label}</strong>
                      <small dir={link.kind === "map" ? "rtl" : "ltr"}>{link.detail}</small>
                    </span>
                    <StorefrontIcon name="arrow" className={styles.contactArrow} />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyContacts} role="status">
              راه ارتباطی فعلاً ثبت نشده است. لطفاً کمی بعد دوباره تلاش کنید.
            </p>
          )}
          {address && !links.some((link) => link.kind === "map") && (
            <p className={styles.address}>{address}</p>
          )}
        </div>
        <Button className={styles.sheetDismiss} variant="contained" onClick={() => setOpen(false)}>
          بستن پنجره
        </Button>
      </Drawer>
    </>
  );
}
