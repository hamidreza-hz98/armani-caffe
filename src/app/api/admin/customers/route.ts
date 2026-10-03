import { handleCustomerManagement } from "@/dashboard/customers/http";

export const runtime = "nodejs";
export const GET = (request: Request) => handleCustomerManagement(request, "list");
export const POST = (request: Request) => handleCustomerManagement(request, "create");
