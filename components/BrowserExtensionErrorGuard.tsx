"use client";

import { useEffect } from "react";

function isMetaMaskExtensionError(reason: unknown) {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
  const stack = reason instanceof Error ? reason.stack || "" : "";
  const text = `${message}\n${stack}`;

  return (
    text.includes("Failed to connect to MetaMask") &&
    text.includes("chrome-extension://")
  );
}

export function BrowserExtensionErrorGuard() {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (isMetaMaskExtensionError(event.reason)) {
        event.preventDefault();
      }
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection
      );
    };
  }, []);

  return null;
}
