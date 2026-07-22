"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker, LayerGroup } from "leaflet";
import type { MapLayer } from "@/lib/geo/types";
import { describeGroup, type PinGroup } from "./group-pins";

// ════════════════════════════════════════════════════════════════════════════
//  The map canvas.
//
//  Raw Leaflet, not react-leaflet: markers are rebuilt from a plain array on
//  every change, which is both simpler than reconciling a component tree of
//  markers and the only way to get full control of the pin markup (the glow,
//  the count ring, the selected state are all ours, not a library's).
//
//  Leaflet is imported dynamically inside the effect — it touches `window` at
//  module scope, so it must never be evaluated during SSR or the Next build.
//
//  Basemap is env-overridable. The default is CARTO's dark basemap over OSM
//  data, attributed below as their terms require; swapping in Mapbox/Google/a
//  self-hosted style is two environment variables, not a code change.
// ════════════════════════════════════════════════════════════════════════════

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ??
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Layer accent colours — red events, blue gyms, gold people, purple clubs. */
export const LAYER_COLOR: Record<MapLayer, string> = {
  events: "#e11d2a",
  gyms: "#38bdf8",
  people: "#f5c542",
  clubs: "#a855f7",
};

/** 16×16 glyphs, inlined so a pin never waits on an icon request. */
const GLYPH: Record<MapLayer, string> = {
  events:
    '<path d="M8 2v3M16 2v3M3.5 9h17M4.5 5.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"/>',
  gyms:
    '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  people:
    '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  clubs:
    '<path d="M14.5 17.5 20 23M9.5 17.5 4 23M20 2l-9 9M4 2l9 9M18 2h3v3M6 2H3v3"/>',
};

/** User content in an innerHTML string — escape it or a display name is XSS. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function pinHtml(group: PinGroup, selected: boolean): string {
  const color = LAYER_COLOR[group.layer];
  const count = group.pins.length;
  const live = group.pins.some((p) => p.status === "LIVE");
  const here = group.presentNow;
  // Mixed groups get a second, smaller dot in the runner-up layer's colour, so
  // "there is more than one kind of thing here" is legible before you tap.
  const second = group.breakdown[1]?.layer;

  // A solo person renders as their own avatar — a face on the map is the whole
  // point of the People layer, and a generic dot would waste it.
  const solo = count === 1 ? group.pins[0] : null;
  const face =
    solo && solo.layer === "people" && solo.imageUrl
      ? `<img class="cr-pin__face" src="${esc(solo.imageUrl)}" alt="" loading="lazy" decoding="async" />`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[group.layer]}</svg>`;

  return `
    <span class="cr-pin${selected ? " is-selected" : ""}${live ? " is-live" : ""}${solo?.layer === "people" ? " is-face" : ""}" style="--pin:${color}">
      <span class="cr-pin__halo"></span>
      <span class="cr-pin__body">${face}</span>
      ${second ? `<span class="cr-pin__mix" style="--mix:${LAYER_COLOR[second]}"></span>` : ""}
      ${count > 1 ? `<span class="cr-pin__count">${count > 99 ? "99+" : count}</span>` : ""}
      ${here > 0 ? `<span class="cr-pin__here">${here > 99 ? "99+" : here}</span>` : ""}
      <span class="cr-pin__stem"></span>
    </span>`;
}

export interface MapCanvasProps {
  groups: PinGroup[];
  /**
   * The selected PIN's id, not the group's. Group ids are derived from the
   * zoom-dependent grid, so they change under you the moment the map flies to
   * a selection — anchoring on a pin is the only stable identity.
   */
  anchorPinId: string | null;
  /** Receives the anchor pin id for the clicked group, or null to clear. */
  onSelect: (pinId: string | null) => void;
  /** Viewer position, when they've granted it — drawn as a separate beacon. */
  me: { lat: number; lon: number } | null;
  /** Bumping the nonce recentres on the selection / on the viewer. */
  focus: MapFocus | null;
  /** Hands the parent the zoom controls once the map exists. */
  onReady?: (api: MapApi) => void;
  /** Fires on zoomend so grouping granularity tracks the real viewport. */
  onZoomChange?: (zoom: number) => void;
  className?: string;
}

