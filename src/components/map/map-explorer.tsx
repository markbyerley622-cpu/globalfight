"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Plus, Minus, LocateFixed, Globe2, X, Loader2, MapPinOff, Layers, ChevronLeft,
  Flame, Lock,
} from "lucide-react";
import { distanceKm as haversine } from "@/lib/geo/gazetteer";
import { MAP_LAYERS, type MapData, type MapLayer, type MapPin } from "@/lib/geo/types";
import { useCoarseNow } from "@/lib/use-countdown";
import { groupPins, byRelevance, describeGroup } from "./group-pins";
import { PinDetail, PinRow } from "./pin-card";
import { EventMapPreview } from "./event-map-preview";
import { FloatingPreview, type Anchor, type PreviewHandle } from "./floating-preview";
import { BottomSheet, type Detent } from "./bottom-sheet";
import { LAYER_COLOR, type MapApi, type MapFocus } from "./map-canvas";
import { Chip, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// Leaflet reads `window` at module scope, so the canvas can only ever be loaded
// in the browser. A Server Component can't declare `ssr: false`, which is why
// this boundary — not the page — owns the dynamic import.
const MapCanvas = dynamic(() => import("./map-canvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-ink-900">
      <Loader2 className="size-5 animate-spin text-fog" />
    </div>
  ),
});

type Filter = "all" | MapLayer;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  ...MAP_LAYERS.map((l) => ({ id: l.id as Filter, label: l.label })),
];

/** Discovery sections in the sheet. Each is a lens on the same pin set — no
 *  section fetches anything, so switching is instant and always consistent. */
type Section = "nearby" | "live" | "trending";

const SECTIONS: { id: Section; label: string; icon?: typeof Flame }[] = [
  { id: "nearby", label: "Nearby", icon: LocateFixed },
  { id: "live", label: "Live now", icon: Flame },
  // Trending carries NO icon — the word says it, and the sparkle read as
  // decoration beside chips whose icons actually mean something. The property
  // is omitted rather than set to null so the notification-icon guard test,
  // which scans for `icon:` keys, does not read the label as an icon name.
  { id: "trending", label: "Trending" },
];

/**
 * How often an OPEN map re-reads the world.
 *
 * A minute, not a second. Everything that moves faster than this — the
 * countdown digits, the fight-week and live bands — is derived from the
 * client's own clock and never waits for a request. What this actually carries
 * is the slow stuff: an event published, a card cancelled, a venue corrected.
 */
const REFRESH_MS = 60_000;

/**
 * Keep the map current without a page reload.
 *
 * Pauses entirely while the tab is hidden and takes ONE immediate reading on
 * return, so a map left open in a background tab costs nothing and is already
 * correct on the first visible frame rather than up to a minute stale.
 */
