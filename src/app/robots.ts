import type { MetadataRoute } from "next";
import { SITE, isCanonicalHost } from "@/lib/config";
import { flags } from "@/lib/feature-flags";

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

  // The ranking surfaces are disallowed only while they are actually withdrawn.
  //
  // These three were unconditionally disallowed, which was correct when the
  // routes returned "Rankings are not available" — a crawler holding an old URL
  // should not keep an empty page alive in results. But it is a trap the moment
  // RANKINGS_ENABLED is turned on: the routes would start serving real content
  // that robots.txt still forbids anyone to crawl, so the rankings would be
  // invisible in search with nothing in the app to indicate why.
  //
  // Tying it to the same flag that decides whether the routes serve at all means
  // the two can never disagree.
  const rankingRoutes = flags().rankingsEnabled ? [] : ["/rankings", "/p4p", "/champions"];

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
          ...rankingRoutes,
          "/predictions",
          "/combat-predictions",
        ],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
