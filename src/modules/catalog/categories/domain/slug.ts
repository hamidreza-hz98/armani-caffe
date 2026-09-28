const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

/** Stable URL slug; Persian letters remain readable and digits are ASCII. */
export function categorySlugBase(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹٠-٩]/g, (digit) => {
      const persian = persianDigits.indexOf(digit);
      return String(persian >= 0 ? persian : arabicDigits.indexOf(digit));
    })
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
    .toLocaleLowerCase("fa-IR")
    .replace(/[^\p{Script=Arabic}a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/g, "");
}
