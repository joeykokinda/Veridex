"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { useWallet } from "../lib/wallet";

export function Nav() {
  const pathname = usePathname();
  const { address, shortAddress, connect, disconnect, isConnecting } = useWallet();
  const isHome = pathname === "/";

  if (isHome) {
    // ── Marketing nav (homepage only) ──────────────────────────────────────
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
          <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <Logo size={20} />
            <span style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", letterSpacing: "-0.4px" }}>
              Veridex
            </span>
          </Link>
          <nav style={{ display: "flex", gap: "2px", alignItems: "center" }}>
            {([
              ["/#how-it-works", "How it works"],
              ["/#install",      "Install"],
              ["/leaderboard",   "Leaderboard"],
            ] as [string, string][]).map(([href, label]) => (
              <Link key={href} href={href} style={{
                fontSize: "13px", textDecoration: "none",
                padding: "6px 14px", borderRadius: "100px",
                color: "rgba(255,255,255,0.45)", fontWeight: 400,
                transition: "all 0.15s",
              }}>
                {label}
              </Link>
            ))}
          </nav>
          <div style={{ flexShrink: 0 }}>
            <Link href="/dashboard" style={{
              background: "#10b981", borderRadius: "100px",
              padding: "7px 18px", fontSize: "13px", fontWeight: 600,
              color: "#000", textDecoration: "none", display: "inline-block",
            }}>
              Go to Dashboard
            </Link>
          </div>
        </header>
      </div>
    );
  }

  // ── App nav (all other pages) ─────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0,
      zIndex: 100,
      background: "rgba(9,9,11,0.92)",
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      height: "52px",
      display: "flex", alignItems: "center",
      padding: "0 28px",
    }}>
      {/* Logo */}
      <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px", marginRight: "32px" }}>
        <Logo size={18} />
        <span style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "15px", letterSpacing: "-0.3px" }}>
          Veridex
        </span>
      </Link>

      {/* App links */}
      <nav style={{ display: "flex", gap: "4px", alignItems: "center", flex: 1 }}>
        {([
          ["/dashboard",   "Dashboard"],
          ["/leaderboard", "Leaderboard"],
        ] as [string, string][]).map(([href, label]) => (
          <Link key={href} href={href} style={{
            fontSize: "13px", textDecoration: "none",
            padding: "5px 12px", borderRadius: "6px",
            color: pathname?.startsWith(href) ? "var(--text-primary, #fff)" : "rgba(255,255,255,0.4)",
            fontWeight: pathname?.startsWith(href) ? 600 : 400,
            background: pathname?.startsWith(href) ? "rgba(255,255,255,0.06)" : "transparent",
            transition: "all 0.15s",
          }}>
            {label}
          </Link>
        ))}
      </nav>

      {/* Wallet */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        {address ? (
          <>
            <span style={{
              fontSize: "12px", fontFamily: "monospace", color: "rgba(255,255,255,0.6)",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "20px", padding: "4px 12px",
            }}>
              {shortAddress}
            </span>
            <button onClick={disconnect} style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.35)",
              fontSize: "12px", cursor: "pointer", padding: "4px 8px",
            }}>
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={connect} disabled={isConnecting} style={{
            background: "#10b981", border: "none", borderRadius: "6px",
            padding: "6px 16px", fontSize: "13px", fontWeight: 600,
            color: "#000", cursor: "pointer",
          }}>
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
    </div>
  );
}
