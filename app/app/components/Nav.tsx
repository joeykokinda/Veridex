"use client";

import Link from "next/link";
import { Logo } from "./Logo";

export function Nav() {
  return (
    <div style={{
      position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
      zIndex: 100, width: "calc(100% - 48px)", maxWidth: "900px",
    }}>
      <header style={{
        background: "rgba(9,9,11,0.88)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "100px",
        padding: "0 8px 0 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: "52px",
        boxShadow: "0 4px 32px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.04) inset",
      }}>
        {/* Logo */}
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <Logo size={20} />
          <span style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", letterSpacing: "-0.4px" }}>
            Veridex
          </span>
        </Link>

        {/* Section links */}
        <nav style={{ display: "flex", gap: "2px", alignItems: "center" }}>
          {([
            ["/#how-it-works", "How it works"],
            ["/#install",      "Install"],
            ["/leaderboard",   "Leaderboard"],
          ] as [string, string][]).map(([href, label]) => (
            <Link key={href} href={href} style={{
              fontSize: "13px", textDecoration: "none",
              padding: "6px 14px", borderRadius: "100px",
              color: "rgba(255,255,255,0.45)",
              fontWeight: 400,
              transition: "all 0.15s",
            }}>
              {label}
            </Link>
          ))}
        </nav>

        {/* Go to Dashboard */}
        <div style={{ flexShrink: 0 }}>
          <Link href="/dashboard" style={{
            background: "#10b981", borderRadius: "100px",
            padding: "7px 18px", fontSize: "13px", fontWeight: 600,
            color: "#000", textDecoration: "none",
            display: "inline-block",
          }}>
            Go to Dashboard
          </Link>
        </div>
      </header>
    </div>
  );
}
