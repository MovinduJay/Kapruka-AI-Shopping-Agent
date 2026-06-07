"use client";

import { useState } from "react";
import { Check, LoaderCircle, MapPin, X } from "lucide-react";

export type SharedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type Props = {
  location: SharedLocation | null;
  onLocationShared: (location: SharedLocation) => void;
  onDismiss: () => void;
};

type LocationStatus = "idle" | "loading" | "error";

export function LocationPrompt({
  location,
  onLocationShared,
  onDismiss,
}: Props) {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [error, setError] = useState("");

  function shareLocation() {
    if (!navigator.geolocation || status === "loading") {
      if (!navigator.geolocation) {
        setStatus("error");
        setError("Location sharing is not supported by this browser.");
      }

      return;
    }

    setStatus("loading");
    setError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        onLocationShared({
          latitude: Number(position.coords.latitude.toFixed(3)),
          longitude: Number(position.coords.longitude.toFixed(3)),
          accuracy: Math.round(position.coords.accuracy),
        });
        setStatus("idle");
      },
      (locationError) => {
        setStatus("error");
        setError(
          locationError.code === locationError.PERMISSION_DENIED
            ? "Location permission was denied. You can still type your delivery city."
            : "We could not get your location. Please try again or type your city."
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  }

  return (
    <div className="relative w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-900 p-4 shadow-xl">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss location suggestion"
        className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-500/25 hover:text-white"
      >
        <X size={16} />
      </button>

      <div className="flex flex-col gap-4 pr-8 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-300">
            <MapPin size={21} />
          </div>

          <div className="min-w-0">
            <h2 className="font-semibold text-white">
              {location
                ? "Location shared"
                : "Share your location for better results"}
            </h2>
            <p className="mt-1 text-sm leading-5 text-slate-400">
              {location
                ? "Future recommendations can use your approximate area. Confirm the delivery city before checkout."
                : "Get recommendations based on your approximate area. We only ask when you choose to share."}
            </p>
          </div>
        </div>

        {location ? (
          <div className="flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-300">
            <Check size={17} />
            Shared
          </div>
        ) : (
          <button
            type="button"
            onClick={shareLocation}
            disabled={status === "loading"}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-70"
          >
            {status === "loading" && (
              <LoaderCircle size={17} className="animate-spin" />
            )}
            {status === "loading" ? "Locating..." : "Share location"}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          {error}
        </p>
      )}
    </div>
  );
}
