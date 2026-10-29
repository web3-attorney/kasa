"use client"

import * as React from "react"

/**
 * LiquidTile — pressable card with a glass ripple animation.
 * Uses CSS keyframes so the effect is guaranteed visible even when
 * the component unmounts immediately after click.
 */

const TILE_CSS = `
.lt-root {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  border: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform .15s cubic-bezier(.3,1.5,.5,1), box-shadow .15s ease;
}
.lt-root:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 28px -8px rgba(0,0,0,.55);
}
.lt-root:active {
  transform: scale(.97);
}
.lt-content {
  position: relative;
  z-index: 1;
}
/* ripple layer */
.lt-ripple {
  position: absolute;
  border-radius: 50%;
  transform: scale(0);
  background: radial-gradient(circle, rgba(255,255,255,.55) 0%, rgba(180,220,255,.35) 40%, transparent 70%);
  pointer-events: none;
  z-index: 2;
  animation: lt-burst .65s cubic-bezier(.2,.6,.3,1) forwards;
}
@keyframes lt-burst {
  0%   { transform: scale(0);   opacity: 1; }
  60%  { transform: scale(2.8); opacity: .7; }
  100% { transform: scale(4);   opacity: 0; }
}
/* shimmer sweep on press */
.lt-root::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg,
    rgba(255,255,255,0) 30%,
    rgba(255,255,255,.18) 50%,
    rgba(255,255,255,0) 70%);
  transform: translateX(-100%);
  pointer-events: none;
  z-index: 3;
}
.lt-root:active::after {
  animation: lt-shimmer .4s ease forwards;
}
@keyframes lt-shimmer {
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .lt-root, .lt-root:hover, .lt-root:active { transform: none !important; }
  .lt-ripple, .lt-root::after { animation: none !important; }
}
`

let cssInjected = false

export interface LiquidTileProps {
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

export function LiquidTile({ onClick, className = "", style, children }: LiquidTileProps) {
  const rootRef = React.useRef<HTMLButtonElement>(null)

  // inject shared CSS once
  React.useEffect(() => {
    if (cssInjected) return
    cssInjected = true
    const s = document.createElement("style")
    s.textContent = TILE_CSS
    document.head.appendChild(s)
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const btn = rootRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 1.4
    const x = e.clientX - rect.left - size / 2
    const y = e.clientY - rect.top  - size / 2

    const ripple = document.createElement("span")
    ripple.className = "lt-ripple"
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;`
    btn.appendChild(ripple)
    // clean up after animation
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true })
  }

  return (
    <button
      ref={rootRef}
      type="button"
      className={`lt-root${className ? ` ${className}` : ""}`}
      style={style}
      onClick={onClick}
      onPointerDown={handlePointerDown}
    >
      <div className="lt-content">{children}</div>
    </button>
  )
}

export default LiquidTile
