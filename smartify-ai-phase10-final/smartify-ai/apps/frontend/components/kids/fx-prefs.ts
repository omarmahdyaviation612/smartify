"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-device "fun effects" preferences. Browser storage is only a
 * convenience here: if it is unavailable everything falls back to ON,
 * and `prefers-reduced-motion` always wins for motion.
 */
const SOUND_KEY = "smartify_fx_sound";
const MOTION_KEY = "smartify_fx_motion";
const EVENT = "smartify-fx-prefs";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

function write(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function fxSoundEnabled(): boolean {
  return typeof window !== "undefined" && read(SOUND_KEY);
}

export function fxMotionEnabled(): boolean {
  return typeof window !== "undefined" && read(MOTION_KEY) && !systemPrefersReducedMotion();
}

function applyCalmClass() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("sf-fx-calm", !read(MOTION_KEY));
}

export function useFxPrefs() {
  const [sound, setSound] = useState(true);
  const [motion, setMotion] = useState(true);

  useEffect(() => {
    const sync = () => {
      setSound(read(SOUND_KEY));
      setMotion(read(MOTION_KEY));
      applyCalmClass();
    };
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const toggleSound = useCallback(() => {
    write(SOUND_KEY, !read(SOUND_KEY));
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const toggleMotion = useCallback(() => {
    write(MOTION_KEY, !read(MOTION_KEY));
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { sound, motion, toggleSound, toggleMotion };
}

/** Best score per activity on this device, used for "you beat your score!". */
export function readBest(scope: string): number | null {
  try {
    const raw = localStorage.getItem(`smartify_best_${scope}`);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeBest(scope: string, ratio: number) {
  try {
    const prev = readBest(scope);
    if (prev === null || ratio > prev) localStorage.setItem(`smartify_best_${scope}`, String(ratio));
  } catch {
    /* ignore */
  }
}

export function readLastVariant(): string | null {
  try {
    return localStorage.getItem("smartify_fx_last_variant");
  } catch {
    return null;
  }
}

export function writeLastVariant(v: string) {
  try {
    localStorage.setItem("smartify_fx_last_variant", v);
  } catch {
    /* ignore */
  }
}
