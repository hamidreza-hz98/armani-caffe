import type { Metadata } from "next";

import type { MenuCategory } from "@/modules/catalog/products";
import { menuCards } from "@/storefront/menu-model";
import { MenuView } from "@/storefront/menu-view";
import { StorefrontShell } from "@/storefront/storefront-shell";

export const metadata: Metadata = {
  title: "پیش‌نمایش منو",
  robots: { index: false, follow: false },
};

const categoryNames = ["قهوه گرم", "قهوه سرد", "چای و دمنوش"];
const productNames = [
  "اسپرسو دوبل",
  "آمریکانو",
  "لاته",
  "آیس کارامل ماکیاتو",
  "چای ماسالا",
  "چیزکیک سن‌سباستین",
];
const categories: MenuCategory[] = categoryNames.map((name, group) => ({
  id: `${group + 1}`.padStart(24, "0"),
  name,
  sortOrder: group,
  products: productNames.map((productName, index) => ({
    id: `${group * 6 + index + 11}`.padStart(24, "0"),
    name: productName,
    slug: `preview-${group}-${index}`,
    excerpt: "تهیه‌شده با مواد تازه و عطر دلپذیر",
    ingredients: "",
    basePriceToman: 95000 + index * 15000,
    mediaIds: [],
    orderable: !(group === 2 && index === 5),
    soldCount: 0,
    additions:
      index === 1
        ? [
            {
              id: "1".padStart(24, "0"),
              name: "شات اضافه",
              priceToman: 30000,
              available: true,
              mediaId: null,
              sortOrder: 0,
            },
          ]
        : [],
  })),
}));

export default function MenuPreview() {
  return (
    <StorefrontShell
      data={{
        businessName: "کافه آرمانی",
        account: { state: "guest", name: null },
        cartCount: 0,
        contacts: [],
        contactAddress: "",
        settingsAvailable: true,
      }}
    >
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6f6259" }}>
        پیش‌نمایش دادهٔ نمونه؛ منوی واقعی نیست.
      </p>
      <MenuView categories={menuCards(categories)} />
    </StorefrontShell>
  );
}
