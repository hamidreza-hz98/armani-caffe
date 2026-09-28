import { handleCustomerHttp } from "@/modules/auth/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ operation: string }> };
async function handle(request: Request, context: Context) {
  const { operation } = await context.params;
  if (!["signup", "login", "session", "rotate", "logout"].includes(operation))
    return Response.json(
      { error: { code: "NOT_FOUND", message: "مورد درخواستی پیدا نشد." } },
      { status: 404 },
    );
  return handleCustomerHttp(
    request,
    operation as "signup" | "login" | "session" | "rotate" | "logout",
  );
}
export const GET = handle;
export const POST = handle;
