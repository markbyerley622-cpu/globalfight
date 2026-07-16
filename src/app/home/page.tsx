import { HomeExperience } from "@/components/home/home-experience";

export const dynamic = "force-dynamic"; // reads the database at runtime

export default function HomePage() {
  return <HomeExperience />;
}
