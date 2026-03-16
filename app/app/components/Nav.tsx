"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { useWallet } from "../lib/wallet";

export function Nav() {
  const { address, shortAddress, connect, disconnect, isConnecting } = useWallet();
  const pathname = usePathname();

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + "/");
  }

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 100,
      borderBottom: "1px solid var(--border)",
      background: "rgba(9,9,11,0.92)", backdropFilter: "blur(12px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "60px", padding: "0 24px", maxWidth: "1200px", margin: "0 auto" }}>
        {/* Logo */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none", color: "var(--text-primary)", fontWeight: 700, fontSize: "18px" }}>
          <Logo size={20} />
          Veridex
        </Link>

        {/* Nav links */}
        <nav style={{ display: "flex", gap: "28px", alignItems: "center" }}>
          <Link href="/dashboard" style={{ fontSize: "14px", textDecoration: "none", color: isActive("/dashboard") ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: isActive("/dashboard") ? 500 : 400 }}>
            Dashboard
          </Link>
          <Link href="/leaderboard" style={{ fontSize: "14px", textDecoration: "none", color: isActive("/leaderboard") ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: isActive("/leaderboard") ? 500 : 400 }}>
            Leaderboard
          </Link>
        </nav>

        {/* Wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {address ? (
            <>
              <span style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--text-secondary)", background: "var(--bg-secondary)", border: "1px solid var(--border)", padding: "5px 10px", borderRadius: "6px" }}>
                {shortAddress}
              </span>
              <button onClick={disconnect} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", padding: "5px 12px", fontSize: "13px", color: "var(--text-tertiary)", cursor: "pointer" }}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              style={{ background: "#10b981", border: "none", borderRadius: "6px", padding: "8px 16px", fontSize: "14px", fontWeight: 600, color: "#000", cursor: "pointer", opacity: isConnecting ? 0.7 : 1 }}
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
