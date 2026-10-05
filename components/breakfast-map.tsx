"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GoogleMap from "./google-map";
import {
  SunLogo,
  NavigationIcon,
  TrophyIcon,
  PinIcon,
  SparkIcon,
  SearchIcon,
  StarIcon,
  ListIcon,
  MapIcon,
} from "./icons";
import { MIN_SEARCH_ZOOM, TAIPEI_CENTER, distanceMeters } from "@/lib/geo";
import type {
  Coordinates,
  Favourite,
  GPSLocation,
  LeaderboardEntry,
  Restaurant,
  RestaurantResponse,
} from "@/lib/types";
import { authClient } from "@/lib/auth-client";

type Panel =
  | "results"
  | "vote"
  | "details"
  | "leaders"
  | "favourites"
  | "login"
  | null;
type VotingStatus = {
  authenticated: boolean;
  votedToday: boolean;
  loginAvailable: boolean;
};
type View = "map" | "list";
const FAVOURITES_KEY = "breakfast-favourites";
const RECENT_KEY = "breakfast-recent-searches";

class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok)
    throw new RequestError(
      data.error ?? "暫時無法讀取資料，請稍後再試。",
      response.status,
    );
  return data;
}

function formatDistance(meters?: number) {
  if (meters === undefined) return "台北市";
  return meters < 1000
    ? `${Math.round(meters)} 公尺`
    : `${(meters / 1000).toFixed(1)} 公里`;
}

function Attribution({
  restaurants,
  googleMapsUri,
}: {
  restaurants: Restaurant[];
  googleMapsUri?: string;
}) {
  const providers = new Map(
    restaurants.flatMap((r) => r.attributions).map((p) => [p.provider, p]),
  );
  return (
    <div className="google-attribution">
      {googleMapsUri ? (
        <a href={googleMapsUri} target="_blank" rel="noreferrer" translate="no">
          Google Maps ↗
        </a>
      ) : (
        <span translate="no">Google Maps</span>
      )}
      {[...providers.values()].map((p) => (
        <span key={p.provider}>
          {" "}
          ·{" "}
          {p.providerUri ? (
            <a href={p.providerUri} target="_blank" rel="noreferrer">
              {p.provider}
            </a>
          ) : (
            p.provider
          )}
        </span>
      ))}
    </div>
  );
}

