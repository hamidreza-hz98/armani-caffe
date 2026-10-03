import { handleCustomerManagement } from "@/dashboard/customers/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) =>
  handleCustomerManagement(request, "detail", (await context.params).id);
export const PATCH = async (request: Request, context: Context) =>
  handleCustomerManagement(request, "update", (await context.params).id);
export const DELETE = async (request: Request, context: Context) =>
  handleCustomerManagement(request, "anonymize", (await context.params).id);
