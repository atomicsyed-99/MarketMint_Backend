import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ad Swipe File",
  description: "Searchable ad creative library with AI analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <nav className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}>
          <Link href="/search" className="text-lg font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Ad Swipe File
          </Link>
          <div className="flex gap-4">
            <Link href="/search" className="text-sm hover:opacity-80" style={{ color: 'var(--muted)' }}>
              Search
            </Link>
            <Link href="/import" className="text-sm hover:opacity-80" style={{ color: 'var(--muted)' }}>
              Import
            </Link>
          </div>
        </nav>
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