function getGPS(): Promise<GPSLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("你的瀏覽器不支援定位。仍可使用店名搜尋與投票。"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (position.coords.accuracy > 100) {
          reject(new Error("定位不夠準確，請到訊號較好的地方再試。"));
          return;
        }
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (failure) =>
        reject(
          new Error(
            failure.code === 1
              ? "未開啟定位，仍可搜尋、收藏與投票。"
              : "目前無法取得位置，請再試一次。",
          ),
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

function RestaurantRows({
  restaurants,
  known,
  userLocation,
  onSelect,
  disabled,
}: {
  restaurants: Restaurant[];
  known: Map<string, Restaurant>;
  userLocation?: GPSLocation | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  return restaurants.map((r) => (
    <button
      className="restaurant-row"
      key={r.id}
      onClick={() => onSelect(r.id)}
      disabled={disabled}
    >
      <span className="restaurant-row-main">
        <strong>{r.name}</strong>
        <small>
          <PinIcon size={13} />
          {formatDistance(
            userLocation
              ? distanceMeters(userLocation, r.location)
              : r.distanceMeters,
          )}
        </small>
      </span>
      <span className="restaurant-row-count">
        <strong>{known.get(r.id)?.compliments ?? r.compliments}</strong>
        <small>次稱讚</small>
      </span>
    </button>
  ));
}

function visibleMarkers(
  nearby: Restaurant[],
  known: Map<string, Restaurant>,
  selectedId: string | null,
) {
  const visible = new Map(nearby.map((r) => [r.id, known.get(r.id) ?? r]));
  const selected = selectedId ? known.get(selectedId) : undefined;
  if (selected) visible.set(selected.id, selected);
  return [...visible.values()];
}

export default function BreakfastMap({ configured }: { configured: boolean }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [view, setView] = useState<View>("map");
  const [center, setCenter] = useState<Coordinates>(TAIPEI_CENTER);
  const [mapCenter, setMapCenter] = useState<Coordinates>(TAIPEI_CENTER);
  const [zoom, setZoom] = useState(MIN_SEARCH_ZOOM);
  const [userLocation, setUserLocation] = useState<GPSLocation | null>(null);
  const [query, setQuery] = useState("");
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [nearby, setNearby] = useState<Restaurant[]>([]);
  const [known, setKnown] = useState<Map<string, Restaurant>>(new Map());
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [leadersLoaded, setLeadersLoaded] = useState(false);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [savingFavourite, setSavingFavourite] = useState(false);
  const [votingStatus, setVotingStatus] = useState<VotingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaderBusy, setLeaderBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const voteButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const searching = useRef(false);
  const loadingDetail = useRef(false);
  const loadingLeaders = useRef(false);
  const nextSearchAt = useRef(0);
  const lastSearch = useRef("");
  const lastSearchAt = useRef(0);
  const selected = selectedId ? known.get(selectedId) : undefined;
  const favourite = favourites.find((f) => f.id === selectedId);
  const votingRestaurants = nearby;
  const markers = useMemo(
    () => visibleMarkers(nearby, known, selectedId),
    [nearby, known, selectedId],
  );

  // Start on the map on every visit. Favourites and search history persist;
  // Google names, addresses, coordinates and receipts stay in this page's UI.
  useEffect(() => {
    const start = window.setTimeout(() => {
      try {
        const saved: unknown = JSON.parse(
          localStorage.getItem(FAVOURITES_KEY) ?? "[]",
        );
        if (
          !Array.isArray(saved) ||
          saved.some(
            (f) =>
              !f ||
              typeof f.id !== "string" ||
              !/^[A-Za-z0-9_-]{1,255}$/.test(f.id) ||
              typeof f.nickname !== "string" ||
              !f.nickname.trim() ||
              f.nickname.length > 40,
          ) ||
          saved.length > 50
        )
          throw new Error("Invalid favourites");
        setFavourites(saved);
        const recent: unknown = JSON.parse(
          localStorage.getItem(RECENT_KEY) ?? "[]",
        );
        if (Array.isArray(recent))
          setRecentQueries(
            recent
              .filter(
                (s): s is string => typeof s === "string" && s.length <= 80,
              )
              .slice(0, 5),
          );
      } catch {
        setError("無法讀取這台裝置的收藏或偏好，請檢查瀏覽器儲存設定。");
      }
    }, 0);
    return () => {
      window.clearTimeout(start);
      searchController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!cooling) return;
    const timer = window.setTimeout(
      () => setCooling(false),
      Math.max(0, nextSearchAt.current - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [cooling]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function showPanel(next: Panel) {
    panelTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setError("");
    setNotice("");
    setPanel(next);
  }

  function closePanel() {
    setView("map");
    setPanel(null);
    (panelTrigger.current ?? voteButton.current)?.focus();
  }

  useEffect(() => {
    if (!panel) return;
    closeButton.current?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setView("map");
        setPanel(null);
        (panelTrigger.current ?? voteButton.current)?.focus();
      }
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [panel]);

  const handleMove = useCallback((point: Coordinates, mapZoom: number) => {
    setMapCenter((current) =>
      current.lat === point.lat && current.lng === point.lng ? current : point,
    );
    setZoom(mapZoom);
  }, []);

  function switchView() {
    const next: View = view === "map" ? "list" : "map";
    setView(next);
    if (next === "map") {
      setPanel(null);
    } else showPanel("results");
  }

  const search = useCallback(
    async (
      point: Coordinates,
      mode: "browse" | "vote",
      text = "",
      presentation: "map" | "list" = "list",
      searchZoom = zoom,
    ) => {
      if (!configured || searching.current) return;
      const resultPanel =
        mode === "vote" ? "vote" : presentation === "map" ? null : "results";
      const key = text
        ? `${mode}:${text}`
        : `${mode}:${point.lat.toFixed(5)}:${point.lng.toFixed(5)}:${mode === "vote" ? 16 : searchZoom}`;
      if (
        loaded &&
        lastSearch.current === key &&
        Date.now() - lastSearchAt.current < 60_000
      ) {
        setPanel(resultPanel);
        return;
      }
      if (!text && mode === "browse" && searchZoom < MIN_SEARCH_ZOOM) {
        setError("請先放大地圖，或輸入店名再搜尋。");
        return;
      }
      if (Date.now() < nextSearchAt.current) {
        setError("請等 10 秒再搜尋。");
        return;
      }
      searching.current = true;
      nextSearchAt.current = Date.now() + 10_000;
      setCooling(true);
      setBusy(true);
      setError("");
      setNotice("");
      setSelectedId(null);
      setPanel(resultPanel);
      const controller = new AbortController();
      searchController.current = controller;
      try {
        const params = new URLSearchParams({
          lat: String(point.lat),
          lng: String(point.lng),
          mode,
          zoom: String(searchZoom),
        });
        if (text) params.set("q", text);
        const data = await requestJson<RestaurantResponse>(
          `/api/restaurants?${params}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setNearby(data.restaurants);
        if (presentation === "map" && !data.restaurants.length)
          setNotice(
            "目前僅支援台北市。這個範圍沒有找到早餐店，試試移動地圖或搜尋店名。",
          );
        setKnown((current) => {
          const next = new Map(current);
          data.restaurants.forEach((r) => next.set(r.id, r));
          return next;
        });
        setLimitReached(data.resultLimitReached);
        setLoaded(true);
        lastSearch.current = key;
        lastSearchAt.current = Date.now();
        if (!text) {
          setCenter(point);
          setMapCenter(point);
        }
        if (text) {
          const recent = [
            text,
            ...recentQueries.filter((s) => s !== text),
          ].slice(0, 5);
          setRecentQueries(recent);
          try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
          } catch {
            setNotice("搜尋完成，但無法儲存最近搜尋。");
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "搜尋失敗，請再試一次。",
          );
      } finally {
        searching.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [configured, loaded, zoom, recentQueries],
  );

  async function openRestaurant(id: string, refresh = false) {
    if (loadingDetail.current) return;
    setSelectedId(id);
    setNickname("");
    setSavingFavourite(false);
    setNeedsRefresh(false);
    showPanel("details");
    if (known.has(id) && !refresh) return;
    loadingDetail.current = true;
    setDetailBusy(true);
    try {
      const data = await requestJson<{ restaurant: Restaurant }>(
        `/api/restaurants/${encodeURIComponent(id)}`,
      );
      setKnown((current) => new Map(current).set(id, data.restaurant));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "店家資訊暫時無法讀取。",
      );
    } finally {
      loadingDetail.current = false;
      setDetailBusy(false);
    }
  }

  const selectMarker = useCallback((id: string) => {
    // Every marker already has live details from a search or selected lookup.
    setSelectedId(id);
    setSavingFavourite(false);
    setNickname("");
    setNeedsRefresh(false);
    setError("");
    setNotice("");
    setPanel("details");
  }, []);

  async function openLeaders() {
    if (panel === "leaders") {
      closePanel();
      return;
    }
    showPanel("leaders");
    if (leadersLoaded || loadingLeaders.current) return;
    loadingLeaders.current = true;
    setLeaderBusy(true);
    try {
      const data = await requestJson<{ entries: LeaderboardEntry[] }>(
        "/api/leaderboard",
      );
      setLeaders(data.entries);
      setLeadersLoaded(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "排行榜暫時無法讀取。",
      );
    } finally {
      loadingLeaders.current = false;
      setLeaderBusy(false);
    }
  }

  async function locate() {
    if (locating || busy || cooling || voteBusy) return;
    setLocating(true);
    setError("");
    try {
      const gps = await getGPS();
      setUserLocation(gps);
      setCenter(gps);
      setMapCenter(gps);
      const searchZoom = Math.max(zoom, MIN_SEARCH_ZOOM);
      setZoom(searchZoom);
      setView("map");
      setPanel(null);
      await search(gps, "browse", "", "map", searchZoom);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "無法取得位置。");
    } finally {
      setLocating(false);
    }
  }

  async function openVoting(keepSelection = false) {
    if (authBusy || locating || busy) return;
    if (!keepSelection) setSelectedId(null);
    setAuthBusy(true);
    setError("");
    setNotice("");
    try {
      const status = await requestJson<VotingStatus>("/api/voting-status");
      setVotingStatus(status);
      if (!status.authenticated) {
        showPanel("login");
        return;
      }
      showPanel(keepSelection ? "details" : "vote");
      if (status.votedToday || keepSelection) return;
      if (!nearby.length) await search(mapCenter, "vote");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "目前無法開啟投票。",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function compliment() {
    if (!selected || voteBusy || votingStatus?.votedToday) return;
    if (!votingStatus?.authenticated) {
      await openVoting(true);
      return;
    }
    setVoteBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson<{
        compliments: number;
        complimentedToday: boolean;
        alreadyRecorded: boolean;
        votedToday: boolean;
      }>("/api/compliments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeId: selected.id,
          voteToken: selected.voteToken,
        }),
      });
      setKnown((current) =>
        new Map(current).set(selected.id, {
          ...selected,
          compliments: result.compliments,
          complimentedToday: result.complimentedToday,
        }),
      );
      setVotingStatus((current) =>
        current ? { ...current, votedToday: true } : current,
      );
      // A count update is our own data; no leaderboard/Places refresh is needed.
      setLeaders((current) =>
        current
          .map((r) =>
            r.id === selected.id
              ? { ...r, compliments: result.compliments }
              : r,
          )
          .sort((a, b) => b.compliments - a.compliments),
      );
      setLeadersLoaded(false);
      setNotice(
        result.alreadyRecorded
          ? "今天的稱讚已經記下來了，明天再來！"
          : "記下來了！把這句甜甜的早安，留在地圖上。",
      );
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 401) {
        setVotingStatus(null);
        setPanel("login");
      }
      if (failure instanceof RequestError && failure.status === 409)
        setNeedsRefresh(true);
      setError(
        failure instanceof Error ? failure.message : "投票失敗，請再試一次。",
      );
    } finally {
      setVoteBusy(false);
    }
  }

  function saveFavourite(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !nickname.trim()) return;
    if (favourites.length >= 50) {
      setError("這台裝置最多可以收藏 50 家店。");
      return;
    }
    const next = [
      ...favourites.filter((f) => f.id !== selected.id),
      { id: selected.id, nickname: nickname.trim() },
    ];
    try {
      localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
      setFavourites(next);
      setSavingFavourite(false);
      setNotice("已加入這台裝置的收藏。");
    } catch {
      setError("無法儲存收藏，請檢查瀏覽器儲存設定。");
    }
  }

  function removeFavourite(id: string) {
    const next = favourites.filter((f) => f.id !== id);
    try {
      localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
      setFavourites(next);
    } catch {
      setError("無法更新收藏，請檢查瀏覽器儲存設定。");
    }
  }

  async function signIn() {
    setAuthBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: selectedId
          ? `/?vote=1&place=${encodeURIComponent(selectedId)}`
          : "/?vote=1",
        errorCallbackURL: "/?loginError=1",
      });
      if (result.error) throw new Error("Sign-in failed");
    } catch {
      setError("Google 登入暫時無法使用，請稍後再試。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    setAuthBusy(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      setVotingStatus(null);
      closePanel();
    } catch {
      setError("登出失敗，請稍後再試。");
    } finally {
      setAuthBusy(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("vote") && !params.has("loginError")) return;
    const start = window.setTimeout(() => {
      if (params.has("loginError")) {
        setPanel("login");
        setError("Google 登入未完成，請再試一次。");
      } else {
        const placeId = params.get("place");
        if (placeId && /^[A-Za-z0-9_-]{1,255}$/.test(placeId)) {
          void (async () => {
            try {
              const status =
                await requestJson<VotingStatus>("/api/voting-status");
              setVotingStatus(status);
              if (status.authenticated) await openRestaurant(placeId);
              else showPanel("login");
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "目前無法開啟投票。",
              );
            }
          })();
        } else void openVoting();
      }
      window.history.replaceState(null, "", "/");
    }, 0);
    return () => window.clearTimeout(start);
    // OAuth restores the selected shop or voting list; it never submits a vote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panelTitle =
    panel === "login"
      ? "登入後投票"
      : panel === "leaders"
        ? "稱讚排行榜"
        : panel === "favourites"
          ? "我的收藏"
          : panel === "details"
            ? "店家資訊"
            : panel === "vote"
              ? "選擇店家投票"
              : "搜尋結果";

  return (
    <main
      className={`map-app${view === "list" ? " list-view" : ""}`}
      aria-label="早餐被稱讚地圖"
    >
      {configured && (
        <div className="map-canvas">
          <GoogleMap
            center={center}
            userLocation={userLocation}
            restaurants={markers}
            selectedId={selectedId}
            onSelect={selectMarker}
            onMove={handleMove}
          />
        </div>
      )}
      {!configured && (
        <div className="list-backdrop">
          <PinIcon size={48} />
          <h2>今天的早餐，從這裡開始</h2>
          <p>餐廳暫時無法使用，請稍後再試。</p>
        </div>
      )}

      <div className="top-search-bar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void search(mapCenter, "browse", query.trim());
          }}
          role="search"
        >
          <label className="sr-only" htmlFor="restaurant-query">
            搜尋早餐店
          </label>
          <input
            id="restaurant-query"
            type="search"
            list="recent-searches"
            maxLength={80}
            placeholder="搜尋早餐店"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <datalist id="recent-searches">
            {recentQueries.map((q) => (
              <option key={q} value={q} />
            ))}
          </datalist>
          <button
            type="submit"
            aria-label="搜尋"
            disabled={!configured || busy || cooling}
          >
            {busy ? <span className="spinner" /> : <SearchIcon />}
          </button>
        </form>
        <button
          className={panel === "favourites" ? "active" : ""}
          aria-label="我的收藏"
          aria-expanded={panel === "favourites"}
          onClick={() =>
            panel === "favourites" ? closePanel() : showPanel("favourites")
          }
        >
          <StarIcon filled={panel === "favourites"} />
        </button>
        <button
          aria-label={view === "map" ? "切換清單檢視" : "切換地圖檢視"}
          onClick={switchView}
        >
          {view === "map" ? <ListIcon /> : <MapIcon />}
        </button>
      </div>

      {!panel && configured && view === "map" && (
        <>
          <button
            className="search-area-button"
            disabled={busy || cooling || zoom < MIN_SEARCH_ZOOM}
            title={
              zoom < MIN_SEARCH_ZOOM
                ? "請先放大地圖，或輸入店名搜尋"
                : undefined
            }
            onClick={() => void search(mapCenter, "browse", "", "map")}
          >
            {busy ? "搜尋中…" : "搜尋這個範圍"}
          </button>
          <p className="sr-only" role="status">
            {busy
              ? "正在搜尋早餐店"
              : loaded
                ? `地圖上顯示 ${nearby.length} 家早餐店`
                : ""}
          </p>
        </>
      )}
      {notice && !panel && (
        <p
          className={`map-status${notice.startsWith("目前僅支援台北市") ? " map-status-single-line" : ""}`}
          role="status"
        >
          {notice}
        </p>
      )}
      {locating && (
        <p className="sr-only" role="status">
          {busy ? "正在搜尋附近早餐店…" : "正在取得你的位置…"}
        </p>
      )}
      {error && !panel && (
        <div className="map-status map-status-error" role="alert">
          <span>{error}</span>
          <button aria-label="關閉訊息" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}

      {panel && (
        <section
          id="map-panel"
          className={`map-sheet${view === "list" ? " map-sheet-list" : ""}`}
          role="dialog"
          aria-labelledby="panel-title"
        >
          <div className="sheet-header">
            <h1 id="panel-title">{panelTitle}</h1>
            <div>
              {panel === "details" && selected && !detailBusy && (
                <button
                  className="favourite-button"
                  onClick={() =>
                    favourite
                      ? removeFavourite(selected.id)
                      : setSavingFavourite(!savingFavourite)
                  }
                >
                  <StarIcon filled={Boolean(favourite)} />
                  {favourite ? "取消收藏" : "收藏"}
                </button>
              )}
              <button
                ref={closeButton}
                className="sheet-close"
                onClick={closePanel}
                aria-label="關閉面板"
              >
                ×
              </button>
            </div>
          </div>
          <div className="sheet-content">
            {error && (
              <div className="inline-error" role="alert">
                <span>{error}</span>
                {needsRefresh && selectedId && (
                  <button
                    disabled={detailBusy}
                    onClick={() => void openRestaurant(selectedId, true)}
                  >
                    重新載入店家資訊
                  </button>
                )}
              </div>
            )}
            {panel === "login" ? (
              <div className="login-prompt">
                <SunLogo size={64} />
                <h2>把今天的好心情留在地圖上</h2>
                <p>使用 Google 登入，每個帳號每天一票。</p>
                <button
                  className="google-sign-in"
                  onClick={() => void signIn()}
                  disabled={authBusy || votingStatus?.loginAvailable === false}
                >
                  {authBusy ? "正在登入…" : "使用 Google 登入"}
                </button>
                {votingStatus?.loginAvailable === false && (
                  <p className="inline-error">登入暫時無法使用，請稍後再試。</p>
                )}
                <p className="login-terms">
                  登入即表示同意<a href="/terms">使用條款</a>與
                  <a href="/privacy">隱私權政策</a>。
                </p>
              </div>
            ) : panel === "details" ? (
              detailBusy ? (
                <div className="empty-state" role="status">
                  <span className="spinner" />
                  正在打開店家資訊…
                </div>
              ) : selected ? (
                <div className="selected-restaurant">
                  <button
                    className="back-link"
                    onClick={() => {
                      setSelectedId(null);
                      setPanel(
                        votingStatus?.authenticated ? "vote" : "results",
                      );
                      setError("");
                      setNotice("");
                    }}
                  >
                    ← 返回清單
                  </button>
                  <h2>{selected.name}</h2>
                  <Attribution
                    restaurants={[selected]}
                    googleMapsUri={selected.googleMapsUri}
                  />
                  {savingFavourite && (
                    <form className="favourite-form" onSubmit={saveFavourite}>
                      <label htmlFor="favourite-nickname">替收藏取個名字</label>
                      <input
                        id="favourite-nickname"
                        maxLength={40}
                        value={nickname}
                        onChange={(event) => setNickname(event.target.value)}
                        placeholder="例如：巷口早餐"
                        required
                      />
                      <button type="submit">儲存收藏</button>
                    </form>
                  )}
                  <div className="selected-count">
                    <strong>{selected.compliments.toLocaleString()}</strong>
                    <span>次被稱讚</span>
                  </div>
                  <p className="compliment-description">
                    我被稱讚為帥哥、美女、妹妹等等
                  </p>
                  <button
                    className="compliment-button"
                    disabled={
                      voteBusy ||
                      authBusy ||
                      needsRefresh ||
                      votingStatus?.votedToday
                    }
                    onClick={() => {
                      if (!votingStatus?.authenticated) void openVoting(true);
                      else void compliment();
                    }}
                  >
                    <SparkIcon />
                    {voteBusy
                      ? "正在記錄…"
                      : votingStatus?.votedToday
                        ? "今天已投票"
                        : !votingStatus?.authenticated
                          ? "登入並投票"
                          : "我被稱讚了"}
                  </button>
                  {notice && (
                    <p className="success-notice" role="status">
                      {notice}
                    </p>
                  )}
                </div>
              ) : (
                <div className="empty-state">請重新搜尋或選擇另一家店。</div>
              )
            ) : panel === "favourites" ? (
              <>
                <p className="sheet-caption">
                  收藏留在這台裝置 · {favourites.length} 家
                </p>
                {favourites.length ? (
                  favourites.map((f) => (
                    <div className="favourite-row" key={f.id}>
                      <button
                        className="restaurant-row"
                        onClick={() => void openRestaurant(f.id)}
                        disabled={detailBusy}
                      >
                        <StarIcon filled />
                        <span className="restaurant-row-main">
                          <strong>{f.nickname}</strong>
                          <small>
                            {known.get(f.id)?.name ?? "點選查看店家"}
                          </small>
                        </span>
                      </button>
                      <button
                        className="remove-favourite"
                        aria-label={`移除收藏 ${f.nickname}`}
                        onClick={() => removeFavourite(f.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    還沒有收藏。
                    <br />
                    搜尋店家後，按下星星加入收藏。
                  </div>
                )}
                {favourites.some((f) => known.has(f.id)) && (
                  <Attribution
                    restaurants={favourites.flatMap((f) =>
                      known.get(f.id) ? [known.get(f.id)!] : [],
                    )}
                  />
                )}
              </>
            ) : panel === "leaders" ? (
              <>
                <p className="sheet-caption">最會稱讚人的早餐店 · TOP 10</p>
                {leaderBusy ? (
                  <div className="empty-state" role="status">
                    <span className="spinner" />
                    正在整理排行榜…
                  </div>
                ) : leaders.length ? (
                  leaders.map((entry, index) => (
                    <button
                      className="restaurant-row leaderboard-row"
                      key={entry.id}
                      onClick={() => void openRestaurant(entry.id)}
                      disabled={detailBusy}
                    >
                      <span className="rank-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="restaurant-row-main">
                        <strong>
                          {known.get(entry.id)?.name ??
                            `第 ${index + 1} 名早餐店`}
                        </strong>
                        <small>
                          {known.get(entry.id)?.address ?? "點選查看店家"}
                        </small>
                      </span>
                      <span className="restaurant-row-count">
                        <strong>{entry.compliments}</strong>
                        <small>次稱讚</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">第一句稱讚，就從你開始。</div>
                )}
                {error && (
                  <button
                    className="retry-button"
                    onClick={() => {
                      setLeadersLoaded(false);
                      closePanel();
                    }}
                  >
                    關閉後重新開啟排行榜
                  </button>
                )}
                {leaders.some((r) => known.has(r.id)) && (
                  <Attribution
                    restaurants={leaders.flatMap((r) =>
                      known.get(r.id) ? [known.get(r.id)!] : [],
                    )}
                  />
                )}
              </>
            ) : (
              <>
                {panel === "vote" && (
                  <>
                    <div className="voting-account">
                      <span>
                        {votingStatus?.votedToday
                          ? "今天已投票，明天再來！"
                          : "每天一票 · 選擇店家後投票"}
                      </span>
                      <button
                        onClick={() => void signOut()}
                        disabled={authBusy}
                      >
                        登出
                      </button>
                    </div>
                    <div className="voting-location">
                      <button
                        disabled={
                          busy ||
                          locating ||
                          cooling ||
                          votingStatus?.votedToday
                        }
                        onClick={() => void locate()}
                      >
                        使用我的位置（選用）
                      </button>
                      {userLocation && (
                        <button
                          disabled={busy || cooling || votingStatus?.votedToday}
                          onClick={() => void search(userLocation, "vote")}
                        >
                          找附近其他店家
                        </button>
                      )}
                    </div>
                  </>
                )}
                {busy || locating ? (
                  <div className="empty-state" role="status">
                    <span className="spinner" />
                    {locating ? "正在確認你的 GPS 位置…" : "正在找早餐店…"}
                  </div>
                ) : panel === "vote" ? (
                  votingRestaurants.length ? (
                    <RestaurantRows
                      restaurants={votingRestaurants}
                      known={known}
                      userLocation={userLocation}
                      onSelect={openRestaurant}
                      disabled={detailBusy}
                    />
                  ) : (
                    <div className="empty-state">
                      {userLocation
                        ? "附近還沒有找到早餐店。"
                        : "沒有找到店家，試試搜尋店名或移動地圖。"}
                    </div>
                  )
                ) : nearby.length ? (
                  <RestaurantRows
                    restaurants={nearby}
                    known={known}
                    onSelect={openRestaurant}
                    disabled={detailBusy}
                  />
                ) : (
                  <div className="empty-state">
                    {loaded
                      ? "沒有找到符合的店家。試試店名或更小的範圍。"
                      : "輸入店名後按搜尋，或使用定位找附近店家。"}
                  </div>
                )}
                <p className="sheet-note">
                  {limitReached
                    ? "目前只顯示部分結果。放大地圖或輸入更完整的店名。"
                    : "搜尋結果可能不包含所有早餐店。"}
                </p>
                {(panel === "vote" ? votingRestaurants : nearby).length > 0 && (
                  <Attribution
                    restaurants={panel === "vote" ? votingRestaurants : nearby}
                  />
                )}
                {notice && (
                  <p className="success-notice" role="status">
                    {notice}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <nav className="map-actions" aria-label="地圖功能">
        <button
          className="map-action leaderboard-action"
          aria-label="稱讚排行榜"
          aria-expanded={panel === "leaders"}
          onClick={() => void openLeaders()}
        >
          <TrophyIcon />
        </button>
        <button
          ref={voteButton}
          className="map-action vote-action"
          onClick={() => void openVoting()}
          disabled={authBusy || locating || busy}
          aria-expanded={panel === "vote" || panel === "login"}
        >
          <SunLogo size={43} />
          <span>投票</span>
        </button>
        <button
          className={`map-action navigation-action${locating ? " navigation-loading" : ""}`}
          onClick={() => void locate()}
          disabled={!configured || locating || busy || cooling || voteBusy}
          aria-label="使用我的位置"
          aria-busy={locating}
          title="使用我的位置"
        >
          <NavigationIcon />
        </button>
      </nav>
    </main>
  );
}
