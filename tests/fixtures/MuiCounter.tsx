"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";

export function MuiCounter() {
  const [count, setCount] = useState(0);
  return (
    <Stack>
      <Typography aria-live="polite">تعداد: {count}</Typography>
      <Button onClick={() => setCount((value) => value + 1)} variant="contained">
        افزایش تعداد
      </Button>
    </Stack>
  );
}
