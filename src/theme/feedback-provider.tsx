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
  TextField,
} from "@mui/material";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Notice = { message: string; severity: "success" | "info" | "warning" | "error" };
type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  dangerous: boolean;
  requiredText?: string;
};
type TextRequest = {
  title: string;
  description: string;
  label: string;
  submitLabel: string;
  maxLength?: number;
};
type Feedback = {
  notify(notice: Notice): void;
  confirm(options: Confirmation): Promise<boolean>;
  requestText(options: TextRequest): Promise<string | null>;
};

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [textRequest, setTextRequest] = useState<TextRequest | null>(null);
  const [requestedText, setRequestedText] = useState("");
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const pendingText = useRef<((value: string | null) => void) | null>(null);

  useEffect(
    () => () => {
      pending.current?.(false);
      pendingText.current?.(null);
    },
    [],
  );
  const notify = useCallback((next: Notice) => setNotice(next), []);
  const confirm = useCallback((options: Confirmation) => {
    pending.current?.(false);
    setConfirmation(options);
    setConfirmationText("");
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
    });
  }, []);
  const requestText = useCallback((options: TextRequest) => {
    pendingText.current?.(null);
    setRequestedText("");
    setTextRequest(options);
    return new Promise<string | null>((resolve) => {
      pendingText.current = resolve;
    });
  }, []);
  const finish = (accepted: boolean) => {
    pending.current?.(accepted);
    pending.current = null;
    setConfirmation(null);
  };
  const finishText = (value: string | null) => {
    pendingText.current?.(value);
    pendingText.current = null;
    setTextRequest(null);
  };

  return (
    <FeedbackContext.Provider value={{ notify, confirm, requestText }}>
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
          {confirmation?.requiredText ? (
            <TextField
              autoFocus
              fullWidth
              sx={{ mt: 2 }}
              label={`برای تأیید، «${confirmation.requiredText}» را بنویسید`}
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              autoComplete="off"
              slotProps={{ htmlInput: { dir: "rtl" } }}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => finish(false)}>انصراف</Button>
          <Button
            variant="contained"
            color={confirmation?.dangerous ? "error" : "primary"}
            disabled={
              confirmation?.requiredText !== undefined &&
              confirmationText.trim() !== confirmation.requiredText
            }
            onClick={() => finish(true)}
          >
            {confirmation?.confirmLabel ?? "تأیید"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={textRequest !== null}
        onClose={() => finishText(null)}
        aria-labelledby="text-request-title"
        aria-describedby="text-request-description"
        dir="rtl"
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id="text-request-title">{textRequest?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText id="text-request-description">
            {textRequest?.description}
          </DialogContentText>
          <TextField
            autoFocus
            required
            fullWidth
            sx={{ mt: 2 }}
            label={textRequest?.label}
            value={requestedText}
            onChange={(event) => setRequestedText(event.target.value)}
            slotProps={{ htmlInput: { maxLength: textRequest?.maxLength ?? 300 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => finishText(null)}>انصراف</Button>
          <Button
            variant="contained"
            disabled={!requestedText.trim()}
            onClick={() => finishText(requestedText.trim())}
          >
            {textRequest?.submitLabel ?? "ثبت"}
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
