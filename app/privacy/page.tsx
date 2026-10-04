import Link from "next/link";
import { SunLogo } from "@/components/icons";

export default function PrivacyPage() {
  return (
    <main className="document-page">
      <Link href="/" className="brand">
        <SunLogo />
        早餐被稱讚地圖
      </Link>
      <h1>隱私權政策</h1>
      <p>
        我們使用一個保存在瀏覽器 Cookie
        中的隨機識別碼，辨識同一瀏覽器當天是否已為某家店記錄稱讚。Cookie
        最長保留一年。稱讚資料包含店家的 Google Place
        ID、隨機識別碼、日期與時間，不需要姓名、電話或電子郵件。
      </p>
      <p>
        按下「使用我的位置」後，瀏覽器會詢問定位權限。位置用於搜尋附近餐廳，會傳到本站伺服器，並以搜尋範圍傳給
        Google。我們不會儲存你的定位座標。地圖由 Google 提供，Google
        可能依其政策處理 IP、瀏覽器資訊與地圖互動。
      </p>
      <p>
        為避免重複操作及控制查詢額度，本站會儲存匿名操作次數。稱讚的累積次數會公開顯示。清除
        Cookie 會失去原本瀏覽器的識別碼，但不會自動刪除先前的匿名稱讚紀錄。
      </p>
      <p>
        使用 Google Maps 功能時，也適用{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noreferrer"
        >
          Google 隱私權政策
        </a>
        。餐廳資料來自 Google Maps，稱讚次數是本站使用者自行回報。
      </p>
      <p>
        <Link href="/">← 回到地圖</Link>
      </p>
    </main>
  );
}
