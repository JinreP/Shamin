import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Shamin Agent | Pi",
  description: "Таны AI худалдааны туслах",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="mn">
      <body>{children}</body>
    </html>
  );
}
