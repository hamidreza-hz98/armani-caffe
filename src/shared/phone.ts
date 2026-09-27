const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

export function normalizeIranianMobile(input: string): string {
  const ascii = input.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = persianDigits.indexOf(digit);
    return String(persian >= 0 ? persian : arabicDigits.indexOf(digit));
  });
  const compact = ascii.replace(/[\s()-]/g, "");
  const national = compact.startsWith("0098")
    ? compact.slice(4)
    : compact.startsWith("+98")
      ? compact.slice(3)
      : compact.startsWith("98")
        ? compact.slice(2)
        : compact.startsWith("0")
          ? compact.slice(1)
          : compact;
  if (!/^9\d{9}$/.test(national)) {
    throw new Error("Phone must be a valid Iranian mobile number");
  }
  return `+98${national}`;
}
