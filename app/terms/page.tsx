import Link from "next/link";
import { SunLogo } from "@/components/icons";

export default function TermsPage() {
  return (
    <main className="document-page">
      <Link href="/" className="brand">
        <SunLogo />
        早餐被稱讚地圖
      </Link>
      <h1>使用條款</h1>
      <p>
        請在實際收到店家的稱讚時記錄，避免重複灌票。每個瀏覽器每天可為每家店記錄一次。匿名紀錄無法驗證真實身分，排行榜代表使用者回報的累積次數，不保證店家品質或被稱讚的機率。
      </p>
      <p>
        Google
        搜尋可能遺漏早餐店，名稱、地址及營業狀態也可能變動。本站不保證清單完整或即時正確。
      </p>
      <p>
        使用本站地圖功能須遵守{" "}
        <a
          href="https://maps.google.com/help/terms_maps/"
          target="_blank"
          rel="noreferrer"
        >
          Google Maps／Google Earth 額外服務條款
        </a>
        ，並參閱{" "}
        <a
          href="https://policies.google.com/terms"
          target="_blank"
          rel="noreferrer"
        >
          Google 服務條款
        </a>
        。
      </p>
      <p>
        請勿自動大量查詢、偽造紀錄或干擾其他使用者。網站經營者得為維護服務限制濫用操作。
      </p>
      <p>
        <Link href="/">← 回到地圖</Link>
      </p>
    </main>
  );
}
