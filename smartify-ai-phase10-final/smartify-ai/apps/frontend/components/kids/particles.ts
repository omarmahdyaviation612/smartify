"use client";

import { fxMotionEnabled } from "./fx-prefs";

/**
 * Dependency-free celebration particles on one full-screen canvas.
 * The canvas is created on demand, ignores pointer events, and removes
 * itself when the last particle is gone. Particle counts are capped and
 * the device-pixel-ratio is clamped so low-end Android phones stay smooth.
 */
export type ParticleEffect = "confetti" | "glitter" | "fireworks" | "stars" | "sparkle";

const COLORS = ["#2563eb", "#7c3aed", "#22d3ee", "#f472b6", "#facc15", "#34d399", "#fb923c"];
const GLITTER = ["#fde68a", "#facc15", "#ffffff", "#f5d0fe", "#a5f3fc", "#fbcfe8"];

interface P {
  x: number; y: number; vx: number; vy: number;
  size: number; rot: number; vr: number;
  color: string; life: number; maxLife: number;
  shape: "rect" | "circle" | "star" | "twinkle";
  gravity: number; drag: number; wobble: number;
}

let canvas: HTMLCanvasElement | null = null;
let c2d: CanvasRenderingContext2D | null = null;
let particles: P[] = [];
let raf = 0;
let dpr = 1;
const MAX = 420;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "60" });
  document.body.appendChild(canvas);
  c2d = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}

function teardown() {
  cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener("resize", resize);
  canvas?.remove();
  canvas = null;
  c2d = null;
  particles = [];
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function add(p: Partial<P> & Pick<P, "x" | "y">) {
  if (particles.length >= MAX) return;
  particles.push({
    vx: 0, vy: 0, size: 6, rot: rand(0, Math.PI * 2), vr: rand(-0.2, 0.2),
    color: pick(COLORS), life: 0, maxLife: 180, shape: "rect", gravity: 0.12, drag: 0.99, wobble: rand(0, 10),
    ...p,
  });
}

function drawStar(ctx: CanvasRenderingContext2D, r: number, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

function frame() {
  if (!c2d || !canvas) return;
  const ctx = c2d;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  particles = particles.filter((p) => p.life < p.maxLife && p.y < h + 40);
  for (const p of particles) {
    p.life++;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx + Math.sin((p.life + p.wobble) / 12) * (p.shape === "rect" ? 0.8 : 0.3);
    p.y += p.vy;
    p.rot += p.vr;

    const fade = Math.min(1, (p.maxLife - p.life) / 40);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === "twinkle") {
      ctx.globalAlpha = fade * (0.45 + 0.55 * Math.abs(Math.sin((p.life + p.wobble * 10) / 6)));
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      drawStar(ctx, p.size, 4, 0.3);
    } else {
      ctx.globalAlpha = fade;
      if (p.shape === "rect") {
        ctx.scale(1, Math.abs(Math.cos((p.life + p.wobble) / 8)) + 0.15);
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        drawStar(ctx, p.size);
      }
    }
    ctx.restore();
  }

  if (particles.length === 0) teardown();
  else raf = requestAnimationFrame(frame);
}

function start() {
  if (!raf) raf = requestAnimationFrame(frame);
}

/** Fire an effect. No-op when motion is reduced or effects are switched off. */
export function burst(effect: ParticleEffect, origin?: { x: number; y: number }) {
  if (typeof window === "undefined" || !fxMotionEnabled()) return;
  ensureCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const small = w < 640;

  switch (effect) {
    case "confetti": {
      const n = small ? 140 : 220;
      for (let i = 0; i < n; i++) {
        const fromLeft = i % 2 === 0;
        add({
          x: fromLeft ? rand(-10, w * 0.1) : rand(w * 0.9, w + 10),
          y: rand(h * 0.55, h * 0.8),
          vx: (fromLeft ? 1 : -1) * rand(3, 9),
          vy: rand(-15, -8),
          size: rand(7, 12),
          shape: Math.random() < 0.75 ? "rect" : "circle",
          gravity: 0.25, drag: 0.985, maxLife: 260,
        });
      }
      break;
    }
    case "glitter": {
      const n = small ? 170 : 260;
      for (let i = 0; i < n; i++) {
        add({
          x: rand(0, w), y: rand(-h * 0.6, -10),
          vx: rand(-0.4, 0.4), vy: rand(1, 2.6),
          size: rand(2.5, 6), shape: "twinkle", color: pick(GLITTER),
          gravity: 0.015, drag: 0.995, vr: rand(-0.05, 0.05), maxLife: 320,
        });
      }
      break;
    }
    case "fireworks": {
      const bursts = small ? 4 : 6;
      for (let b = 0; b < bursts; b++) {
        setTimeout(() => {
          if (!canvas) ensureCanvas();
          const cx = rand(w * 0.15, w * 0.85);
          const cy = rand(h * 0.15, h * 0.45);
          const color = pick(COLORS);
          for (let i = 0; i < 46; i++) {
            const a = (i / 46) * Math.PI * 2;
            const sp = rand(3, 6.5);
            add({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: rand(3, 5), shape: "circle", color: Math.random() < 0.8 ? color : "#ffffff", gravity: 0.07, drag: 0.975, maxLife: 90 });
          }
          start();
        }, b * 380);
      }
      break;
    }
    case "stars": {
      const n = small ? 26 : 40;
      for (let i = 0; i < n; i++) {
        add({ x: rand(0, w), y: rand(-h * 0.5, -20), vx: rand(-0.6, 0.6), vy: rand(1.5, 3.5), size: rand(10, 18), shape: "star", color: pick(["#facc15", "#fbbf24", "#fde047"]), gravity: 0.03, drag: 0.995, vr: rand(-0.06, 0.06), maxLife: 300 });
      }
      break;
    }
    case "sparkle": {
      const ox = origin?.x ?? w / 2;
      const oy = origin?.y ?? h / 2;
      for (let i = 0; i < 26; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(1.5, 4.5);
        add({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, size: rand(3, 6), shape: "twinkle", color: pick(GLITTER), gravity: 0.05, drag: 0.96, maxLife: 70 });
      }
      break;
    }
  }
  start();
}

/** Sparkle burst centred on an element (e.g. the button the child just tapped). */
export function sparkleAt(el: Element | null) {
  if (!el) return burst("sparkle");
  const r = el.getBoundingClientRect();
  burst("sparkle", { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}
