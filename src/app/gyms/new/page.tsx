import type { Metadata } from "next";
import { GymCreateForm } from "@/components/map/gym-create-form";

export const metadata: Metadata = {
  title: "Add a gym",
  description: "Add the gym you train at to Combat Reviews.",
  alternates: { canonical: "/gyms/new" },
};

export default function NewGymPage() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-6">
      <p className="eyebrow">Put it on the map</p>
      <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk">Add a gym</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-fog">
        Anyone can add a gym — it appears on the map for everyone nearby. Adding it does not make you the owner:
        the page stays unverified until someone from the gym claims it and we check.
      </p>
      <GymCreateForm />
    </div>
  );
}