function useLiveMapData(initial: MapData): MapData {
  const [data, setData] = useState(initial);

  // A new server render (navigating back to /map) must win over whatever the
  // poll last wrote, or the fresher page payload would be immediately replaced
  // by this component's older state.
  //
  // Adjusted DURING RENDER rather than in an effect. React documents this as the
  // way to reset state on a prop change: it re-renders immediately with the new
  // value and never paints the stale one, whereas an effect paints the old data
  // for a frame first and costs a second render pass to correct it.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setData(initial);
  }

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/map/pins", { cache: "no-store" });
        if (!res.ok || !alive) return;
        setData((await res.json()) as MapData);
      } catch {
        // A dropped refresh is not something the reader needs to be told about:
        // the map they are looking at is still the map, just a minute older.
      }
    };

    const start = () => { if (!timer) timer = setInterval(tick, REFRESH_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { void tick(); start(); } else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return data;
}

export function MapExplorer({ data: initialData }: { data: MapData }) {
  const data = useLiveMapData(initialData);
  const [filter, setFilter] = useState<Filter>("all");
  const [section, setSection] = useState<Section>("nearby");
  // Selection is anchored on a PIN, never on a group: group ids come from the
  // zoom-dependent grid, so flying to a selection re-keys its own group and a
  // group-id selection silently evaporates mid-animation.
  const [anchorPin, setAnchorPin] = useState<string | null>(null);
  const [detailPin, setDetailPin] = useState<string | null>(null);
  const [detent, setDetent] = useState<Detent>("half");
  const [zoom, setZoom] = useState(2);
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const apiRef = useRef<MapApi | null>(null);
  const nonce = useRef(0);

  // ── Which preview surface is in play ──
  // Desktop gets a card anchored to the pin; phones get the bottom sheet. This
  // is a real behavioural split, not a CSS one — rendering both and hiding one
  // would run two previews, two countdowns and two anchor loops for one
  // selection. matchMedia so it also tracks a window being resized across the
  // breakpoint, which `window.innerWidth` read once would not.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Deliberately a REF, not state. See FloatingPreview's `getAnchor`: the pin's
  // screen position changes every frame of a pan, and holding it in state meant
  // re-rendering this whole component — groups memo, sheet list and all — sixty
  // times a second to move one card.
  const previewRef = useRef<PreviewHandle | null>(null);

  const visible = useMemo(
    () => (filter === "all" ? data.pins : data.pins.filter((p) => p.layer === filter)),
    [data.pins, filter],
  );

  // Marker lifecycle state is a function of the clock, and changing it rebuilds
  // every Leaflet marker — so it runs on the MINUTE clock, not the per-second
  // one. See useCoarseNow for why a 1Hz reading here would re-run every pin's
  // entrance animation forever.
  const coarseNow = useCoarseNow(60_000);

  const groups = useMemo(
    () => groupPins(visible, zoom, coarseNow),
    [visible, zoom, coarseNow],
  );

  const group = useMemo(
    () => (anchorPin ? groups.find((g) => g.pins.some((p) => p.id === anchorPin)) ?? null : null),
    [groups, anchorPin],
  );

  // A group of one needs no intermediate list — open straight to the detail.
  const pin = useMemo<MapPin | null>(() => {
    if (!group) return null;
    if (group.pins.length === 1) return group.pins[0];
    return group.pins.find((p) => p.id === detailPin) ?? null;
  }, [group, detailPin]);

  const distanceTo = useCallback(
    (p: { lat: number; lon: number }) => (me ? haversine(me, p) : null),
    [me],
  );

  /**
   * The pin the DESKTOP floating card is showing, or null.
   *
   * Events only. A gym or a person still opens in the sheet, because their
   * detail card is a different shape and shrinking it into a 340px anchored box
   * would be a worse version of what already works.
   */
  const floatingPin = useMemo(
    () => (isDesktop && pin?.event ? pin : null),
    [isDesktop, pin],
  );

  /**
   * The sheet reverts to DISCOVERY while the floating card holds the selection.
   *
   * Without this the same event renders twice at once — anchored to its pin and
   * again in the sheet below it — which reads as a duplication bug, and puts
   * two live countdowns on screen for one card.
   */
  const sheetGroup = floatingPin ? null : group;

  /**
   * The selected pin's CURRENT screen position, read on demand.
   *
   * Called by the card itself during layout and again on every map movement —
   * never stored, so nothing re-renders when the map pans.
   */
  const getAnchor = useCallback((): Anchor | null => {
    if (!group) return null;
    const p = apiRef.current?.project(group.lat, group.lon);
    if (!p) return null;
    // The marker's coordinate is its TIP; the body sits ~22px above it. Anchor
    // on the body so the card's tail points at the pin, not at the ground
    // shadow under it.
    return { x: p.x, y: p.y - 22 };
  }, [group]);

  /** One method call per animation frame, and no React render. */
  const onViewportChange = useCallback(() => {
    previewRef.current?.reposition();
  }, []);

  /** The sheet's list for the active section. */
  const listed = useMemo(() => {
    const list = [...visible];
    if (section === "live") {
      return list
        .filter((p) => p.status === "LIVE" || (p.presentNow ?? 0) > 0)
        .sort((a, b) => (b.presentNow ?? 0) - (a.presentNow ?? 0));
    }
    if (section === "trending") {
      // Trending = where the community actually is, then what's imminent.
      return list.sort((a, b) => {
        const p = (b.presentNow ?? 0) - (a.presentNow ?? 0);
        return p !== 0 ? p : byRelevance(a, b);
      });
    }
    // Nearby needs a viewer position; without one the honest fallback is
    // "soonest", not a fake distance ordering.
    if (me) return list.sort((a, b) => haversine(me, a) - haversine(me, b));
    return list.sort(byRelevance);
  }, [visible, section, me]);

  const flyTo = useCallback((lat: number, lon: number, z: number) => {
    nonce.current += 1;
    // `offset` lifts the target above the sheet so a selected pin is never
    // hidden underneath the card describing it.
    setFocus({ lat, lon, zoom: z, nonce: nonce.current, offset: true });
    setZoom(z);
  }, []);

  // Deep link: /map?lat=..&lon=..&z=.. flies straight to a location — this is how
  // an event's venue opens INSIDE the app map (event-header) instead of bouncing
  // out to Google Maps. Parsed once on mount; APPLIED in onReady (below), because
  // the map instance mounts after this component and a focus set before the map
  // exists is dropped by the canvas. Malformed params are ignored.
  const pendingFocus = useRef<{ lat: number; lon: number; zoom: number } | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const lat = parseFloat(p.get("lat") ?? "");
    const lon = parseFloat(p.get("lon") ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const z = parseInt(p.get("z") ?? "", 10);
      pendingFocus.current = { lat, lon, zoom: Number.isFinite(z) ? Math.min(Math.max(z, 2), 18) : 8 };
    }
  }, []);

  /**
   * Marker tap. A multi-pin cluster keeps the CURRENT zoom: zooming in would
   * split the cluster apart, the anchor would resolve to a group of one, and
   * tapping "12 people · 3 gyms" would show one gym — the opposite of what the
   * badge promised.
   */
  const selectGroup = useCallback(
    (pinId: string | null) => {
      setAnchorPin(pinId);
      setDetailPin(null);
      if (!pinId) return;
      setDetent((d) => (d === "collapsed" ? "half" : d));
      const g = groups.find((x) => x.pins.some((p) => p.id === pinId));
      if (g) flyTo(g.lat, g.lon, g.pins.length > 1 ? zoom : Math.max(zoom, 8));
    },
    [groups, flyTo, zoom],
  );

  /** List tap — the lists show pins, so they open straight to the detail. */
  const selectPin = useCallback(
    (p: MapPin) => {
      setAnchorPin(p.id);
      setDetailPin(p.id);
      setDetent((d) => (d === "expanded" ? "half" : d === "collapsed" ? "half" : d));
      flyTo(p.lat, p.lon, Math.max(zoom, 8));
    },
    [flyTo, zoom],
  );

  const clearSelection = useCallback(() => {
    setAnchorPin(null);
    setDetailPin(null);
  }, []);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocateError("This browser can't share a location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Used for DISTANCE SORTING ONLY, in this tab, in memory. It is never
        // sent to the server — the server's idea of where anyone is comes from
        // a city they typed, never from a device.
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setMe(next);
        setLocating(false);
        setSection("nearby");
        flyTo(next.lat, next.lon, 6);
      },
      () => {
        setLocating(false);
        setLocateError("Location permission denied — showing everything instead.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    );
  }, [flyTo]);

  /** Changing filter must never leave a selection pointing at a hidden pin. */
  const changeFilter = useCallback((next: Filter) => {
    setFilter(next);
    clearSelection();
  }, [clearSelection]);

  const empty = new Set(data.pending);

  return (
    <div className="flex min-h-0 flex-col lg:h-full lg:flex-row">
      {/* ── Map column ── */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Filter chips */}
        <ChipRow className="shrink-0 px-4 py-2.5">
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              onClick={() => changeFilter(f.id)}
              active={filter === f.id}
              dot={f.id === "all" ? undefined : LAYER_COLOR[f.id as MapLayer]}
              count={
                f.id === "all"
                  ? data.pins.length + data.unmapped.length
                  : data.counts[f.id as MapLayer]
              }
            >
              {f.label}
            </Chip>
          ))}
        </ChipRow>

        {/* Map surface. The sheet lives INSIDE this box on phones, Apple-Maps
            style — the map is never navigated away from, only covered. */}
        {/* data-hscroll: Location is now its own swipe section, so without this
            a horizontal PAN of the map would be read as "swipe to Gyms" and
            drag the user off the map they were reading. */}
        {/* Desktop height: `lg:flex-1` alone was not enough. It only fills when
            EVERY ancestor has a definite height, and the chain above this ends
            in an auto-height page wrapper — so flex-1 resolved to content
            height and the map came out a few hundred pixels tall on desktop
            while phones (which use the explicit 72dvh) looked right. The
            viewport-relative floor makes the desktop map independent of that
            chain; flex-1 still lets it grow when a parent does provide height. */}
        <div data-hscroll className="relative mx-4 mb-4 h-[72dvh] min-h-[26rem] overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)] lg:h-auto lg:min-h-[calc(100dvh-13rem)] lg:flex-1">
          <MapCanvas
            className="cr-map absolute inset-0"
            groups={groups}
            anchorPinId={anchorPin}
            onSelect={selectGroup}
            me={me}
            focus={focus}
            onReady={(api) => {
              apiRef.current = api;
              // Apply a pending deep-link now that the map exists (one-shot).
              const f = pendingFocus.current;
              if (f) { pendingFocus.current = null; flyTo(f.lat, f.lon, f.zoom); }
            }}
            onZoomChange={setZoom}
            onViewportChange={onViewportChange}
          />

          {/* ── Desktop: the anchored event preview ──
              Rendered as a sibling of the canvas inside the same positioned
              box, so the card's pixel coordinates and the map's projection are
              in the same coordinate space with no offset maths. */}
          {floatingPin && (
            <FloatingPreview
              getAnchor={getAnchor}
              handleRef={previewRef}
              contentKey={floatingPin.id}
              onClose={clearSelection}
            >
              <EventMapPreview
                pin={floatingPin}
                distanceKm={distanceTo(floatingPin)}
                variant="floating"
              />
            </FloatingPreview>
          )}

          <div aria-hidden className="pointer-events-none absolute inset-0 z-[420] rounded-2xl shadow-[inset_0_0_60px_-14px_rgba(5,7,10,0.95)]" />

          {/* Controls */}
          <div className="absolute right-3 top-3 z-[430] flex flex-col gap-2">
            <ControlButton label="Zoom in" onClick={() => apiRef.current?.zoomIn()}>
              <Plus className="size-4" />
            </ControlButton>
            <ControlButton label="Zoom out" onClick={() => apiRef.current?.zoomOut()}>
              <Minus className="size-4" />
            </ControlButton>
            <ControlButton label="Whole world" onClick={() => apiRef.current?.resetView()}>
              <Globe2 className="size-4" />
            </ControlButton>
            <ControlButton label="Find my location" onClick={locate} accent={!!me}>
              {locating ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
            </ControlButton>
          </div>

          {/* Legend */}
          <div className="pointer-events-none absolute left-2 top-3 z-[430] flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-ink-700/70 bg-ink-950/70 px-2.5 py-1.5 backdrop-blur-md">
            {MAP_LAYERS.map((l) => (
              <span key={l.id} className="flex items-center gap-1 text-4xs font-bold uppercase tracking-wider text-mist">
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    background: LAYER_COLOR[l.id],
                    boxShadow: `0 0 6px ${LAYER_COLOR[l.id]}`,
                    opacity: empty.has(l.id) ? 0.4 : 1,
                  }}
                />
                <span className={empty.has(l.id) ? "text-fog" : undefined}>{l.label}</span>
              </span>
            ))}
          </div>

          {locateError && (
            <p className="absolute inset-x-3 top-14 z-[440] mx-auto max-w-xs rounded-lg border border-ink-700 bg-ink-950/90 px-3 py-2 text-center text-2xs text-mist backdrop-blur">
              {locateError}
            </p>
          )}

          {/* ── The bottom sheet — collapsed / half / expanded ── */}
          <BottomSheet
            detent={detent}
            onDetentChange={setDetent}
            // Dismissable only while it is SHOWING a selection. In discovery
            // mode a downward fling would otherwise clear nothing and leave a
            // sheet stub over a map the user was already looking at.
            onDismiss={sheetGroup ? clearSelection : undefined}
            header={
              sheetGroup ? (
                // A single selected pin gets NO header title — the detail card
                // below already leads with the name, and printing it twice a
                // finger-width apart reads as a rendering fault.
                <SheetSelectionHeader
                  title={pin ? null : describeGroup(sheetGroup)}
                  subtitle={pin ? null : sheetGroup.place}
                  onBack={pin && sheetGroup.pins.length > 1 ? () => setDetailPin(null) : undefined}
                  onClose={clearSelection}
                />
              ) : (
                <SheetDiscoveryHeader
                  section={section}
                  onSection={setSection}
                  count={listed.length}
                  hasLocation={!!me}
                />
              )
            }
          >
            {sheetGroup ? (
              pin ? (
                // Events get the dedicated premium preview; the other three
                // families keep the generic card that still serves them.
                pin.event ? (
                  <EventMapPreview pin={pin} distanceKm={distanceTo(pin)} />
                ) : (
                  <PinDetail pin={pin} distanceKm={distanceTo(pin)} signedIn={data.signedIn} />
                )
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="mb-1 flex items-center gap-1.5 font-display text-2xs font-bold uppercase tracking-wider text-fog">
                    <Layers className="size-3.5 text-blood-400" /> Everything here
                  </p>
                  {sheetGroup.pins.map((p) => (
                    <PinRow key={p.id} pin={p} distanceKm={distanceTo(p)} onClick={() => setDetailPin(p.id)} />
                  ))}
                </div>
              )
            ) : (
              <div className="flex flex-col gap-1.5">
                {listed.length === 0 ? (
                  <EmptyLayer filter={filter} section={section} empty={empty} signedIn={data.signedIn} />
                ) : (
                  listed.slice(0, 80).map((p) => (
                    <PinRow
                      key={p.id}
                      pin={p}
                      distanceKm={distanceTo(p)}
                      active={pin?.id === p.id}
                      onClick={() => selectPin(p)}
                    />
                  ))
                )}

                {!data.signedIn && (
                  <SignInNote />
                )}

                {data.unmapped.length > 0 && (filter === "all" || data.unmapped.some((u) => u.layer === filter)) && (
                  <details className="mt-2 rounded-lg border border-ink-800 bg-ink-900/50 px-3 py-2.5">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-2xs font-semibold text-mist">
                      <MapPinOff className="size-3.5 text-fog" />
                      {data.unmapped.length} not yet mapped
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {data.unmapped
                        .filter((u) => filter === "all" || u.layer === filter)
                        .slice(0, 25)
                        .map((u) => (
                          <li key={u.id}>
                            <Link href={u.href ?? "#"} className="block rounded-lg px-2 py-1.5 hover:bg-ink-850">
                              <span className="block truncate text-xs font-semibold text-chalk">{u.name}</span>
                              <span className="block truncate text-2xs text-fog">{u.place ?? u.subtitle}</span>
                            </Link>
                          </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-2xs leading-relaxed text-fog">
                      We only pin a place when we can locate it. These have a city or country we don&apos;t recognise yet.
                    </p>
                  </details>
                )}
              </div>
            )}
          </BottomSheet>
        </div>
      </div>
    </div>
  );
}

// ── Sheet headers ───────────────────────────────────────────────────────────

function SheetDiscoveryHeader({
  section, onSection, count, hasLocation,
}: {
  section: Section;
  onSection: (s: Section) => void;
  count: number;
  hasLocation: boolean;
}) {
  return (
    <ChipRow className="gap-1.5">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <Chip
          key={id}
          onClick={() => onSection(id)}
          active={section === id}
          tone="neutral"
          size="sm"
        >
          {Icon && <Icon className="size-3" />}
          {/* Without a granted location "Nearby" cannot mean nearby, so it
              says what it is actually sorted by rather than lying. */}
          {id === "nearby" && !hasLocation ? "Soonest" : label}
        </Chip>
      ))}
      <span className="ml-auto shrink-0 pl-2 text-2xs uppercase tracking-wider text-fog">{count}</span>
    </ChipRow>
  );
}

