import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import "./globals.css";

// No `weight` array: Inter is a variable font, so omitting it keeps
// the full weight axis available (the app uses in-between weights
// like 650 in a few places) instead of only discrete static cuts.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Don't study more. Study better.`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "StudyUs is an adaptive study coach: it finds what you need, focuses you on what matters today and checks that you can do it on your own, remember it and apply it.",
  robots: {
    index: true,
    follow: true,
  },
  // Icons come from the Next.js file conventions (src/app/favicon.ico, icon.png, apple-icon.png): hashed URLs, no stale favicon.
  applicationName: SITE_NAME,
  appleWebApp: { title: SITE_NAME },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={inter.variable}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
