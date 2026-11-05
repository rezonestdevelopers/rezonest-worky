"use client";

import { useEffect } from "react";

/** Lets the app be installed, and shows a friendly page with no connection. Live builds only. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((e) => console.error("Couldn't set up the installable app", e));
  }, []);
  return null;
}
