import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Cortex Log — Technical Reading Tracker & Anki Companion",
  description:
    "Log daily engineering blogs on a streak calendar, chunk and extract detail-level flashcards via a message queue, and sync curated cards to Anki.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const envMap = process.env as Record<string, string | undefined>;
  const runtimeApiUrl =
    envMap["BACKEND_API_URL"] || envMap["NEXT_PUBLIC_API_URL"] || "";
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {runtimeApiUrl ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__CORTEX_API_URL__ = ${JSON.stringify(
                runtimeApiUrl.replace(/\/$/, "")
              )};`,
            }}
          />
        ) : null}
      </head>
      <body className="font-sans antialiased selection:bg-ink selection:text-manila-card">
        {children}
      </body>
    </html>
  );
}
