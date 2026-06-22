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
    <div className="relative w-full max-w-3xl rounded-lg border border-white/10 bg-slate-900 p-3 shadow-xl sm:p-4">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss location suggestion"
        className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-500/25 hover:text-white sm:right-3 sm:top-3"
      >
        <X size={16} />
      </button>

      <div className="flex items-center gap-2 pr-7 sm:gap-4 sm:pr-8">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-slate-300 sm:h-12 sm:w-12 sm:rounded-lg">
            <MapPin size={19} />
          </div>

          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white sm:text-base">
              {location
                ? "Location shared"
                : "Use your location"}
            </h2>
            <p className="mt-1 hidden text-sm leading-5 text-slate-400 sm:block">
              {location
                ? "Future recommendations can use your approximate area. Confirm the delivery city before checkout."
                : "Get recommendations based on your approximate area. We only ask when you choose to share."}
            </p>
          </div>
        </div>

        {location ? (
          <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-purple-500/15 px-3 text-xs font-semibold text-purple-300 sm:h-auto sm:px-4 sm:py-2.5 sm:text-sm">
            <Check size={17} />
            Shared
          </div>
        ) : (
          <button
            type="button"
            onClick={shareLocation}
            disabled={status === "loading"}
            className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-slate-100 px-3 text-xs font-semibold text-slate-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-70 sm:h-auto sm:px-5 sm:py-2.5 sm:text-sm"
          >
            {status === "loading" && (
              <LoaderCircle size={17} className="animate-spin" />
            )}
            {status === "loading" ? "Locating..." : "Use location"}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-amber-200 sm:mt-3 sm:text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
