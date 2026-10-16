import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function bandOf(score: number): { band: "low" | "moderate" | "high"; label: string; color: string } {
  if (score >= 75) return { band: "high", label: "High ATS pass rate", color: "hsl(var(--good))" };
  if (score >= 60) return { band: "moderate", label: "Moderate", color: "hsl(var(--warn))" };
  return { band: "low", label: "Low", color: "hsl(var(--bad))" };
}
