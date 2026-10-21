"use client";

import type { Location } from "@idea01/schemas";
import type { Map as LeafletMap, Marker } from "leaflet";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Banner, Button } from "./ui";

const INDIA_CENTER: [number, number] = [20.59, 78.96];
// The pin is drawn in the palette (ink body, volt centre). No image files, so nothing can fail to load.
const PIN_SVG =
  '<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17 43C17 43 3 27 3 16a14 14 0 0 1 28 0c0 11-14 27-14 27z" fill="#242424"/><circle cx="17" cy="16" r="6" fill="#DFFF00"/></svg>';

const round = (n: number) => Math.round(n * 1e6) / 1e6;

interface Props {
  value: Location | null;
  onChange: (value: Location) => void;
  tileUrl: string;
}

/** Click the map, drag the pin, or use the device location. Leaflet is loaded only in the browser. */
export function LocationPicker({ value, onChange, tileUrl }: Props) {
  const t = useTranslations("branchForm");
  const mapTitle = t("mapTitle");
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  // The map is created once; these refs let its event handlers always see the latest props without re-creating it.
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  onChangeRef.current = onChange;
  valueRef.current = value;

  /** Moves the pin, creating it (draggable) on first use. */
  function placePin(lat: number, lng: number) {
    const L = leaflet.current;
    const m = map.current;
    if (!L || !m) return;
    if (marker.current) return void marker.current.setLatLng([lat, lng]);
    const icon = L.divIcon({
      className: "pin-marker",
      html: PIN_SVG,
      iconSize: [34, 44],
      iconAnchor: [17, 44],
    });
    const pin = L.marker([lat, lng], { icon, draggable: true, keyboard: true, title: mapTitle }).addTo(m);
    pin.on("dragend", () => {
      const p = pin.getLatLng();
      onChangeRef.current({ lat: round(p.lat), lng: round(p.lng) });
    });
    marker.current = pin;
  }

  // Create the map once (and again only if the tile server changes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: placePin and mapTitle are stable for the map's lifetime by design
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !host.current) return;
      leaflet.current = L;
      const initial = valueRef.current;
      const m = L.map(host.current, {
        center: initial ? [initial.lat, initial.lng] : INDIA_CENTER,
        zoom: initial ? 16 : 5,
        scrollWheelZoom: false,
      });
      L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      m.on("click", (e) => {
        placePin(e.latlng.lat, e.latlng.lng);
        onChangeRef.current({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) });
      });
      map.current = m;
      if (initial) placePin(initial.lat, initial.lng);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      setReady(false);
    };
  }, [tileUrl]);

  // Keep the pin in step when the value changes from outside (e.g. "use my location").
  // biome-ignore lint/correctness/useExhaustiveDependencies: placePin only reads refs
  useEffect(() => {
    if (ready && value) placePin(value.lat, value.lng);
  }, [ready, value]);

  function locateMe() {
    setDenied(false);
    if (!navigator.geolocation) return setDenied(true);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) };
        onChange(loc);
        map.current?.setView([loc.lat, loc.lng], 17);
      },
      () => {
        setLocating(false);
        setDenied(true);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div>
      <div
        ref={host}
        role="application"
        aria-label={mapTitle}
        className="h-64 w-full overflow-hidden rounded-control border-[2.5px] border-ink bg-grey/40"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button small variant="secondary" onClick={locateMe} disabled={locating}>
          ◎ {locating ? t("locating") : t("useLocation")}
        </Button>
        <output className="text-sm font-semibold">{value ? t("pinSet") : t("pinNotSet")}</output>
      </div>
      {denied && (
        <Banner tone="info" role="status" className="mt-3">
          {t("locationDenied")}
        </Banner>
      )}
    </div>
  );
}
