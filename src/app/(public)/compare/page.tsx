import type { Metadata } from "next";
import CompareGuestClient from "@/components/CompareGuestClient";

export const metadata: Metadata = {
  title: "Compare paintings",
  description: "Side-by-side comparison tool for amateur painters. Drop in your work-in-progress and a reference photo.",
  robots: { index: false, follow: false },
};

export default function ComparePage() {
  return <CompareGuestClient />;
}
