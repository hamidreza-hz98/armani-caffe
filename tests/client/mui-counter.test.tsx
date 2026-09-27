import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { MuiCounter } from "../fixtures/MuiCounter.tsx";

test("MUI client component responds to keyboard and pointer interaction", async () => {
  const user = userEvent.setup();
  render(<MuiCounter />);
  const button = screen.getByRole("button", { name: "افزایش تعداد" });
  expect(screen.getByText("تعداد: 0")).toBeInTheDocument();
  await user.click(button);
  expect(screen.getByText("تعداد: 1")).toBeInTheDocument();
  button.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByText("تعداد: 2")).toBeInTheDocument();
});
