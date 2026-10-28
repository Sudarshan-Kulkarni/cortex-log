"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2, Plus, Trash2, X, Copy, Check } from "lucide-react";

export interface ApiKeyItem {
  id: number;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

function getApiBase(): string {
  if (typeof window !== "undefined") {
    const winUrl = (window as unknown as { __CORTEX_API_URL__?: string })
      .__CORTEX_API_URL__;
    if (winUrl) return winUrl.replace(/\/$/, "");
  }
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:8010"
  );
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { getToken } = useAuth();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${getApiBase()}/api/user/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${getApiBase()}/api/user/api-keys`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNewKey(data.api_key);
        loadKeys();
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id: number) => {
    const token = await getToken();
    if (!token) return;
    const res = await fetch(`${getApiBase()}/api/user/api-keys/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      loadKeys();
    }
  };

  const handleCopy = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm p-4">
      <div className="bg-manila-card border-2 border-ink shadow-[4px_4px_0px_#1C1B18] max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b-2 border-ink bg-manila">
          <h2 className="font-mono font-bold text-lg uppercase tracking-wider">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-ink/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="font-mono font-bold text-sm uppercase mb-2">
              Anki Personal Access Tokens (PAT)
            </h3>
            <p className="text-sm font-mono text-ink-muted mb-4 leading-relaxed">
              Generate a Personal Access Token to authenticate the Anki Desktop Add-on. Paste this token into your <code>cortex_log_sync/config.json</code>.
            </p>

            {newKey && (
              <div className="mb-6 p-4 border-2 border-status-green bg-status-green/10">
                <p className="text-xs font-mono font-bold text-status-green uppercase mb-2">
                  New Token Generated!
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newKey}
                    readOnly
                    className="flex-1 font-mono text-sm p-2 border border-status-green/30 bg-white"
                  />
                  <button
                    onClick={handleCopy}
                    className="p-2 bg-status-green text-white hover:bg-status-green/90 transition-colors border border-ink"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-[10px] font-mono mt-2 text-status-green/80">
                  Please copy this token now. You won't be able to see it again!
                </p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={generating}
              className="blueprint-btn w-full py-2 flex items-center justify-center gap-2 mb-6"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Generate New Token
            </button>

            <div className="space-y-3">
              <h4 className="font-mono font-bold text-xs uppercase text-ink-muted">
                Active Tokens
              </h4>
              {loading ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
                </div>
              ) : keys.length === 0 ? (
                <p className="text-xs font-mono text-ink-muted italic">
                  No active tokens.
                </p>
              ) : (
                keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between p-3 border border-ink bg-white/50"
                  >
                    <div>
                      <div className="font-mono text-sm font-bold">
                        {key.prefix}••••••••
                      </div>
                      <div className="font-mono text-[10px] text-ink-muted mt-1">
                        Created: {new Date(key.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="p-2 text-status-red hover:bg-status-red/10 border border-transparent hover:border-status-red/20 transition-all"
                      title="Revoke Token"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
