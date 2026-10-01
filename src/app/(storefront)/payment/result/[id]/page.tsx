import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { createSettingsService } from "@/modules/settings/server";
import { customerPaymentResult, customerTokenFromCookies } from "@/server/commerce/payment-results";
import { ApplicationError } from "@/shared/errors";
import { contactLinks } from "@/storefront/contact-links";
import { AccountActions } from "@/storefront/customer-account-control";
import { PaymentResultView } from "@/storefront/payment-view";

export default async function PaymentResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/u.test(id)) notFound();
  const token = customerTokenFromCookies(await cookies());
  if (!token)
    return (
      <section style={{ maxWidth: 520, margin: "24px auto", padding: 24, textAlign: "center" }}>
        <h1>برای مشاهده نتیجه وارد شوید</h1>
        <p>جزئیات پرداخت فقط برای صاحب سفارش نمایش داده می‌شود.</p>
        <AccountActions customer={false} />
      </section>
    );
  let result;
  try {
    result = await customerPaymentResult(token, id);
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      ["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(error.code)
    )
      notFound();
    throw error;
  }
  const supportHref = await createSettingsService()
    .then(async (service) => {
      const settings = await service.publicSettings();
      return contactLinks(settings.contact).find((link) => link.kind === "phone")?.href ?? null;
    })
    .catch(() => null);
  return <PaymentResultView result={result} supportHref={supportHref} />;
}
