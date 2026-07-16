import type { Metadata } from "next";
import { LibraryView } from "@/components/feed/library-view";

export const metadata: Metadata = {
  title: "Library",
  description: "Your saved fights, Watch Later and collections.",
};

export default function LibraryPage() {
  return <LibraryView />;
}
