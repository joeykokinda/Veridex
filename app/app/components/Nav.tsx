"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "../lib/wallet";
import { Logo } from "./Logo";

export function Nav() {
  const { address, shortAddress, connect, disconnect, isConnecting } = useWallet();
  const pathname = usePathname();

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + "/");
  }

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
        {/* Logo + Wordmark */}
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <Logo size={20} />
          <span style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", letterSpacing: "-0.4px" }}>
            Veridex
          </span>
        </Link>

        {address ? (
          // ── Logged-in nav ──────────────────────────────────────────────────
          <>
            <nav style={{ display: "flex", gap: "2px", alignItems: "center" }}>
              {([
                ["/dashboard",   "Dashboard"],
                ["/leaderboard", "Leaderboard"],
              ] as [string, string][]).map(([href, label]) => (
                <Link key={href} href={href} style={{
                  fontSize: "13px", textDecoration: "none",
                  padding: "6px 14px", borderRadius: "100px",
                  color: isActive(href) ? "#fff" : "rgba(255,255,255,0.45)",
                  fontWeight: isActive(href) ? 500 : 400,
                  background: isActive(href) ? "rgba(255,255,255,0.1)" : "transparent",
                  transition: "all 0.15s",
                }}>
                  {label}
                </Link>
              ))}
            </nav>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <span style={{ fontSize: "12px", fontFamily: "monospace", color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", padding: "5px 10px", borderRadius: "100px" }}>
                {shortAddress}
              </span>
              <button onClick={disconnect} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "100px", padding: "5px 12px", fontSize: "12px", color: "rgba(255,255,255,0.35)", cursor: "pointer", transition: "all 0.15s" }}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          // ── Logged-out nav ─────────────────────────────────────────────────
          <>
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
                  background: "transparent",
                  transition: "all 0.15s",
                }}>
                  {label}
                </Link>
              ))}
            </nav>
            <div style={{ flexShrink: 0 }}>
              <button
                onClick={connect}
                disabled={isConnecting}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "100px", padding: "7px 16px", fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.7)", cursor: "pointer", opacity: isConnecting ? 0.7 : 1, transition: "all 0.15s" }}
              >
                {isConnecting ? "Connecting…" : "Connect Wallet"}
              </button>
            </div>
          </>
        )}
      </header>
    </div>
  );
}
