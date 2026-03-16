"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface WalletState {
  address: string | null;
  shortAddress: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnecting: boolean;
  error: string | null;
}

const WalletContext = createContext<WalletState>({
  address: null, shortAddress: null,
  connect: async () => {}, disconnect: () => {},
  isConnecting: false, error: null,
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress]         = useState<string | null>(null);
  const [isConnecting, setConnecting] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("veridex_wallet") : null;
    if (saved) setAddress(saved);

    const eth = (window as any).ethereum;
    if (!eth) return;
    eth.on("accountsChanged", (accounts: string[]) => {
      if (accounts.length === 0) { setAddress(null); localStorage.removeItem("veridex_wallet"); }
      else { setAddress(accounts[0]); localStorage.setItem("veridex_wallet", accounts[0]); }
    });
  }, []);

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setError("MetaMask not installed. Get it at metamask.io."); return; }
    setConnecting(true); setError(null);
    try {
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      const addr = accounts[0];
      setAddress(addr);
      localStorage.setItem("veridex_wallet", addr);
    } catch {
      setError("Wallet connection rejected.");
    }
    setConnecting(false);
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    localStorage.removeItem("veridex_wallet");
  }, []);

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;

  return (
    <WalletContext.Provider value={{ address, shortAddress, connect, disconnect, isConnecting, error }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
