import { loadCartPageData } from "@/storefront/cart-data";
import { CartPageClient } from "@/storefront/cart-page";

export default async function CartPage() {
  return <CartPageClient {...await loadCartPageData()} />;
}
