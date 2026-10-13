"use client";

import { useEffect, useRef } from "react";
import { runLoop } from "@/lib/games/core";
import { readHeroPalette } from "@/lib/landing/heroPalette";
import { FRAG, VERT } from "./heroShader";

// The hero's backdrop: the desk under the lamp, drawn in WebGL2 behind the
// headline (heroShader.ts). The div is server-rendered and carries the same
// lamp as a CSS gradient, so first paint, no WebGL and no JavaScript all look
// the same minus the fibre and the sheet; the canvas is absolutely positioned
// and never moves content. The loop runs only while the hero is on screen
// and the tab is visible; under prefers-reduced-motion it draws ONE frame.
// A lost context, a missing WebGL2 or a shader that will not compile all
// leave the CSS fallback showing (data-hero-state="fallback").
//
// data-hero-state: pending → gl | static | fallback. data-hero-ready carries
// performance.now() of the first draw, for the harness's "text painted first"
// assertion; data-hero-frames is the draw count (every 15th), for its "the
// loop runs" assertion.

export default function HeroCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let disposed = false;
    let stop: (() => void) | null = null;
    let teardown: (() => void) | null = null;
    const setState = (s: "gl" | "static" | "fallback") => wrap.setAttribute("data-hero-state", s);

    // One frame after hydration, so the headline and the interviewer still
    // paint before any shader work.
    const frame = requestAnimationFrame(() => {
      if (disposed) return;
      const gl = canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
      });
      if (!gl) return setState("fallback");
      const program = buildProgram(gl);
      if (!program) return setState("fallback");
      gl.useProgram(program);

      const u = (name: string) => gl.getUniformLocation(program, name);
      const uRes = u("u_res");
      const uTime = u("u_time");
      const uLamp = u("u_lamp");
      const pal = readHeroPalette((n) => getComputedStyle(document.documentElement).getPropertyValue(n));
      gl.uniform3fv(u("u_bg"), pal.bg);
      gl.uniform3fv(u("u_desk"), pal.desk);
      gl.uniform3fv(u("u_amber"), pal.amber);
      gl.uniform3fv(u("u_amberHi"), pal.amberHi);
      gl.uniform1f(u("u_grain"), 0.025);

      const coarse = matchMedia("(pointer: coarse)").matches;
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;
      function fit() {
        const r = canvas!.getBoundingClientRect();
        const w = Math.max(1, Math.min(1920, Math.round(r.width * scale)));
        const h = Math.max(1, Math.round(r.height * scale));
        if (canvas!.width !== w || canvas!.height !== h) {
          canvas!.width = w;
          canvas!.height = h;
        }
        gl!.viewport(0, 0, w, h);
      }
      let time = 0;
      let odd = false;
      let frames = 0;
      function draw() {
        fit();
        // A frame count the harness can read; written every 15 frames so it costs nothing.
        if (++frames % 15 === 0) wrap!.setAttribute("data-hero-frames", String(frames));
        gl!.uniform2f(uRes, canvas!.width, canvas!.height);
        gl!.uniform1f(uTime, time);
        gl!.uniform2f(uLamp, 0.1 + 0.015 * Math.sin(time * 0.45), 0.92 + 0.01 * Math.cos(time * 0.31));
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      }
      // A phone draws every other frame: the lamp breathes over seconds, so
      // 30 fps is invisible and half the GPU work.
      function drawMaybe() {
        if (coarse) {
          odd = !odd;
          if (odd) return;
        }
        draw();
      }
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      let inView = true;
      const shouldRun = () => !reduced.matches && inView && !document.hidden;
      function sync() {
        if (shouldRun()) {
          if (!stop) stop = runLoop((dt) => { time += dt; }, drawMaybe);
        } else if (stop) {
          stop();
          stop = null;
        }
      }
      function still() {
        time = 3;
        draw();
        setState("static");
      }

      if (reduced.matches) still();
      else {
        draw();
        setState("gl");
      }
      wrap.setAttribute("data-hero-ready", String(Math.round(performance.now())));
      sync();

      const onVisibility = () => sync();
      document.addEventListener("visibilitychange", onVisibility);
      const io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { threshold: 0 });
      io.observe(wrap);
      const ro = new ResizeObserver(() => { if (!stop) draw(); });
      ro.observe(wrap);
      const onReduced = () => {
        if (reduced.matches) {
          if (stop) { stop(); stop = null; }
          still();
        } else {
          setState("gl");
          sync();
        }
      };
      reduced.addEventListener("change", onReduced);
      const onLost = (e: Event) => {
        e.preventDefault();
        if (stop) { stop(); stop = null; }
        setState("fallback");
      };
      canvas.addEventListener("webglcontextlost", onLost);
      teardown = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        io.disconnect();
        ro.disconnect();
        reduced.removeEventListener("change", onReduced);
        canvas.removeEventListener("webglcontextlost", onLost);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (stop) stop();
      teardown?.();
    };
  }, []);

  return (
    <div ref={wrapRef} className="lpHeroBackdrop" data-hero-state="pending" aria-hidden="true">
      <canvas ref={canvasRef} className="lpHeroCanvas" />
    </div>
  );
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("[HeroCanvas] shader:", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[HeroCanvas] link:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
