import type { MetadataRoute } from "next";
import { SITE, isCanonicalHost } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  // A preview or staging deployment must not be indexed as though it were the
  // product. Render gives every service a *.onrender.com slug and the app is
  // reachable there whether or not it is the address we publish; indexing it
  // splits every ranking signal across two hosts and leaves the temporary one
  // alive in results after it stops being served.
  //
  // Belt and braces with the metadata `robots` directive in layout.tsx: robots
  // .txt stops the crawl, the header stops anything already crawled.
  if (!isCanonicalHost()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

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
