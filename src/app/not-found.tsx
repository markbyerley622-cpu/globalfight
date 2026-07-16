import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-cr flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="font-display text-8xl font-black text-blood-500">404</span>
      <h1 className="mt-2 font-display text-3xl font-bold uppercase text-chalk">Down for the count</h1>
      <p className="mt-2 max-w-md text-sm text-mist">
        This page didn&apos;t make the weigh-in. It may have moved, or never existed.
      </p>
      <div className="mt-6 flex gap-3">
        <ButtonLink href="/">Back to Home</ButtonLink>
        <ButtonLink href="/rankings" variant="outline">View Rankings</ButtonLink>
      </div>
    </div>
  );
}
