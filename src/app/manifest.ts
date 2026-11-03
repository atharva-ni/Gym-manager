import type { MetadataRoute } from "next";

/** "Add to home screen" on the front-desk phone or tablet. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SetFit Fitness",
    short_name: "SetFit",
    description: "Gym members, check-ins, fees and staff.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#0f1623",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
