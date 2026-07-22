import type { Metadata } from "next";
import { ProfileView } from "@/components/profile/profile-view";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your Combat Reviews profile — identity, reputation, saved clips, predictions and activity.",
  alternates: { canonical: "/profile" },
};

export default function ProfilePage() {
  return <ProfileView />;
}
