import { redirect } from "next/navigation";

/**
 * The product opens directly into event discovery for a default sport. There is
 * no separate top-level "home" that fractures the journey — discovery IS home.
 */
export default function Home() {
  redirect("/sports/mma");
}
