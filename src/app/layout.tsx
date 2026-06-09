import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steam Tracker Notion",
  description: "Sync your Steam data to Notion",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
