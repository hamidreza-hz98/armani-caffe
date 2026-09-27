"use client";

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
} from "@mui/material";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Notice = { message: string; severity: "success" | "info" | "warning" | "error" };
type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  dangerous: boolean;
};
type Feedback = {
  notify(notice: Notice): void;
  confirm(options: Confirmation): Promise<boolean>;
};

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);

  useEffect(() => () => pending.current?.(false), []);
  const notify = useCallback((next: Notice) => setNotice(next), []);
  const confirm = useCallback((options: Confirmation) => {
    pending.current?.(false);
    setConfirmation(options);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
    });
  }, []);
  const finish = (accepted: boolean) => {
    pending.current?.(accepted);
    pending.current = null;
    setConfirmation(null);
  };

  return (
    <FeedbackContext.Provider value={{ notify, confirm }}>
      {children}
      <Snackbar
        open={notice !== null}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {notice ? (
          <Alert severity={notice.severity} onClose={() => setNotice(null)} variant="filled">
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
      <Dialog
        open={confirmation !== null}
        onClose={() => finish(false)}
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-description"
        dir="rtl"
      >
        <DialogTitle id="confirmation-title">{confirmation?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText id="confirmation-description">
            {confirmation?.description}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => finish(false)}>انصراف</Button>
          <Button
            variant="contained"
            color={confirmation?.dangerous ? "error" : "primary"}
            onClick={() => finish(true)}
          >
            {confirmation?.confirmLabel ?? "تأیید"}
          </Button>
        </DialogActions>
      </Dialog>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback must be used within FeedbackProvider");
  return value;
}
