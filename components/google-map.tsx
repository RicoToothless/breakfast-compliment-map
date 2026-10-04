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
  onSearch: (center: Coordinates) => void;
  busy: boolean;
};

export default function GoogleMap({
  center,
  userLocation,
  restaurants,
  selectedId,
  onSelect,
  onSearch,
  busy,
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
      if (!cancelled)
        setError(
          "地圖暫時無法使用，請稍後再試。",
        );
    };
    async function initialize() {
      try {
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
          zoom: 15,
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
        });
        setReady(true);
      } catch {
        if (!cancelled) setError("地圖載入失敗，請確認網路連線並重新整理。");
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      delete windowWithAuth.gm_authFailure;
    };
  }, []);

  useEffect(() => {
    if (ready) mapRef.current?.panTo(center);
  }, [ready, center]);

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

  useEffect(() => {
    const selected = restaurants.find(
      (restaurant) => restaurant.id === selectedId,
    );
    if (ready && selected) mapRef.current?.panTo(selected.location);
  }, [ready, restaurants, selectedId]);

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
      {ready && !error && (
        <button
          className="search-area"
          disabled={busy}
          onClick={() => {
            const position = mapRef.current?.getCenter();
            if (position)
              onSearch({ lat: position.lat(), lng: position.lng() });
          }}
        >
          ↻ 搜尋這個區域
        </button>
      )}
      <div className="map-legend">
        <span className="legend-dot" /> 店名旁的數字，是被稱讚的次數
      </div>
    </div>
  );
}