function SheetSelectionHeader({
  title, subtitle, onBack, onClose,
}: { title: string | null; subtitle?: string | null; onBack?: () => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to everything here"
          className="tap inline-flex shrink-0 items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1.5 text-2xs font-bold uppercase tracking-wide text-mist hover:text-chalk"
        >
          <ChevronLeft className="size-3.5" /> Back
        </button>
      )}
      <span className="min-w-0 flex-1">
        {title && (
          <span className="block truncate font-display text-sm font-bold uppercase tracking-wide text-chalk">
            {title}
          </span>
        )}
        {subtitle && <span className="block truncate text-2xs text-fog">{subtitle}</span>}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="tap cr-touch-target grid size-9 shrink-0 place-items-center rounded-lg border border-ink-700 bg-ink-850 text-mist hover:text-chalk"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ── Chrome ──────────────────────────────────────────────────────────────────

function ControlButton({
  label, onClick, children, accent,
}: { label: string; onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        // Stacked in a `flex-col gap-2` cluster: 36px box + 8px gap = a 44px
        // pitch, so the expanded hit zones tile exactly and never overlap.
        "tap cr-touch-target grid size-9 place-items-center rounded-lg border backdrop-blur-md transition-colors",
        accent
          ? "border-blood-500/60 bg-blood-500/20 text-blood-300"
          : "border-ink-700/80 bg-ink-950/75 text-mist hover:border-ink-600 hover:text-chalk",
      )}
    >
      {children}
    </button>
  );
}