export interface MapFocus {
  lat: number;
  lon: number;
  zoom: number;
  /** Changing this re-fires the fly, even to the same coordinates. */
  nonce: number;
  /** Frame the point in the upper part of the map, clear of the detail card. */
  offset?: boolean;
}

/** The only imperative surface the explorer's own chrome needs. */
export interface MapApi {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

export default function MapCanvas({
  groups, anchorPinId, onSelect, me, focus, onReady, onZoomChange, className,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pinLayerRef = useRef<LayerGroup | null>(null);
  const meLayerRef = useRef<LayerGroup | null>(null);
  // State, not a ref: the marker effect must re-run once the map exists, and
  // its own deps (groups/selection) may never change again after first paint.
  const [ready, setReady] = useState(false);
  // The opening view frames the actual data, once. A fixed world view wastes
  // most of a phone screen on empty ocean, and re-fitting on every data change
  // would yank the viewport out from under someone who has panned somewhere.
  const didFitRef = useRef(false);
  // The click handler is re-created on every render; markers are not. Reading
  // it through a ref keeps stale closures out of the marker callbacks.
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  const onZoomRef = useRef(onZoomChange);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onReadyRef.current = onReady;
    onZoomRef.current = onZoomChange;
  });

  // ── Create the map once ──
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !hostRef.current || mapRef.current) return;

      map = L.map(hostRef.current, {
        center: [22, 12],
        zoom: 2,
        // Provisional — replaced with a container-derived floor once we know
        // where the pins are (see the fit block below).
        minZoom: 1,
        maxZoom: 17,
        zoomControl: false,
        attributionControl: true,
        worldCopyJump: true,
        // The map lives inside the app shell's scroll region. Grabbing the wheel
        // on hover would trap the page scroll, so zoom is by control, pinch, or
        // double-click — never by scrolling past it.
        scrollWheelZoom: false,
        // Keep the viewport on the world rather than letting it drift into grey.
        maxBounds: [[-85, -220], [85, 220]],
        maxBoundsViscosity: 0.7,
      });

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 19,
        detectRetina: true,
      }).addTo(map);

      // Top-left, not Leaflet's default bottom-right: the bottom sheet covers
      // the bottom of the map at every detent, and both OSM and CARTO require
      // the attribution to stay VISIBLE — an attribution behind a panel is not
      // attribution.
      map.attributionControl.setPrefix("").setPosition("topleft");
      pinLayerRef.current = L.layerGroup().addTo(map);
      meLayerRef.current = L.layerGroup().addTo(map);

      // Tapping bare map dismisses the detail sheet.
      map.on("click", () => onSelectRef.current(null));
      map.on("zoomend", () => onZoomRef.current?.(map!.getZoom()));

      mapRef.current = map;
      setReady(true);
      onReadyRef.current?.({
        zoomIn: () => mapRef.current?.zoomIn(),
        zoomOut: () => mapRef.current?.zoomOut(),
        resetView: () => mapRef.current?.flyTo([20, 6], mapRef.current.getMinZoom(), { duration: 0.8 }),
      });
      // The container is sized by flexbox; Leaflet measures on create, which can
      // land a frame early. One settle pass after paint avoids grey tile gaps.
      requestAnimationFrame(() => map?.invalidateSize());
    })();

    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      pinLayerRef.current = null;
      meLayerRef.current = null;
      // Belongs to the map instance, not the component: React 19 StrictMode
      // mounts, tears down and remounts in dev, and a fit flag that survives
      // the teardown means the REAL map never frames its data.
      didFitRef.current = false;
    };
  }, []);

  // ── Rebuild pins whenever the visible set or the selection changes ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const layer = pinLayerRef.current;
      if (cancelled || !layer) return;
      layer.clearLayers();

      for (const g of groups) {
        const selected = anchorPinId !== null && g.pins.some((p) => p.id === anchorPinId);
        const marker: Marker = L.marker([g.lat, g.lon], {
          icon: L.divIcon({
            html: pinHtml(g, selected),
            className: "cr-pin-wrap",
            iconSize: [38, 46],
            iconAnchor: [19, 44],
          }),
          // Selected pin, then live pins, sit above the rest of the field.
          zIndexOffset: selected ? 1000 : g.pins.some((p) => p.status === "LIVE") ? 500 : 0,
          keyboard: true,
          title: g.pins.length > 1 ? `${describeGroup(g)}${g.place ? ` in ${g.place}` : ""}` : g.pins[0].name,
        });
        marker.on("click", (e) => {
          // Otherwise the map's own click handler immediately deselects it.
          e.originalEvent?.stopPropagation();
          onSelectRef.current(selected ? null : g.pins[0].id);
        });
        marker.addTo(layer);
      }

      // Frame the data on the first paint that actually has some.
      const map = mapRef.current;
      if (map && !didFitRef.current && groups.length > 0) {
        didFitRef.current = true;
        const bounds = L.latLngBounds(groups.map((g) => [g.lat, g.lon] as [number, number]));
        const padding = L.point(44, 56);
        // "Everything we have" is the floor, computed from the real container:
        // a fixed minZoom either clamps the opening fit on a phone (showing a
        // third of the world and none of the Americas) or lets a desktop zoom
        // out into empty ocean. Derive it instead.
        //
        // Floored at 1. A worldwide spread needs zoom 0 to fit a phone, and at
        // zoom 0 the whole planet is 256px: half the frame goes to the poles,
        // where nobody has ever run a card. One notch in is a legible map that
        // clips some empty Pacific.
        const fit = Math.max(1, Math.min(map.getBoundsZoom(bounds, false, padding), 6));
        map.setMinZoom(fit);
        map.fitBounds(bounds, { padding, maxZoom: 6, animate: false });

        // At the floor the viewport is taller than the data, so Leaflet's
        // centre sits mid-ocean. Bias north — that's where the venues are.
        if (map.getZoom() <= 1) {
          map.setView([Math.max(bounds.getCenter().lat, 18), bounds.getCenter().lng], map.getZoom(), { animate: false });
        }
        onZoomRef.current?.(map.getZoom());
      }
    })();
    return () => { cancelled = true; };
  }, [groups, anchorPinId, ready]);

  // ── The viewer's own position ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const layer = meLayerRef.current;
      if (cancelled || !layer) return;
      layer.clearLayers();
      if (!me) return;
      L.marker([me.lat, me.lon], {
        icon: L.divIcon({
          html: '<span class="cr-me"><span class="cr-me__ring"></span><span class="cr-me__dot"></span></span>',
          className: "cr-pin-wrap",
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        interactive: false,
        zIndexOffset: -100,
      }).addTo(layer);
    })();
    return () => { cancelled = true; };
  }, [me]);

  // ── Imperative recentre, driven by a nonce so repeat requests still fire ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!focus || !map) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;

      let target = L.latLng(focus.lat, focus.lon);
      if (focus.offset) {
        // Push the map's CENTRE south of the target so the target itself lands
        // in the upper third — above the detail card docked along the bottom.
        const px = map.project(target, focus.zoom);
        target = map.unproject(px.add(L.point(0, map.getSize().y * 0.22)), focus.zoom);
      }
      map.flyTo(target, focus.zoom, { duration: 0.85, easeLinearity: 0.22 });
    })();
    return () => { cancelled = true; };
  }, [focus]);

  // ── Keep Leaflet's idea of the container size honest ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.invalidateSize());
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return <div ref={hostRef} className={className} role="application" aria-label="Combat map" />;
}
