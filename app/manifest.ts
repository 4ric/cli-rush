import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CLI RUSH: Network Command Arena",
    short_name: "CLI RUSH",
    description: "A local-first Cisco IOS XE command-recall simulator.",
    id: "/",
    start_url: "/",
    scope: "/",
    lang: "en-GB",
    categories: ["education"],
    display: "standalone",
    background_color: "#090b18",
    theme_color: "#090b18",
    orientation: "any",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
