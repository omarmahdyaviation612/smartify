"use client";

import { fxSoundEnabled } from "./fx-prefs";

/**
 * Tiny synthesized sound effects (Web Audio) — no audio files to download.
 *
 * Browsers only allow audio that was unlocked by a user gesture, and our
 * celebrations fire AFTER an awaited network call. So call `unlockSounds()`
 * synchronously inside the click/submit handler, before the `await`.
 */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

export function unlockSounds() {
  if (!fxSoundEnabled()) return;
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

function tone(c: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.18) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function noiseBurst(c: AudioContext, start: number, dur: number, gain: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1200 + Math.random() * 1400;
  bp.Q.value = 0.9;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(start);
}

export type SoundName = "ding" | "sparkle" | "fanfare" | "clap" | "pop";

export function playSound(name: SoundName) {
  if (!fxSoundEnabled()) return;
  const c = getCtx();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.02;
  switch (name) {
    case "pop":
      tone(c, 660, t, 0.08, "triangle", 0.12);
      break;
    case "ding":
      tone(c, 1318.5, t, 0.25);
      tone(c, 1975.5, t + 0.09, 0.35);
      break;
    case "sparkle":
      for (let i = 0; i < 7; i++) tone(c, 1800 + Math.random() * 1600, t + i * 0.07, 0.18, "sine", 0.07);
      break;
    case "fanfare":
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, t + i * 0.12, i === 3 ? 0.6 : 0.16, "triangle", 0.16));
      break;
    case "clap": {
      // A short round of applause: many small claps, denser in the middle.
      for (let i = 0; i < 26; i++) {
        const at = t + Math.random() * 1.6;
        noiseBurst(c, at, 0.05 + Math.random() * 0.04, 0.35 + Math.random() * 0.3);
      }
      break;
    }
  }
}
