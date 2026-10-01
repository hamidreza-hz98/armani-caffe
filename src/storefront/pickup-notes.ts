export type PickupChoice = "asap" | "30" | "60";

const prefix = "تحویل حضوری: ";
const choices: Record<PickupChoice, string> = {
  asap: "در اولین فرصت",
  "30": "حدود ۳۰ دقیقه پس از ثبت سفارش",
  "60": "حدود ۶۰ دقیقه پس از ثبت سفارش",
};

/** Order notes are the existing server-owned checkout snapshot; these are requests, not bookings. */
export function composePickupNotes(choice: PickupChoice, customerNote: string): string {
  const note = customerNote.trim().normalize("NFC");
  return `${prefix}${choices[choice]}${note ? `\nتوضیحات سفارش: ${note}` : ""}`;
}

export function parsePickupNotes(notes: string): { choice: PickupChoice; customerNote: string } {
  for (const choice of Object.keys(choices) as PickupChoice[]) {
    const heading = `${prefix}${choices[choice]}`;
    if (notes === heading) return { choice, customerNote: "" };
    if (notes.startsWith(`${heading}\nتوضیحات سفارش: `))
      return { choice, customerNote: notes.slice(`${heading}\nتوضیحات سفارش: `.length) };
  }
  return { choice: "asap", customerNote: notes };
}

export function checkoutIdempotencyKey(cartId: string, revision: number): string {
  if (!/^[a-f\d]{24}$/u.test(cartId) || !Number.isSafeInteger(revision) || revision < 0)
    throw new RangeError("Invalid cart identity");
  return `cart_${cartId}_${revision}`;
}
