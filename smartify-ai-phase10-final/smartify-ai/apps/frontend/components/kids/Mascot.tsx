"use client";

import type { CSSProperties } from "react";

/**
 * "Smarty" — the SMARTIFY robot (graduation cap, dark visor, glowing
 * eyes, headphones), drawn as inline SVG so every mood is pure CSS:
 * no image/animation assets to download on cheap phones.
 *
 * All motion lives in globals.css under `sf-kid-*` and is switched off
 * by `prefers-reduced-motion` and by the in-app "effects off" toggle
 * (`html.sf-fx-calm`).
 */
export type MascotMood =
  | "idle"
  | "wave"
  | "point"
  | "think"
  | "happy"
  | "cheer"
  | "clap"
  | "encourage"
  | "sleep";

interface MascotProps {
  mood?: MascotMood;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label; decorative (aria-hidden) when omitted. */
  label?: string;
}

export function Mascot({ mood = "idle", size = 120, className = "", style, label }: MascotProps) {
  const eyesClosedHappy = mood === "happy" || mood === "cheer" || mood === "clap";
  const wink = mood === "wave" || mood === "point";
  const sleeping = mood === "sleep";

  return (
    <svg
      viewBox="0 0 200 230"
      width={size}
      height={(size * 230) / 200}
      className={`sf-kid-mascot sf-kid-mood-${mood} ${className}`}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id="sfm-helmet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbe7ff" />
        </linearGradient>
        <linearGradient id="sfm-cap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id="sfm-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id="sfm-glow">
          <stop offset="0" stopColor="#a5f3fc" />
          <stop offset="1" stopColor="#22d3ee" />
        </radialGradient>
      </defs>

      <g className="sf-kid-bob">
        {/* body + arms */}
        <g className="sf-kid-body">
          <rect x="62" y="168" width="76" height="50" rx="22" fill="url(#sfm-body)" />
          <circle cx="100" cy="190" r="9" fill="#a5f3fc" opacity="0.9" />
          <g className="sf-kid-arm-left">
            <rect x="34" y="172" width="34" height="16" rx="8" fill="#3b82f6" />
            <circle cx="34" cy="180" r="10" fill="#ffffff" stroke="#3b82f6" strokeWidth="3" />
          </g>
          <g className="sf-kid-arm-right">
            <rect x="132" y="172" width="34" height="16" rx="8" fill="#3b82f6" />
            <circle cx="166" cy="180" r="10" fill="#ffffff" stroke="#3b82f6" strokeWidth="3" />
          </g>
        </g>

        {/* head */}
        <g className="sf-kid-head">
          {/* headphones */}
          <rect x="18" y="92" width="22" height="46" rx="11" fill="#2563eb" />
          <rect x="160" y="92" width="22" height="46" rx="11" fill="#2563eb" />
          <circle cx="29" cy="115" r="6" fill="#22d3ee" />
          <circle cx="171" cy="115" r="6" fill="#22d3ee" />

          <ellipse cx="100" cy="115" rx="70" ry="58" fill="url(#sfm-helmet)" stroke="#bfd3ff" strokeWidth="3" />
          <rect x="50" y="82" width="100" height="66" rx="32" fill="#0b1530" />

          {/* eyes */}
          {sleeping ? (
            <g stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" fill="none">
              <path d="M70 114 q10 6 20 0" />
              <path d="M110 114 q10 6 20 0" />
            </g>
          ) : eyesClosedHappy ? (
            <g stroke="#22d3ee" strokeWidth="6" strokeLinecap="round" fill="none">
              <path d="M68 116 q12 -14 24 0" />
              <path d="M108 116 q12 -14 24 0" />
            </g>
          ) : (
            <g className={mood === "think" ? "sf-kid-eyes-look" : "sf-kid-eyes"}>
              <ellipse cx="80" cy="112" rx="10" ry="13" fill="url(#sfm-glow)" />
              {wink ? (
                <path d="M110 114 q10 -10 20 0" stroke="#22d3ee" strokeWidth="6" strokeLinecap="round" fill="none" />
              ) : (
                <ellipse cx="120" cy="112" rx="10" ry="13" fill="url(#sfm-glow)" />
              )}
            </g>
          )}

          {/* mouth */}
          {mood === "think" ? (
            <circle cx="100" cy="134" r="4" fill="#22d3ee" />
          ) : mood === "cheer" || mood === "clap" ? (
            <path d="M86 128 q14 16 28 0 z" fill="#22d3ee" />
          ) : (
            <path d="M88 130 q12 10 24 0" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" fill="none" />
          )}

          {/* cheeks */}
          <circle cx="62" cy="134" r="5" fill="#f9a8d4" opacity="0.55" />
          <circle cx="138" cy="134" r="5" fill="#f9a8d4" opacity="0.55" />

          {/* graduation cap */}
          <g className="sf-kid-cap">
            <path d="M62 62 h76 v14 q-38 12 -76 0 z" fill="#1e3a8a" />
            <polygon points="100,22 172,48 100,74 28,48" fill="url(#sfm-cap)" />
            <g className="sf-kid-tassel">
              <path d="M100 48 L160 56 L160 82" stroke="#0ea5e9" strokeWidth="3" fill="none" />
              <path d="M154 80 h12 l-2 14 h-8 z" fill="#0ea5e9" />
            </g>
            <circle cx="100" cy="48" r="4" fill="#0ea5e9" />
          </g>
        </g>
      </g>

      {/* mood extras */}
      {mood === "think" && (
        <g className="sf-kid-think-dots" fill="#7c3aed">
          <circle cx="160" cy="24" r="5" />
          <circle cx="176" cy="14" r="6" />
          <circle cx="192" cy="4" r="7" />
        </g>
      )}
      {sleeping && (
        <g className="sf-kid-zz" fill="#7c3aed" fontWeight="700" fontFamily="sans-serif">
          <text x="160" y="40" fontSize="20">z</text>
          <text x="176" y="22" fontSize="14">z</text>
        </g>
      )}
    </svg>
  );
}
