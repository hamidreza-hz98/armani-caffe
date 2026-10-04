import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "#241b16",
        color: "#f7f3ed",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          border: "3px solid #d3a874",
          borderRadius: 32,
          padding: "90px 110px",
        }}
      >
        <span style={{ fontSize: 88, letterSpacing: 8, fontWeight: 700 }}>ARMANI CAFFE</span>
        <span style={{ fontSize: 30, letterSpacing: 5, color: "#d3a874" }}>MENU & COFFEE</span>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
