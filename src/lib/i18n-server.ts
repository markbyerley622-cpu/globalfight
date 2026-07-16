import "server-only";

// Server-side i18n: reads the `locale` cookie in Server Components so cards are
// rendered in the chosen language at SSR (not just client UI after hydration).
//
//   const t = await getServerT();
//   <h2>{t("Divisions")}</h2>
import { cookies } from "next/headers";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/config";
import { translate } from "@/lib/i18n-dict";

export async function getLocale(): Promise<Locale> {
  const code = (await cookies()).get("locale")?.value;
  return LOCALES.some((l) => l.code === code) ? (code as Locale) : DEFAULT_LOCALE;
}

/** Returns a synchronous translate fn bound to the request's locale. */
export async function getServerT(): Promise<(key: string) => string> {
  const locale = await getLocale();
  return (key: string) => translate(locale, key);
}
