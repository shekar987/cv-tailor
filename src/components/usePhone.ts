"use client";
// Is this a phone-width screen (640px and below, the app's narrowest breakpoint)?
// For the few places where a phone needs a different ORDER of elements or a different
// default, which CSS alone cannot give without the reading order and the tab order
// disagreeing. The server and the first paint answer false; the real answer follows at once.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 640px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
