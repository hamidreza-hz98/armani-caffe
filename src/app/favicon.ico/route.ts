/** Same-origin browser fallback; storefront metadata may point at an owner-selected favicon. */
export function GET() {
  return new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#241b16"/><path d="M16 23h29v14a14 14 0 0 1-14 14h-1a14 14 0 0 1-14-14V23Z" fill="#f7f3ed"/></svg>',
    {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
