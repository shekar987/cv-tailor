"use client";

// The popup that opens the moment a full tailor starts: a progress bar for
// the real run, and a mini game to play while it goes (lib/games — the
// platformer on a user's 1st, 3rd… tailor, the flyer on the 2nd, 4th…).
// The bar is paced to a typical run and only fills when the real result
// arrives; then the game stops and the popup says so. Closing it never
// cancels the tailor.

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { VIEW_W, VIEW_H, emptyInput, runLoop, type Game, type GameKind, type InputState, type Palette } from "@/lib/games/core";
import { Platformer } from "@/lib/games/platformer";
import { Flyer } from "@/lib/games/flyer";
import { progressAt, EXPECTED_TAILOR_MS } from "@/lib/games/pick";

export type TailorGameStatus = "running" | "done" | "error";

type Props = {
  game: GameKind;
  startedAt: number;
  status: TailorGameStatus;
  error?: string;
  // Close without looking at the result (the run carries on if it hasn't finished).
  onClose: () => void;
  // "Back to my CV" after a successful run.
  onViewResult: () => void;
};

// The --game-* tokens in globals.css, read once per game.
function readPalette(): Palette {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(`--game-${name}`).trim();
  return {
    skyTop: v("sky-top"),
    skyBottom: v("sky-bottom"),
    hillFar: v("hill-far"),
    hillNear: v("hill-near"),
    cloud: v("cloud"),
    ground: v("ground"),
    groundTop: v("ground-top"),
    platform: v("platform"),
    platformTop: v("platform-top"),
    block: v("block"),
    blockEdge: v("block-edge"),
    spike: v("spike"),
    wall: v("wall"),
    wallEdge: v("wall-edge"),
    suit: v("suit"),
    suitShade: v("suit-shade"),
    shirt: v("shirt"),
    tie: v("tie"),
    skin: v("skin"),
    hair: v("hair"),
    shoe: v("shoe"),
    hud: v("hud"),
    hudShadow: v("hud-shadow"),
    font: getComputedStyle(document.body).fontFamily || "sans-serif",
  };
}

