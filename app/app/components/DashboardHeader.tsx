"use client";

import Link from "next/link";
import { useWallet } from "../lib/wallet";
import { Logo } from "./Logo";

export function DashboardHeader() {
  const { address, shortAddress, connect, disconnect, isConnecting } = useWallet();

  return (
    <header style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      height: "56px",
      background: "rgba(9,9,11,0.92)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px",
    }}>
      {/* Logo — links back to homepage */}
      <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px" }}>
        <Logo size={20} />
        <span style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", letterSpacing: "-0.4px" }}>
          Veridex
        </span>
      </Link>

      {/* Wallet */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {address ? (
          <>
            <span style={{ fontSize: "12px", fontFamily: "monospace", color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", padding: "5px 10px", borderRadius: "100px" }}>
              {shortAddress}
            </span>
            <button onClick={disconnect} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "100px", padding: "5px 12px", fontSize: "12px", color: "rgba(255,255,255,0.35)", cursor: "pointer" }}>
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={connect} disabled={isConnecting} style={{ background: "#10b981", border: "none", borderRadius: "100px", padding: "7px 18px", fontSize: "13px", fontWeight: 600, color: "#000", cursor: "pointer", opacity: isConnecting ? 0.7 : 1 }}>
            {isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
