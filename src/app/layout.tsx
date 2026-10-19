import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Villa Ledger · Финансы портфеля",
  description: "Начисления, поступления и качество данных по виллам",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
