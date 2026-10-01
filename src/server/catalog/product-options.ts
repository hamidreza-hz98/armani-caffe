import "server-only";

import { ApplicationError, errorStatus } from "../../shared/errors.ts";
import { productOptions, quoteProduct } from "../../storefront/product-quote.ts";
import { runSafeAction } from "../actions.ts";
import { readJsonBody } from "../http/json.ts";
import { requestIdFromHeader } from "../observability/index.ts";
import { getServerConfig } from "../secrets/config.ts";
import { configuredProductService } from "./products.ts";

export async function handleProductOptions(
  request: Request,
  id: string,
  mode: "options" | "quote",
) {
  const requestId = requestIdFromHeader(request.headers.get("x-request-id"));
  const result = await runSafeAction(
    `product.${mode}`,
    async () => {
      if (new URL(request.url).search)
        throw new ApplicationError("VALIDATION", "Invalid options URL");
      if (!/^[a-f\d]{24}$/.test(id)) throw new ApplicationError("VALIDATION", "Invalid product ID");
      if (mode === "quote") {
        const origin = new URL(getServerConfig().appUrl).origin;
        if (request.headers.get("origin") !== origin)
          throw new ApplicationError("FORBIDDEN", "Invalid quote origin");
      }
      const categories = await (await configuredProductService()).menu();
      const product = categories
        .flatMap((category) => category.products)
        .find((item) => item.id === id);
      if (!product) throw new ApplicationError("NOT_FOUND", "Product not found");
      return mode === "options"
        ? productOptions(product)
        : quoteProduct(product, await readJsonBody(request, 2048));
    },
    requestId,
  );
  return Response.json(result, {
    status: result.ok ? 200 : errorStatus(result.error.code),
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
    },
  });
}
