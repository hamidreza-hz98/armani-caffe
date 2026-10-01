import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { customerOrderDetail, customerTokenFromCookies } from "@/server/commerce/payment-results";
import { ApplicationError } from "@/shared/errors";
import { AccountActions } from "@/storefront/customer-account-control";
import { CustomerOrderView } from "@/storefront/payment-view";

export default async function CustomerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/u.test(id)) notFound();
  const token = customerTokenFromCookies(await cookies());
  if (!token)
    return (
      <section style={{ maxWidth: 520, margin: "24px auto", padding: 24, textAlign: "center" }}>
        <h1>برای مشاهده سفارش وارد شوید</h1>
        <p>جزئیات سفارش فقط برای صاحب آن نمایش داده می‌شود.</p>
        <AccountActions customer={false} />
      </section>
    );
  let order;
  try {
    order = await customerOrderDetail(token, id);
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      ["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(error.code)
    )
      notFound();
    throw error;
  }
  return <CustomerOrderView order={order} />;
}
