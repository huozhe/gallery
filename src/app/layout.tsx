import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gallery",
  description: "A portfolio of paintings and drawings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans text-neutral-900 bg-white">
        <Nav />
        {children}
      </body>
    </html>
  );
}