/** Signed-out viewers see the PUBLIC slice only — say so rather than letting a
 *  thin map read as an empty community. */
function SignInNote() {
  return (
    <Link
      href="/account"
      className="mt-2 flex items-center gap-3 rounded-card border border-ink-700 bg-ink-900/60 px-3.5 py-3 transition-colors hover:border-blood-500/40"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blood-500/12 text-blood-300">
        <Lock className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xs font-bold text-chalk">You&apos;re seeing the public map</span>
        <span className="block text-2xs leading-relaxed text-fog">
          Sign in to see people who share their location with friends or gym mates — and to put yourself on it.
        </span>
      </span>
    </Link>
  );
}

function EmptyLayer({
  filter, section, empty, signedIn,
}: { filter: Filter; section: Section; empty: Set<MapLayer>; signedIn: boolean }) {
  const layer = filter === "all" ? null : (filter as MapLayer);
  const bare = layer !== null && empty.has(layer);
  const meta = MAP_LAYERS.find((l) => l.id === layer);

  const body = (() => {
    if (section === "live") return "Nobody is checked in anywhere right now. Check in somewhere and you'll be the first.";
    if (bare && layer === "people") {
      return signedIn
        ? "Nobody has put themselves on the map yet. Everyone is hidden by default — you can be the first from your profile's map settings."
        : "Nobody visible yet. People are hidden by default and choose who can see them; sign in to see friends and gym mates.";
    }
    if (bare && layer === "gyms") return "No gyms yet. Add the gym you train at and it appears here for everyone nearby.";
    if (bare && layer === "clubs") return "No fight clubs yet. A fight club is a community with a place and a meeting time.";
    if (bare) return "Nothing in this layer yet.";
    return "No results for this filter. Try another layer, or zoom out to the whole world.";
  })();

  const action =
    bare && layer === "gyms"
      ? { href: "/gyms/new", label: "Add your gym" }
      : bare && layer === "people" && signedIn
        ? { href: "/profile", label: "Put me on the map" }
        : undefined;

  return (
    <EmptyState
      compact
      icon={<MapPinOff className="size-5" />}
      accent={layer ? LAYER_COLOR[layer] : undefined}
      title={section === "live" ? "Nothing live" : bare ? `No ${meta?.label.toLowerCase()} yet` : "Nothing in view"}
      body={body}
      action={action}
    />
  );
}
