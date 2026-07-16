import type { MetadataRoute } from "next";
import { SITE } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    // Withdrawn surfaces are disallowed as well as disabled, so a crawler that
    // still holds an old URL does not keep it alive in results.
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/account",
          "/admin",
          "/rankings",
          "/p4p",
          "/champions",
          "/predictions",
          "/combat-predictions",
        ],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
