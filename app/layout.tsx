import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "早餐被稱讚地圖｜台北的早安，甜一點",
  description:
    "找到附近的台北早餐店，記錄一句帥哥、美女、妹妹，看看哪家店最會稱讚人。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
