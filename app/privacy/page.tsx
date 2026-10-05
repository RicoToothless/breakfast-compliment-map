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
        地圖與排行榜可以直接瀏覽。投票需使用 Google 登入，我們會儲存 Google
        提供的帳號識別資料、姓名、電子郵件與頭像，以及登入工作階段。
        帳號資料用於辨識投票者，不會公開顯示在排行榜。
        每個帳號每天只能投一票，日期以台北時間計算。 稱讚紀錄包含店家的 Google
        Place ID、帳號識別碼、日期與時間。
      </p>
      <p>
        只有按下「使用我的位置」時，瀏覽器才會詢問定位權限。投票不需要定位。
        取得位置後會自動搜尋附近餐廳，定位座標會傳到本站伺服器，搜尋範圍也會傳給
        Google。我們不會將你的定位座標寫入資料庫。地圖由 Google 提供，Google
        可能依其政策處理 IP、瀏覽器資訊與地圖互動。
      </p>
      <p>
        收藏只儲存在目前瀏覽器，包含 Google Place ID 與你自行輸入的收藏名稱。
        最近搜尋文字也會保留在這台裝置。 我們不會把 Google
        提供的店名、地址或座標存入收藏；清除瀏覽器網站資料會移除收藏與偏好。
      </p>
      <p>
        我們使用 Cookie 維持登入，並使用最長保留一年的匿名 Cookie
        控制查詢頻率。登入工作階段通常保留七天，使用時可能更新。 清除 Cookie
        或登出不會刪除投票紀錄，也不會重設當日的投票額度。
        只有店家的累積稱讚次數會公開顯示。
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
