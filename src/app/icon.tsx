import { ImageResponse } from "next/og";

// App icon (browser tab, Android home screen): "SF" on the brand blue.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2a78d6",
          color: "#ffffff",
          fontSize: 240,
          fontWeight: 700,
          letterSpacing: -8,
          borderRadius: 112,
        }}
      >
        SF
      </div>
    ),
    size,
  );
}
