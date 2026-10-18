"use client";

import React from "react";
import { Layers } from "lucide-react";

interface FlashcardsTabProps {
  onSwitchToCalendar?: () => void;
}

export default function FlashcardsTab({
  onSwitchToCalendar,
}: FlashcardsTabProps) {
  return (
    <div className="blueprint-card p-8 text-center space-y-4">
      <div className="inline-flex items-center justify-center w-12 h-12 border border-ink bg-manila shadow-blueprint">
        <Layers className="w-6 h-6 text-ink" />
      </div>
      <h2 className="font-mono text-xl font-bold">
        Flashcard Curation Dashboard
      </h2>
      <p className="text-sm text-ink-muted max-w-md mx-auto">
        Logged blogs and their message-queue generated flashcards will appear
        here as expandable accordions in Slice 2.
      </p>
      {onSwitchToCalendar && (
        <button
          type="button"
          onClick={onSwitchToCalendar}
          className="blueprint-btn"
        >
          Back to Reading Calendar
        </button>
      )}
    </div>
  );
}
