"use client";

import React, { useState } from "react";
import { Calendar, Layers, Terminal } from "lucide-react";
import CalendarTab from "@/components/CalendarTab";
import FlashcardsTab from "@/components/FlashcardsTab";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"calendar" | "flashcards">(
    "calendar"
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Blueprint Header & Navigation Bar */}
      <header className="border-b border-ink bg-manila-card sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-ink text-manila-card flex items-center justify-center font-mono font-bold text-sm shadow-blueprint">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-lg font-bold tracking-tight uppercase">
                  Cortex Log
                </h1>
                <span className="font-mono text-[10px] px-1.5 py-0.5 border border-ink bg-manila uppercase">
                  Anki Companion
                </span>
              </div>
              <p className="font-mono text-xs text-ink-muted">
                Technical Reading Tracker &amp; Flashcard Companion
              </p>
            </div>
          </div>

          {/* Two-Tab Switcher */}
          <nav className="flex items-center gap-2" aria-label="Main Tabs">
            <button
              type="button"
              onClick={() => setActiveTab("calendar")}
              data-testid="tab-calendar"
              className={`font-mono text-xs uppercase tracking-wider px-4 py-2 border border-ink inline-flex items-center gap-2 transition-all ${
                activeTab === "calendar"
                  ? "bg-ink text-manila-card shadow-blueprint font-bold"
                  : "bg-manila text-ink hover:bg-manila-muted"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              1. Calendar
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("flashcards")}
              data-testid="tab-flashcards"
              className={`font-mono text-xs uppercase tracking-wider px-4 py-2 border border-ink inline-flex items-center gap-2 transition-all ${
                activeTab === "flashcards"
                  ? "bg-ink text-manila-card shadow-blueprint font-bold"
                  : "bg-manila text-ink hover:bg-manila-muted"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              2. Flashcards
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === "calendar" ? (
          <CalendarTab
            onSwitchToFlashcards={() => setActiveTab("flashcards")}
          />
        ) : (
          <FlashcardsTab onSwitchToCalendar={() => setActiveTab("calendar")} />
        )}
      </main>
    </div>
  );
}