const KEYS: Record<string, "left" | "right" | "jump"> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
};

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function TailorGamePopup({ game, startedAt, status, error, onClose, onViewResult }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLButtonElement>(null);
  const rightRef = useRef<HTMLButtonElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<InputState>(emptyInput());
  const gameRef = useRef<Game | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const lastTouchRef = useRef(0);
  const closeRef = useRef(onClose);
  const [now, setNow] = useState(() => Date.now());
  // With reduced motion the game waits for "Play" instead of starting itself.
  const [paused, setPaused] = useState(reducedMotion);
  const running = status === "running";

  useEffect(() => {
    closeRef.current = onClose;
  });

  // The progress clock, only while the run is going.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  const progress = status === "done" ? 1 : progressAt(now - startedAt);
  const percent = Math.round(progress * 100);
  const slow = running && now - startedAt > EXPECTED_TAILOR_MS;

  // Focus moves into the popup and comes back where it was; the page behind
  // doesn't scroll while it's open.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // When the run ends, focus the notice's button.
  useEffect(() => {
    if (status !== "running") resultRef.current?.focus();
  }, [status]);

  // The game: built once, drawn crisply at the screen's pixel density.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const g: Game = game === "platformer" ? new Platformer() : new Flyer();
    const palette = readPalette();
    gameRef.current = g;
    paletteRef.current = palette;
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);
      g.render(ctx, palette);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      gameRef.current = null;
    };
  }, [game]);

  // The loop runs only while the tailor runs; the moment it ends, the game
  // halts on its last frame under the notice.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const g = gameRef.current;
    const palette = paletteRef.current;
    if (!running || paused || !ctx || !g || !palette) return;
    const stop = runLoop(
      (dt) => {
        g.update(dt, inputRef.current);
        inputRef.current.jumpPressed = false;
      },
      () => g.render(ctx, palette)
    );
    // A key or button still "held" when the window lost focus is let go.
    const release = () => {
      inputRef.current = emptyInput();
    };
    window.addEventListener("blur", release);
    return () => {
      stop();
      window.removeEventListener("blur", release);
    };
  }, [running, paused]);

  // Keyboard: arrows / WASD / Space play the game; they never scroll the page
  // behind. Escape closes; Tab stays inside the popup.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === "Tab") {
        const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []).filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      const key = KEYS[e.code];
      if (!key) return;
      // Space on a focused button (close, Play, Back to my CV) presses it.
      if (e.code === "Space" && e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      if (key === "jump") {
        if (!e.repeat) inputRef.current.jumpPressed = true;
      } else {
        inputRef.current[key] = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      const key = KEYS[e.code];
      if (key && key !== "jump") inputRef.current[key] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Touch: passive listeners (nothing to cancel, so no scroll or zoom lag);
  // the controls' touch-action: none keeps the browser from panning or
  // zooming. A mouse works the same buttons; the mouse events a phone
  // replays after a touch are ignored.
  useEffect(() => {
    const press = (key: "left" | "right" | "jump") => {
      if (key === "jump") inputRef.current.jumpPressed = true;
      else inputRef.current[key] = true;
    };
    const release = (key: "left" | "right" | "jump") => {
      if (key !== "jump") inputRef.current[key] = false;
    };
    const bindings: [HTMLElement | null, "left" | "right" | "jump"][] = [
      [leftRef.current, "left"],
      [rightRef.current, "right"],
      [jumpRef.current, "jump"],
      [canvasRef.current, "jump"],
    ];
    const cleanups: (() => void)[] = [];
    for (const [el, key] of bindings) {
      if (!el) continue;
      const touchStart = () => {
        lastTouchRef.current = Date.now();
        el.setAttribute("data-held", "");
        press(key);
      };
      const touchEnd = () => {
        el.removeAttribute("data-held");
        release(key);
      };
      const mouseDown = (e: MouseEvent) => {
        if (e.button !== 0 || Date.now() - lastTouchRef.current < 800) return;
        // The keyboard keeps playing after a click on an on-screen button.
        if (el !== canvasRef.current) e.preventDefault();
        press(key);
      };
      const mouseUp = () => {
        if (Date.now() - lastTouchRef.current < 800) return;
        release(key);
      };
      el.addEventListener("touchstart", touchStart, { passive: true });
      el.addEventListener("touchend", touchEnd, { passive: true });
      el.addEventListener("touchcancel", touchEnd, { passive: true });
      el.addEventListener("mousedown", mouseDown);
      el.addEventListener("mouseup", mouseUp);
      el.addEventListener("mouseleave", mouseUp);
      cleanups.push(() => {
        el.removeEventListener("touchstart", touchStart);
        el.removeEventListener("touchend", touchEnd);
        el.removeEventListener("touchcancel", touchEnd);
        el.removeEventListener("mousedown", mouseDown);
        el.removeEventListener("mouseup", mouseUp);
        el.removeEventListener("mouseleave", mouseUp);
      });
    }
    return () => cleanups.forEach((c) => c());
  }, [game]);

  const flyer = game === "flyer";
  const note =
    status === "done" ? "Done." : status === "error" ? "Stopped." : slow ? "Taking a little longer than usual…" : "Usually under a minute. Play while you wait.";

  return (
    <div className="gamePopup">
      <div className="gamePopup__backdrop" aria-hidden="true" />
      <div
        className="gamePopup__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gamePopupTitle"
        tabIndex={-1}
        ref={panelRef}
        data-game={game}
        data-game-status={status}
      >
        <div className="gamePopup__header">
          <h2 className="gamePopup__title" id="gamePopupTitle">
            Tailoring your CV
          </h2>
          <button type="button" className="gamePopup__close" onClick={onClose} aria-label="Close. Tailoring carries on." title="Close. Tailoring carries on." data-game-close>
            ×
          </button>
        </div>

        <div className="gamePopup__progress">
          <div className="gamePopup__bar" role="progressbar" aria-label="Tailoring progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span className="gamePopup__barFill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="gamePopup__progressMeta">
            <span className="gamePopup__percent" data-game-percent={percent}>
              {percent}%
            </span>
            <span>{note}</span>
          </div>
        </div>

        <div className="gamePopup__stage">
          <canvas
            ref={canvasRef}
            className="gamePopup__canvas"
            role="img"
            aria-label={flyer ? "Optional mini game: fly a figure in a suit through gaps in the walls." : "Optional mini game: run and jump a figure in a suit across platforms."}
          />
          {paused && running && (
            <div className="gamePopup__overlay">
              <Button onClick={() => setPaused(false)} data-game-play>
                Play
              </Button>
            </div>
          )}
          {status !== "running" && (
            <div className="gamePopup__overlay gamePopup__result" role="status" aria-live="polite" data-game-result={status}>
              {status === "done" ? (
                <>
                  <span className="gamePopup__resultIcon" aria-hidden="true">
                    ✓
                  </span>
                  <p className="gamePopup__resultText">
                    Your CV has been tailored successfully! <span>You can now go back.</span>
                  </p>
                  <Button ref={resultRef} onClick={onViewResult} data-game-done>
                    Back to my CV
                  </Button>
                </>
              ) : (
                <>
                  <p className="gamePopup__resultText">Tailoring didn&rsquo;t finish.</p>
                  {error && <p className="gamePopup__resultDetail">{error}</p>}
                  <Button ref={resultRef} variant="secondary" onClick={onClose} data-game-back>
                    Back
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="gamePopup__controls" data-game-controls>
          <div className="gamePopup__controlGroup">
            {!flyer && (
              <>
                <button type="button" ref={leftRef} className="gameTouch" aria-label="Move left" tabIndex={-1}>
                  ◀
                </button>
                <button type="button" ref={rightRef} className="gameTouch" aria-label="Move right" tabIndex={-1}>
                  ▶
                </button>
              </>
            )}
          </div>
          <button type="button" ref={jumpRef} className="gameTouch gameTouch--jump" aria-label={flyer ? "Fly up" : "Jump"} tabIndex={-1}>
            ▲
          </button>
        </div>
        <p className="gamePopup__hint">
          {flyer ? "Space, ↑, W or a click to fly up." : "← → or A D to run. Space, ↑ or W to jump."}
        </p>
      </div>
    </div>
  );
}
