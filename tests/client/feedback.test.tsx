import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { FeedbackProvider, useFeedback } from "@/theme/feedback-provider";

function Fixture() {
  const feedback = useFeedback();
  return (
    <>
      <button onClick={() => feedback.notify({ message: "ذخیره شد", severity: "success" })}>
        اعلان
      </button>
      <button
        onClick={() =>
          void feedback.confirm({
            title: "حذف شود؟",
            description: "این کار قابل بازگشت نیست.",
            confirmLabel: "حذف",
            dangerous: true,
          })
        }
      >
        تأیید
      </button>
    </>
  );
}

test("snackbar and confirmation dialog are interactive in Persian", async () => {
  const user = userEvent.setup();
  render(
    <FeedbackProvider>
      <Fixture />
    </FeedbackProvider>,
  );
  await user.click(screen.getByRole("button", { name: "اعلان" }));
  expect(screen.getByText("ذخیره شد")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "تأیید" }));
  expect(screen.getByRole("dialog", { name: "حذف شود؟" }).closest("[dir='rtl']")).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "انصراف" }));
  await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
});
