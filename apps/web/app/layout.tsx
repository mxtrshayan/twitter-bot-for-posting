import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Launchpad • X Browsers",
  description: "Your X account and five private headless browsers.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
