"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import GoogleMap from "./google-map";
import { SunLogo, LocationIcon, PinIcon, SparkIcon } from "./icons";
import { DISTRICTS, TAIPEI_CENTER } from "@/lib/geo";
import type { Coordinates, Restaurant, RestaurantResponse } from "@/lib/types";

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "暫時無法讀取資料，請稍後再試。");
  return data;
}

function formatDistance(meters?: number) {
  if (meters === undefined) return "台北市";
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} 公尺`
    : `${(meters / 1000).toFixed(1)} 公里`;
}

function Attribution({ restaurants }: { restaurants: Restaurant[] }) {
  const providers = new Map(
    restaurants
      .flatMap((restaurant) => restaurant.attributions)
      .map((provider) => [provider.provider, provider]),
  );
  return (
    <div className="google-attribution">
      <span translate="no">Google Maps</span>
      {[...providers.values()].map((provider) => (
        <span key={provider.provider}>
          {" "}
          ·{" "}
          {provider.providerUri ? (
            <a href={provider.providerUri} target="_blank" rel="noreferrer">
              {provider.provider}
            </a>
          ) : (
            provider.provider
          )}
        </span>
      ))}
    </div>
  );
}

export default function BreakfastMap({ configured }: { configured: boolean }) {
  const [center, setCenter] = useState<Coordinates>(TAIPEI_CENTER);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [district, setDistrict] = useState("");
  const [nearby, setNearby] = useState<Restaurant[]>([]);
  const [leaders, setLeaders] = useState<Restaurant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(configured);
  const [locating, setLocating] = useState(false);
  const [leaderBusy, setLeaderBusy] = useState(configured);
  const [voteBusy, setVoteBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [error, setError] = useState("");
  const [leaderError, setLeaderError] = useState("");
  const [notice, setNotice] = useState("");
  const [locationLabel, setLocationLabel] = useState("信義區附近");
  const searchController = useRef<AbortController | null>(null);

  const allRestaurants = useMemo(() => {
    const merged = new Map(
      leaders.map((restaurant) => [restaurant.id, restaurant]),
    );
    nearby.forEach((restaurant) => merged.set(restaurant.id, restaurant));
    return [...merged.values()];
  }, [nearby, leaders]);
  const selected = allRestaurants.find(
    (restaurant) => restaurant.id === selectedId,
  );

  const loadNearby = useCallback(
    async (point: Coordinates, selectedDistrict = "") => {
      searchController.current?.abort();
      const controller = new AbortController();
      searchController.current = controller;
      setBusy(true);
      setError("");
      setSelectedId(null);
      setNotice("");
      setCenter(point);
      try {
        const params = new URLSearchParams({
          lat: String(point.lat),
          lng: String(point.lng),
        });
        if (selectedDistrict) params.set("district", selectedDistrict);
        const data = await requestJson<RestaurantResponse>(
          `/api/restaurants?${params}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setNearby(data.restaurants);
        setLimitReached(data.resultLimitReached);
        setLoaded(true);
      } catch (error) {
        if (!controller.signal.aborted) {
          setNearby([]);
          setLoaded(false);
          setError(
            error instanceof Error
              ? error.message
              : "餐廳搜尋失敗，請稍後再試。",
          );
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [],
  );

  const loadLeaders = useCallback(async () => {
    setLeaderBusy(true);
    setLeaderError("");
    try {
      const data = await requestJson<{ restaurants: Restaurant[] }>(
        "/api/leaderboard",
      );
      setLeaders(data.restaurants);
      const byId = new Map(data.restaurants.map(restaurant => [restaurant.id, restaurant]));
      setNearby(current => current.map(restaurant => {
        const updated = byId.get(restaurant.id);
        return updated ? { ...restaurant, compliments: updated.compliments, complimentedToday: updated.complimentedToday } : restaurant;
      }));
    } catch (error) {
      setLeaderError(
        error instanceof Error ? error.message : "排行榜暫時無法讀取。",
      );
    } finally {
      setLeaderBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // Establish the anonymous visitor cookie before requesting another endpoint.
    // A cancelled mount (including development Strict Mode) makes no API calls.
    const start = window.setTimeout(
      () => void loadNearby(TAIPEI_CENTER).then(loadLeaders),
      0,
    );
    return () => {
      window.clearTimeout(start);
      searchController.current?.abort();
    };
  }, [configured, loadNearby, loadLeaders]);

  const selectRestaurant = useCallback((id: string) => {
    setSelectedId(id);
    setNotice("");
    document
      .getElementById("explore")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function locate() {
    setError("");
    if (!navigator.geolocation) {
      setError("你的瀏覽器不支援定位，請使用行政區搜尋。");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(point);
        setDistrict("");
        setLocationLabel("你的位置附近");
        setLocating(false);
        void loadNearby(point);
      },
      (failure) => {
        setLocating(false);
        setError(
          failure.code === 1
            ? "定位權限未開啟。你可以在瀏覽器允許定位，或直接選擇行政區。"
            : "目前無法取得位置，請再試一次或選擇行政區。",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function compliment() {
    if (!selected || voteBusy || selected.complimentedToday) return;
    const id = selected.id;
    setVoteBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await requestJson<{
        compliments: number;
        complimentedToday: boolean;
        alreadyRecorded: boolean;
      }>("/api/compliments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: id }),
      });
      const update = (restaurants: Restaurant[]) =>
        restaurants.map((restaurant) =>
          restaurant.id === id
            ? {
                ...restaurant,
                compliments: result.compliments,
                complimentedToday: result.complimentedToday,
              }
            : restaurant,
        );
      setNearby(update);
      setLeaders(update);
      setNotice(
        result.alreadyRecorded
          ? "今天的稱讚已經記下來了，明天再來吃早餐吧！"
          : "記下來了！把這句甜甜的早安，留在地圖上。",
      );
      await loadLeaders();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "稱讚沒有儲存成功，請再試一次。",
      );
    } finally {
      setVoteBusy(false);
    }
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <SunLogo />
            <span>
              早餐被稱讚地圖<small>A LITTLE COMPLIMENT, A GOOD MORNING.</small>
            </span>
          </Link>
          <nav aria-label="主選單">
            <a href="#explore">找早餐店</a>
            <a href="#leaderboard">
              稱讚排行榜 <span>↗</span>
            </a>
          </nav>
          <span className="city-badge">
            <span /> 台北限定
          </span>
        </div>
      </header>

      <main className="page-wrap">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="mini-sun">✳</span>{" "}
              早餐加一句好聽的，今天就很可以。
            </div>
            <h1 id="hero-title">
              早安，<span>今天也被稱讚了嗎？</span>
            </h1>
            <p>
              一句「帥哥」、「美女」、「妹妹」，讓平凡的早餐多一點甜。
              <br className="desktop-break" />
              找到附近最會稱讚人的早餐店，把你的好心情留在地圖上。
            </p>
            <a href="#explore" className="hero-link">
              去找我的早安 <span>↓</span>
            </a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <span className="art-spark spark-one">✦</span>
            <span className="art-spark spark-two">✧</span>
            <div className="speech speech-one">帥哥，老樣子嗎？</div>
            <div className="speech speech-two">美女，早餐好了！</div>
            <div className="sun-character">
              <SunLogo size={143} />
            </div>
            <div className="art-caption">GOOD FOOD. NICE WORDS.</div>
          </div>
        </section>

        <section
          id="explore"
          className="explore-section"
          aria-labelledby="explore-title"
        >
          <div className="section-heading">
            <div>
              <span className="section-kicker">THE MORNING MAP</span>
              <h2 id="explore-title">
                下一站，好心情 <span>↗</span>
              </h2>
            </div>
            <span className="section-note">吃早餐，也收集一點小確幸。</span>
          </div>
          <div className="explore-grid">
            <aside className="restaurant-sidebar" aria-label="早餐店清單">
              <div className="sidebar-toolbar">
                <div className="sidebar-title">
                  <PinIcon />
                  <h3>投票附近的早餐店</h3>
                </div>
                <button
                  className="locate-button"
                  onClick={locate}
                  disabled={!configured || busy || locating}
                >
                  <LocationIcon />
                  {locating ? "定位中…" : "使用我的位置"}
                </button>
                <label className="district-label" htmlFor="district">
                  或選擇台北市行政區
                </label>
                <select
                  id="district"
                  value={district}
                  disabled={!configured || busy || locating || voteBusy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDistrict(value);
                    setLocationLabel(
                      value || (userLocation ? "你的位置附近" : "信義區附近"),
                    );
                    void loadNearby(userLocation ?? TAIPEI_CENTER, value);
                  }}
                >
                  <option value="">
                    {userLocation ? "我的位置附近" : "信義區附近"}
                  </option>
                  {DISTRICTS.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <div className="results-caption">
                  <span>{locationLabel}</span>
                  <span>{loaded && !busy ? `${nearby.length} 家` : "—"}</span>
                </div>
              </div>
              <div className="restaurant-scroll">
                {error && (
                  <div role="alert" className="inline-error">
                    {error}
                    <button
                      onClick={() => void loadNearby(center, district)}
                      disabled={busy}
                    >
                      重新搜尋
                    </button>
                  </div>
                )}
                {busy && (
                  <div className="empty-state">
                    <span className="spinner" />
                    <strong>正在找甜甜的早安…</strong>
                    <p>搜尋台北早餐店中</p>
                  </div>
                )}
                {!busy && selected && (
                  <div className="selected-restaurant">
                    <button
                      className="back-link"
                      onClick={() => {
                        setSelectedId(null);
                        setNotice("");
                      }}
                      disabled={voteBusy}
                    >
                      ← 返回早餐店
                    </button>
                    <div className="selected-icon">
                      <SparkIcon size={32} />
                    </div>
                    <span className="selected-eyebrow">
                      這家店的早安，有一點甜
                    </span>
                    <h3>{selected.name}</h3>
                    <p className="selected-address">{selected.address}</p>
                    <Attribution restaurants={[selected]} />
                    <div className="selected-count">
                      <strong>{selected.compliments.toLocaleString()}</strong>
                      <span>次被稱讚的好心情</span>
                    </div>
                    <p className="compliment-description">
                      我被稱讚為帥哥、美女、妹妹等等
                    </p>
                    <button
                      className="compliment-button"
                      onClick={() => void compliment()}
                      disabled={voteBusy || selected.complimentedToday}
                    >
                      <SparkIcon />
                      {voteBusy ? "正在記錄…" : "我被稱讚了"}
                    </button>
                    <p className="vote-note">
                      {selected.complimentedToday
                        ? "今天已記錄，明天再收集一句早安。"
                        : "每家店每天一次，留給真實的好心情。"}
                    </p>
                    {notice && (
                      <p className="success-notice" role="status">
                        {notice}
                      </p>
                    )}
                  </div>
                )}
                {!busy && !selected && !nearby.length && (
                  <div className="empty-state">
                    <div className="empty-sun">
                      <SunLogo />
                    </div>
                    <strong>
                      {configured
                        ? error
                          ? "早安，稍等一下"
                          : "這裡還沒找到早餐店"
                        : "餐廳暫時無法讀取"}
                    </strong>
                    <p>
                      {configured
                        ? "試試另一個行政區，或移動地圖後搜尋。"
                        : "請稍後再試。"}
                    </p>
                  </div>
                )}
                {!busy &&
                  !selected &&
                  nearby.map((restaurant) => (
                    <button
                      className="restaurant-row"
                      key={restaurant.id}
                      onClick={() => selectRestaurant(restaurant.id)}
                    >
                      <div className="restaurant-row-main">
                        <h4>{restaurant.name}</h4>
                        <p>
                          <PinIcon size={13} />
                          {formatDistance(restaurant.distanceMeters)}
                          <span>·</span>
                          {restaurant.address.replace(
                            /^.*?(?:台北市|臺北市)/,
                            "",
                          )}
                        </p>
                      </div>
                      <div className="restaurant-row-count">
                        <strong>{restaurant.compliments}</strong>
                        <span>次稱讚</span>
                      </div>
                    </button>
                  ))}
              </div>
              <div className="sidebar-footer">
                {limitReached
                  ? "Google 搜尋有結果上限，試試更小的區域。"
                  : "搜尋結果可能不包含所有早餐店。"}
                {nearby.length > 0 && <Attribution restaurants={nearby} />}
              </div>
            </aside>
            <div className="map-panel">
              {configured ? (
                <GoogleMap
                  center={center}
                  userLocation={userLocation}
                  restaurants={allRestaurants}
                  selectedId={selectedId}
                  onSelect={selectRestaurant}
                  busy={busy || voteBusy}
                  onSearch={(point) => {
                    setDistrict("");
                    setLocationLabel("地圖選定位置附近");
                    void loadNearby(point);
                  }}
                />
              ) : (
                <div className="unavailable-map" role="status">
                  <div className="empty-state">
                    <PinIcon size={32} />
                    <strong>地圖暫時無法使用</strong>
                    <p>請稍後再試。</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="below-map">
            <span>
              <span className="green-dot" />{" "}
              定位只用來找附近的店，不會儲存你的位置。
            </span>
            <span>稱讚次數來自本站使用者，與 Google 評分無關。</span>
          </div>
        </section>

        <section
          id="leaderboard"
          className="leaderboard-section"
          aria-labelledby="leaderboard-title"
        >
          <div className="section-heading">
            <div>
              <span className="section-kicker">THE COMPLIMENT CLUB</span>
              <h2 id="leaderboard-title">
                最會稱讚人的早餐店 <span className="heading-spark">✧</span>
              </h2>
              <p className="section-description">
                不是米其林，是讓你嘴角上揚的那一句。
              </p>
            </div>
            <span className="leaderboard-badge">✦ 累積稱讚 TOP 10</span>
          </div>
          {leaderError && (
            <div className="inline-error" role="alert">
              {leaderError}
              <button disabled={leaderBusy} onClick={() => void loadLeaders()}>
                重新載入排行榜
              </button>
            </div>
          )}
          {leaderBusy ? (
            <div className="leaderboard-empty">
              <span className="spinner" />
              正在整理好心情排行榜…
            </div>
          ) : leaders.length ? (
            <>
              <div className="podium-grid">
                {leaders.slice(0, 3).map((restaurant, index) => (
                  <button
                    className={`podium-card podium-${index + 1}`}
                    key={restaurant.id}
                    onClick={() => selectRestaurant(restaurant.id)}
                  >
                    <div className="podium-top">
                      <span className="rank-number">0{index + 1}</span>
                      <span>
                        {
                          ["早安甜度冠軍", "好心情製造所", "嘴角上揚專家"][
                            index
                          ]
                        }
                      </span>
                      <SparkIcon />
                    </div>
                    <h3>{restaurant.name}</h3>
                    <p>{restaurant.address}</p>
                    <div className="podium-bottom">
                      <span>
                        <strong>
                          {restaurant.compliments.toLocaleString()}
                        </strong>{" "}
                        次稱讚
                      </span>
                      <span className="round-arrow">↗</span>
                    </div>
                  </button>
                ))}
              </div>
              {leaders.length > 3 && (
                <div className="leaderboard-rows">
                  {leaders.slice(3).map((restaurant, index) => (
                    <button
                      className="leaderboard-row"
                      key={restaurant.id}
                      onClick={() => selectRestaurant(restaurant.id)}
                    >
                      <span className="small-rank">
                        {String(index + 4).padStart(2, "0")}
                      </span>
                      <span className="leaderboard-name">
                        {restaurant.name}
                        <small>{restaurant.address}</small>
                      </span>
                      <strong>
                        {restaurant.compliments}
                        <small> 次稱讚</small>
                      </strong>
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              )}
              <Attribution restaurants={leaders} />
            </>
          ) : (
            <div className="leaderboard-empty">
              <div className="empty-star">
                <SparkIcon size={28} />
              </div>
              <div>
                <h3>{configured ? "第一句稱讚，就從你開始。" : "排行榜暫時無法讀取"}</h3>
                <p>
                  {configured
                    ? "記錄一次被稱讚的早餐，讓喜歡的店登上排行榜。"
                    : "請稍後再試。"}
                </p>
              </div>
              <span className="empty-quote">「美女，早餐好了！」</span>
            </div>
          )}
          <p className="ranking-note">
            依本站累積稱讚次數排序，同分時以最早收到稱讚的店優先。這是人氣紀錄，不代表被稱讚的機率。
          </p>
        </section>

        <section className="how-it-works" aria-label="如何使用">
          <span className="how-title">一份早餐，三個小步驟。</span>
          <div>
            <span>01</span> 找到附近的早餐店
          </div>
          <i>→</i>
          <div>
            <span>02</span> 收到一句好聽的話
          </div>
          <i>→</i>
          <div>
            <span>03</span> 按下「我被稱讚了」
          </div>
          <SparkIcon />
        </section>
      </main>
      <footer className="site-footer">
        <div>
          <SunLogo />
          <span>
            早餐被稱讚地圖<small>願你的每一天，都從一句好聽的話開始。</small>
          </span>
        </div>
        <nav>
          <Link href="/privacy">隱私權</Link>
          <Link href="/terms">使用條款</Link>
        </nav>
        <span>MADE FOR GOOD MORNINGS.</span>
      </footer>
    </>
  );
}
