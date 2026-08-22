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
    default: "StudyUS | AI Learning Platform for Concept Mastery",
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "StudyUS helps students understand difficult concepts, close knowledge gaps, and improve academic performance with personalized AI-powered learning.",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/icon.png",
  },
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
