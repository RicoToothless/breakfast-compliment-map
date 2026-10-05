"use client";

import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { Coordinates, Restaurant } from "@/lib/types";

let optionsSet = false;

type Props = {
  center: Coordinates;
  userLocation: Coordinates | null;
  restaurants: Restaurant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (center: Coordinates, zoom: number) => void;
};

export default function GoogleMap({
  center,
  userLocation,
  restaurants,
  selectedId,
  onSelect,
  onMove,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return;
    const windowWithAuth = window as typeof window & {
      gm_authFailure?: () => void;
    };
    windowWithAuth.gm_authFailure = () => {
      if (!cancelled) setError("地圖暫時無法使用，請稍後再試。");
    };
    async function initialize() {
      try {
        // Stop before loading Google libraries if the shared monthly budget
        // is exhausted or unavailable. Each new Map needs its own reservation.
        const response = await fetch("/api/map-usage", {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (cancelled) return;
        if (!response.ok) {
          const data = await response.json();
          setError(data.error ?? "地圖暫時無法使用，請稍後再試。");
          return;
        }
        if (!optionsSet) {
          setOptions({
            key: key!,
            v: "quarterly",
            language: "zh-TW",
            region: "TW",
          });
          optionsSet = true;
        }
        const { Map } = (await importLibrary(
          "maps",
        )) as google.maps.MapsLibrary;
        await importLibrary("marker");
        if (cancelled || !container.current) return;
        mapRef.current = new Map(container.current, {
          center: { lat: 25.033, lng: 121.5654 },
          zoom: 16,
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: {
            position: google.maps.ControlPosition.RIGHT_CENTER,
          },
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        setReady(true);
      } catch {
        if (!cancelled) setError("地圖載入失敗，請確認網路連線並重新整理。");
      }
    }
    // Avoid spending a reservation for React's cancelled development mount.
    const start = window.setTimeout(() => void initialize(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      delete windowWithAuth.gm_authFailure;
    };
  }, []);

  useEffect(() => {
    if (ready) mapRef.current?.panTo(center);
  }, [ready, center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const listener = map.addListener("idle", () => {
      const point = map.getCenter();
      if (point)
        onMove({ lat: point.lat(), lng: point.lng() }, map.getZoom() ?? 16);
    });
    return () => listener.remove();
  }, [ready, onMove]);

  useEffect(() => {
    if (
      ready &&
      userLocation &&
      mapRef.current &&
      (mapRef.current.getZoom() ?? 16) < 16
    )
      mapRef.current.setZoom(16);
  }, [ready, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers = restaurants.map((restaurant) => {
      const content = document.createElement("button");
      content.type = "button";
      content.className = `map-pin${restaurant.id === selectedId ? " active" : ""}`;
      content.setAttribute(
        "aria-label",
        `${restaurant.name}，${restaurant.compliments} 次稱讚`,
      );
      const count = document.createElement("span");
      count.className = `pin-count${restaurant.compliments > 50 ? " pin-count-red" : ""}`;
      count.textContent = String(restaurant.compliments);
      const name = document.createElement("span");
      name.textContent = restaurant.name;
      content.append(count, name);
      content.addEventListener("click", () => onSelect(restaurant.id));
      return new google.maps.marker.AdvancedMarkerElement({
        map,
        position: restaurant.location,
        content,
        title: restaurant.name,
        zIndex: restaurant.id === selectedId ? 100 : 1,
      });
    });
    if (userLocation) {
      const dot = document.createElement("div");
      dot.className = "user-location-dot";
      dot.title = "你的位置";
      markers.push(
        new google.maps.marker.AdvancedMarkerElement({
          map,
          position: userLocation,
          content: dot,
          zIndex: 101,
        }),
      );
    }
    return () =>
      markers.forEach((marker) => {
        marker.map = null;
      });
  }, [ready, restaurants, selectedId, onSelect, userLocation]);

  const selectedLocation = restaurants.find(
    (restaurant) => restaurant.id === selectedId,
  )?.location;
  const selectedLat = selectedLocation?.lat;
  const selectedLng = selectedLocation?.lng;

  // Pan when the selection changes, not when idle reports the same center or
  // another UI state updates. Otherwise panTo -> idle -> render loops forever.
  useEffect(() => {
    if (ready && selectedLat !== undefined && selectedLng !== undefined)
      mapRef.current?.panTo({ lat: selectedLat, lng: selectedLng });
  }, [ready, selectedId, selectedLat, selectedLng]);

  return (
    <div className="google-map-shell">
      <div
        ref={container}
        className="google-map"
        aria-label="台北早餐店與稱讚次數地圖"
      />
      {!ready && !error && (
        <div className="map-loading">
          <span className="spinner" />
          正在打開早餐地圖…
        </div>
      )}
      {error && (
        <div className="map-loading map-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
