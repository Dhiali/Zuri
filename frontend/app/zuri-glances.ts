"use client";

import { useEffect } from "react";

type Point = { x: number; y: number };

export function glanceOffset(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  return distance ? { x: 5 * dx / distance, y: 4 * dy / distance } : { x: 0, y: 0 };
}

function visibleCenter(element: HTMLElement): Point | null {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (!rect.width || !rect.height || x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return null;
  }
  const top = document.elementFromPoint(x, y);
  return top && element.contains(top) ? { x, y } : null;
}

export function useZuriGlances() {
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    let resetTimer: number | undefined;
    let active: HTMLElement[] = [];

    function clearGlance() {
      window.clearTimeout(resetTimer);
      for (const element of active) {
        element.removeAttribute("data-zuri-glancing");
        element.style.removeProperty("--zuri-glance-x");
        element.style.removeProperty("--zuri-glance-y");
      }
      active = [];
    }

    function schedule() {
      window.clearTimeout(timer);
      if (motion.matches || document.hidden) return;
      timer = window.setTimeout(glance, 8000 + Math.random() * 10000);
    }

    function glance() {
      if (motion.matches || document.hidden) return;
      const visible = Array.from(document.querySelectorAll<HTMLElement>(".terminal-shell .zuri-figure"))
        .map((element) => ({ element, center: visibleCenter(element) }))
        .filter((item): item is { element: HTMLElement; center: Point } => item.center !== null);
      if (visible.length >= 2) {
        const first = Math.floor(Math.random() * visible.length);
        const second = (first + 1 + Math.floor(Math.random() * (visible.length - 1))) % visible.length;
        const pair = [visible[first], visible[second]];
        active = pair.map(({ element }) => element);
        pair.forEach(({ element, center }, index) => {
          const offset = glanceOffset(center, pair[1 - index].center);
          element.style.setProperty("--zuri-glance-x", `${offset.x}px`);
          element.style.setProperty("--zuri-glance-y", `${offset.y}px`);
          element.setAttribute("data-zuri-glancing", "");
        });
        resetTimer = window.setTimeout(clearGlance, 1500);
      }
      schedule();
    }

    function reset() {
      clearGlance();
      schedule();
    }
    motion.addEventListener("change", reset);
    document.addEventListener("visibilitychange", reset);
    window.addEventListener("resize", reset);
    document.addEventListener("scroll", reset, true);
    schedule();
    return () => {
      window.clearTimeout(timer);
      clearGlance();
      motion.removeEventListener("change", reset);
      document.removeEventListener("visibilitychange", reset);
      window.removeEventListener("resize", reset);
      document.removeEventListener("scroll", reset, true);
    };
  }, []);
}
