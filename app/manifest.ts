import type { MetadataRoute } from "next";

// Web app manifest — makes StayHQ installable as an app on phones
// (Add to Home Screen opens it standalone, without the browser chrome)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StayHQ — Property Management",
    short_name: "StayHQ",
    description:
      "Manage your short-term rentals: bookings, guest messages, AI replies, cleaning and finance.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
