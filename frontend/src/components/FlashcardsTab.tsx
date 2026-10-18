"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  AnkiQueueStatus,
  approveFlashcard,
  createCustomFlashcard,
  dismissFlashcard,
  fetchAnkiQueueStatus,
  fetchLoggedBlogsWithFlashcards,
  FlashcardItem,
  LoggedBlogAccordion,
  submitBlogRawText,
  updateFlashcard,
} from "@/lib/api";

interface FlashcardsTabProps {
  onSwitchToCalendar?: () => void;
}

interface CardDraft {
  question: string;
  options: string[];
  answer: string;
}

export default function FlashcardsTab({
  onSwitchToCalendar,
}: FlashcardsTabProps) {
  const [blogs, setBlogs] = useState<LoggedBlogAccordion[]>([]);
  const [ankiStatus, setAnkiStatus] = useState<AnkiQueueStatus>({
    deck_name: "Cortex Log",
    queued_count: 0,
    synced_count: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBlogIds, setExpandedBlogIds] = useState<
    Record<number, boolean>
  >({});

  // Per-card answer reveal state & selected option highlight
  const [revealedAnswers, setRevealedAnswers] = useState<
    Record<number, boolean>
  >({});
  const [selectedOptions, setSelectedOptions] = useState<
    Record<number, number>
  >({});

  // Per-card inline editing & curation action state
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<CardDraft>({
    question: "",
    options: ["", "", "", ""],
    answer: "",
  });
  const [savingCardId, setSavingCardId] = useState<number | null>(null);
  const [dismissingCardId, setDismissingCardId] = useState<number | null>(null);
  const [approvingCardId, setApprovingCardId] = useState<number | null>(null);

  // Per-blog "+ Add Custom Card" form state
  const [showCustomFormForBlog, setShowCustomFormForBlog] = useState<
    Record<number, boolean>
  >({});
  const [customDraftByBlog, setCustomDraftByBlog] = useState<
    Record<number, CardDraft>
  >({});
  const [savingCustomForBlog, setSavingCustomForBlog] = useState<
    Record<number, boolean>
  >({});

  // Raw-text fallback form state per blog_id
  const [rawTextByBlog, setRawTextByBlog] = useState<Record<number, string>>({});
  const [rawTitleByBlog, setRawTitleByBlog] = useState<Record<number, string>>(
    {}
  );
  const [submittingRawForBlog, setSubmittingRawForBlog] = useState<
    Record<number, boolean>
  >({});
  const [rawErrorByBlog, setRawErrorByBlog] = useState<
    Record<number, string | null>
  >({});

  const loadBlogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [data, queueInfo] = await Promise.all([
        fetchLoggedBlogsWithFlashcards(),
        fetchAnkiQueueStatus().catch(() => ({
          deck_name: "Cortex Log",
          queued_count: 0,
          synced_count: 0,
        })),
      ]);
      setBlogs(data);
      setAnkiStatus(queueInfo);
      setError(null);
      setExpandedBlogIds((prev) => {
        if (Object.keys(prev).length === 0 && data.length > 0) {
          return { [data[0].blog_id]: true };
        }
        return prev;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load flashcards."
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlogs(false);
  }, [loadBlogs]);

  // Poll every 3s while any blog is "processing" or any card is "queued_for_anki"
  useEffect(() => {
    const hasProcessing = blogs.some((b) => b.status === "processing");
    const hasQueuedAnki = ankiStatus.queued_count > 0;
    if (!hasProcessing && !hasQueuedAnki) return;

    const timer = setInterval(() => {
      loadBlogs(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [blogs, ankiStatus.queued_count, loadBlogs]);

  const toggleAccordion = (blogId: number) => {
    setExpandedBlogIds((prev) => ({
      ...prev,
      [blogId]: !prev[blogId],
    }));
  };

  const handleStartEditCard = (card: FlashcardItem) => {
    const paddedOptions = [...card.options];
    while (paddedOptions.length < 4) {
      paddedOptions.push("");
    }
    setEditingCardId(card.card_id);
    setEditDraft({
      question: card.question,
      options: paddedOptions,
      answer: card.answer,
    });
  };

  const handleCancelEditCard = () => {
    setEditingCardId(null);
  };

  const handleSaveEditCard = async (card: FlashcardItem) => {
    if (!editDraft.question.trim() || !editDraft.answer.trim()) {
      setError("Question and answer cannot be empty.");
      return;
    }

    setSavingCardId(card.card_id);
    setError(null);
    try {
      const updated = await updateFlashcard(card.card_id, {
        question: editDraft.question.trim(),
        options: editDraft.options.map((o) => o.trim()).filter(Boolean),
        answer: editDraft.answer.trim(),
      });

      setBlogs((prev) =>
        prev.map((b) =>
          b.blog_id === card.blog_id
            ? {
                ...b,
                flashcards: b.flashcards.map((fc) =>
                  fc.card_id === card.card_id ? updated : fc
                ),
              }
            : b
        )
      );
      setEditingCardId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save card edits."
      );
    } finally {
      setSavingCardId(null);
    }
  };

  const handleDismissCard = async (card: FlashcardItem) => {
    setDismissingCardId(card.card_id);
    setError(null);
    try {
      await dismissFlashcard(card.card_id);
      setBlogs((prev) =>
        prev.map((b) =>
          b.blog_id === card.blog_id
            ? {
                ...b,
                flashcards: b.flashcards.filter(
                  (fc) => fc.card_id !== card.card_id
                ),
              }
            : b
        )
      );
      loadBlogs(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss card.");
    } finally {
      setDismissingCardId(null);
    }
  };

  const handleApproveCard = async (card: FlashcardItem) => {
    setApprovingCardId(card.card_id);
    setError(null);
    try {
      const updated = await approveFlashcard(card.card_id);
      setBlogs((prev) =>
        prev.map((b) =>
          b.blog_id === card.blog_id
            ? {
                ...b,
                flashcards: b.flashcards.map((fc) =>
                  fc.card_id === card.card_id ? updated : fc
                ),
              }
            : b
        )
      );
      loadBlogs(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to approve card for Anki."
      );
    } finally {
      setApprovingCardId(null);
    }
  };

  const toggleCustomForm = (blogId: number) => {
    setShowCustomFormForBlog((prev) => {
      const nextOpen = !prev[blogId];
      if (nextOpen && !customDraftByBlog[blogId]) {
        setCustomDraftByBlog((d) => ({
          ...d,
          [blogId]: {
            question: "",
            options: ["A) ", "B) ", "C) ", "D) "],
            answer: "",
          },
        }));
      }
      return { ...prev, [blogId]: nextOpen };
    });
  };

  const handleCreateCustomCard = async (
    blogId: number,
    e: React.FormEvent
  ) => {
    e.preventDefault();
    const draft = customDraftByBlog[blogId];
    if (!draft || !draft.question.trim() || !draft.answer.trim()) {
      setError("Please fill in both Question and Answer for the custom card.");
      return;
    }

    setSavingCustomForBlog((prev) => ({ ...prev, [blogId]: true }));
    setError(null);
    try {
      const nonEmptyOptions = draft.options
        .map((o) => o.trim())
        .filter((o) => o.length > 0 && !/^[A-D]\)$/.test(o));

      const created = await createCustomFlashcard(blogId, {
        question: draft.question.trim(),
        options: nonEmptyOptions,
        answer: draft.answer.trim(),
      });

      setBlogs((prev) =>
        prev.map((b) =>
          b.blog_id === blogId
            ? { ...b, flashcards: [...b.flashcards, created] }
            : b
        )
      );
      setShowCustomFormForBlog((prev) => ({ ...prev, [blogId]: false }));
      setCustomDraftByBlog((prev) => ({
        ...prev,
        [blogId]: {
          question: "",
          options: ["A) ", "B) ", "C) ", "D) "],
          answer: "",
        },
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create custom card."
      );
    } finally {
      setSavingCustomForBlog((prev) => ({ ...prev, [blogId]: false }));
    }
  };

  const handleRawTextSubmit = async (blogId: number, e: React.FormEvent) => {
    e.preventDefault();
    const rawText = (rawTextByBlog[blogId] || "").trim();
    const rawTitle = (rawTitleByBlog[blogId] || "").trim();

    if (rawText.length < 20) {
      setRawErrorByBlog((prev) => ({
        ...prev,
        [blogId]: "Please paste at least a full paragraph of article text.",
      }));
      return;
    }

    setSubmittingRawForBlog((prev) => ({ ...prev, [blogId]: true }));
    setRawErrorByBlog((prev) => ({ ...prev, [blogId]: null }));

    try {
      await submitBlogRawText(blogId, rawText, rawTitle || undefined);
      setRawTextByBlog((prev) => ({ ...prev, [blogId]: "" }));
      await loadBlogs(true);
    } catch (err) {
      setRawErrorByBlog((prev) => ({
        ...prev,
        [blogId]:
          err instanceof Error ? err.message : "Failed to submit raw text.",
      }));
    } finally {
      setSubmittingRawForBlog((prev) => ({ ...prev, [blogId]: false }));
    }
  };

  if (loading && blogs.length === 0) {
    return (
      <div className="blueprint-card p-8 flex items-center justify-center gap-3 font-mono text-sm">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading logged blogs &amp; generated flashcards...
      </div>
    );
  }

  if (blogs.length === 0) {
    return (
      <div className="blueprint-card p-8 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 border border-ink bg-manila shadow-blueprint">
          <Layers className="w-6 h-6 text-ink" />
        </div>
        <h2 className="font-mono text-xl font-bold">No Logged Blogs Yet</h2>
        <p className="text-sm text-ink-muted max-w-md mx-auto">
          Log your first technical blog URL or raw article text on the Calendar
          tab to trigger background scraping and chunked flashcard extraction.
        </p>
        {onSwitchToCalendar && (
          <button
            type="button"
            onClick={onSwitchToCalendar}
            className="blueprint-btn"
          >
            Go to Reading Calendar →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Bar: Anki Delivery Queue Status & Controls */}
      <div className="blueprint-card p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-mono text-xs uppercase tracking-widest text-ink-muted block">
            Pub/Sub Extraction &amp; Anki Delivery Queue
          </span>
          <h2 className="font-mono text-xl font-bold">
            Logged Blogs &amp; Flashcard Accordions ({blogs.length})
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Anki Queue Status Counters */}
          <div
            data-testid="anki-queue-status-bar"
            className="flex items-center gap-3 bg-manila px-3 py-1.5 border border-ink font-mono text-xs"
          >
            <span className="text-ink-muted">
              Deck: <strong className="text-ink">{ankiStatus.deck_name}</strong>
            </span>
            <span className="text-ink-muted">|</span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <Clock className="w-3.5 h-3.5 text-status-yellow" />
              {ankiStatus.queued_count} Queued for Anki
            </span>
            <span className="text-ink-muted">|</span>
            <span className="inline-flex items-center gap-1 font-semibold text-status-green">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {ankiStatus.synced_count} Synced to Anki
            </span>
          </div>

          <button
            type="button"
            onClick={() => loadBlogs(false)}
            className="blueprint-btn-secondary"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Sync Status
          </button>
        </div>
      </div>

      {/* Helpful banner when cards are queued waiting for Anki Desktop */}
      {ankiStatus.queued_count > 0 && (
        <div className="blueprint-card p-3.5 bg-status-yellow/15 border-ink font-mono text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-ink shrink-0" />
            <span>
              <strong>{ankiStatus.queued_count} card(s)</strong> waiting in the{" "}
              <code>anki-delivery</code> queue. Open{" "}
              <strong>Anki Desktop</strong> (or click{" "}
              <code>Tools → Sync Cortex Log Cards</code>) to pull them into your{" "}
              <strong>&ldquo;{ankiStatus.deck_name}&rdquo;</strong> deck.
            </span>
          </div>
          <span className="text-[11px] text-ink-muted">
            Install once:{" "}
            <code>./anki_addon/cortex_log_sync/install_addon.sh</code>
          </span>
        </div>
      )}

      {error && (
        <div className="p-3 border border-status-red bg-status-red/10 text-status-red font-mono text-xs">
          {error}
        </div>
      )}

      {/* Vertical Stack of Blog Accordions */}
      <div className="space-y-4">
        {blogs.map((blog) => {
          const isExpanded = Boolean(expandedBlogIds[blog.blog_id]);
          const customFormOpen = Boolean(showCustomFormForBlog[blog.blog_id]);
          const customDraft = customDraftByBlog[blog.blog_id] || {
            question: "",
            options: ["A) ", "B) ", "C) ", "D) "],
            answer: "",
          };

          return (
            <div
              key={blog.blog_id}
              data-testid={`blog-accordion-${blog.blog_id}`}
              className="blueprint-card overflow-hidden"
            >
              {/* Accordion Header */}
              <button
                type="button"
                onClick={() => toggleAccordion(blog.blog_id)}
                className="w-full p-4 sm:p-5 text-left flex flex-wrap items-center justify-between gap-4 bg-manila-card hover:bg-manila transition-colors"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-muted">
                    <span>LOGGED: {blog.logged_date}</span>
                    {blog.all_logged_dates.length > 1 && (
                      <span>
                        (+{blog.all_logged_dates.length - 1} other date
                        {blog.all_logged_dates.length - 1 > 1 ? "s" : ""})
                      </span>
                    )}
                    {blog.canonical_url && (
                      <>
                        <span>•</span>
                        <span className="truncate max-w-xs sm:max-w-md">
                          {blog.canonical_url}
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="font-mono text-base sm:text-lg font-bold text-ink truncate">
                    {blog.title}
                  </h3>
                </div>

                {/* Status Badge & Expand Chevron */}
                <div className="flex items-center gap-3 shrink-0">
                  {blog.status === "processing" && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase px-2.5 py-1 border border-ink bg-status-yellow text-ink font-bold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Processing
                    </span>
                  )}
                  {blog.status === "scrape_failed" && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase px-2.5 py-1 border border-ink bg-status-red text-white font-bold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Needs Raw Text
                    </span>
                  )}
                  {blog.status === "ready" && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase px-2.5 py-1 border border-ink bg-status-green text-white font-bold">
                      {blog.flashcards.length} Cards Ready
                    </span>
                  )}

                  <div className="w-8 h-8 border border-ink bg-manila flex items-center justify-center">
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded Accordion Body */}
              {isExpanded && (
                <div className="p-5 border-t border-ink bg-manila space-y-5">
                  {/* State 1: Processing */}
                  {blog.status === "processing" && (
                    <div
                      data-testid={`blog-processing-${blog.blog_id}`}
                      className="p-6 bg-manila-card border border-ink text-center space-y-2"
                    >
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-ink" />
                      <p className="font-mono text-sm font-semibold text-ink">
                        The cards haven&apos;t been generated yet, check back in
                        a bit.
                      </p>
                      <p className="font-mono text-xs text-ink-muted">
                        The background Pub/Sub worker is scraping and chunking
                        this article now...
                      </p>
                    </div>
                  )}

                  {/* State 2: Scrape Failed -> Inline Raw-Text Fallback Form */}
                  {blog.status === "scrape_failed" && (
                    <div
                      data-testid={`blog-scrape-failed-${blog.blog_id}`}
                      className="p-5 bg-manila-card border border-ink space-y-4"
                    >
                      <div className="p-3 border border-status-red bg-status-red/10 text-status-red font-mono text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <strong className="uppercase block mb-0.5">
                            Scrape Failed
                          </strong>
                          {blog.error_message ||
                            "This URL blocked automated scraping or returned an empty body."}
                        </div>
                      </div>

                      <form
                        onSubmit={(e) => handleRawTextSubmit(blog.blog_id, e)}
                        className="space-y-3"
                      >
                        <div>
                          <label className="block font-mono text-xs font-bold uppercase tracking-wider mb-1">
                            Optional Updated Title
                          </label>
                          <input
                            type="text"
                            value={rawTitleByBlog[blog.blog_id] ?? blog.title}
                            onChange={(e) =>
                              setRawTitleByBlog((prev) => ({
                                ...prev,
                                [blog.blog_id]: e.target.value,
                              }))
                            }
                            className="blueprint-input"
                          />
                        </div>

                        <div>
                          <label className="block font-mono text-xs font-bold uppercase tracking-wider mb-1">
                            <span className="inline-flex items-center gap-1">
                              <FileText className="w-3.5 h-3.5" />
                              Paste Raw Article Text to Resume Extraction
                            </span>
                          </label>
                          <textarea
                            rows={6}
                            value={rawTextByBlog[blog.blog_id] || ""}
                            onChange={(e) =>
                              setRawTextByBlog((prev) => ({
                                ...prev,
                                [blog.blog_id]: e.target.value,
                              }))
                            }
                            placeholder="Paste the technical blog post prose here and click Process Raw Text..."
                            className="blueprint-input font-sans"
                          />
                        </div>

                        {rawErrorByBlog[blog.blog_id] && (
                          <div className="text-xs font-mono text-status-red">
                            {rawErrorByBlog[blog.blog_id]}
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={submittingRawForBlog[blog.blog_id]}
                          className="blueprint-btn"
                        >
                          {submittingRawForBlog[blog.blog_id] ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Queueing Raw Text...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              Process Raw Text via Queue
                            </>
                          )}
                        </button>
                      </form>
                    </div>
                  )}

                  {/* State 3: Ready -> Summary + Add Custom Card + 2-Column Flashcard Grid */}
                  {blog.status === "ready" && (
                    <div className="space-y-5">
                      {/* Article Summary Box + Add Custom Card Trigger */}
                      <div className="p-4 bg-manila-card border border-ink space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5" />
                            Technical Summary
                          </span>
                          <div className="flex items-center gap-3">
                            {blog.canonical_url && (
                              <a
                                href={blog.canonical_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs underline inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                              >
                                Source Article
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleCustomForm(blog.blog_id)}
                              data-testid={`add-custom-card-btn-${blog.blog_id}`}
                              className="blueprint-btn-secondary py-1 px-2.5 text-xs"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {customFormOpen
                                ? "Cancel Custom Card"
                                : "+ Add Custom Card"}
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-ink leading-relaxed">
                          {blog.summary ||
                            "Summary extracted from article chunks."}
                        </p>
                      </div>

                      {/* Collapsible "+ Add Custom Card" Form */}
                      {customFormOpen && (
                        <form
                          onSubmit={(e) =>
                            handleCreateCustomCard(blog.blog_id, e)
                          }
                          data-testid={`custom-card-form-${blog.blog_id}`}
                          className="p-4 bg-manila-card border-2 border-ink shadow-blueprint space-y-3"
                        >
                          <div className="flex items-center justify-between pb-2 border-b border-ink">
                            <h4 className="font-mono text-xs font-bold uppercase tracking-wider">
                              New Custom Flashcard (Saved to Your User Deck)
                            </h4>
                            <button
                              type="button"
                              onClick={() => toggleCustomForm(blog.blog_id)}
                              className="font-mono text-xs text-ink-muted hover:text-ink"
                            >
                              Close
                            </button>
                          </div>

                          <div>
                            <label className="block font-mono text-xs font-bold uppercase mb-1">
                              Question
                            </label>
                            <textarea
                              rows={2}
                              value={customDraft.question}
                              onChange={(e) =>
                                setCustomDraftByBlog((prev) => ({
                                  ...prev,
                                  [blog.blog_id]: {
                                    ...customDraft,
                                    question: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Enter your technical question..."
                              className="blueprint-input"
                            />
                          </div>

                          <div>
                            <label className="block font-mono text-xs font-bold uppercase mb-1">
                              Multiple-Choice Options (Optional — leave blank for
                              open Q&amp;A)
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {customDraft.options.map((optVal, oIdx) => (
                                <input
                                  key={oIdx}
                                  type="text"
                                  value={optVal}
                                  onChange={(e) => {
                                    const nextOpts = [...customDraft.options];
                                    nextOpts[oIdx] = e.target.value;
                                    setCustomDraftByBlog((prev) => ({
                                      ...prev,
                                      [blog.blog_id]: {
                                        ...customDraft,
                                        options: nextOpts,
                                      },
                                    }));
                                  }}
                                  placeholder={`Option ${String.fromCharCode(
                                    65 + oIdx
                                  )})`}
                                  className="blueprint-input text-xs"
                                />
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="block font-mono text-xs font-bold uppercase mb-1">
                              Answer &amp; Explanation
                            </label>
                            <textarea
                              rows={2}
                              value={customDraft.answer}
                              onChange={(e) =>
                                setCustomDraftByBlog((prev) => ({
                                  ...prev,
                                  [blog.blog_id]: {
                                    ...customDraft,
                                    answer: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Correct answer and technical explanation..."
                              className="blueprint-input"
                            />
                          </div>

                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => toggleCustomForm(blog.blog_id)}
                              className="blueprint-btn-secondary"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={savingCustomForBlog[blog.blog_id]}
                              className="blueprint-btn"
                            >
                              {savingCustomForBlog[blog.blog_id] ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <Save className="w-3.5 h-3.5" />
                                  Save Custom Card
                                </>
                              )}
                            </button>
                          </div>
                        </form>
                      )}

                      {/* 2-Column Flashcard Grid */}
                      <div
                        data-testid={`flashcard-grid-${blog.blog_id}`}
                        className="grid grid-cols-1 md:grid-cols-2 gap-4"
                      >
                        {blog.flashcards.map((card: FlashcardItem, idx) => {
                          const isRevealed = Boolean(
                            revealedAnswers[card.card_id]
                          );
                          const chosenOptIdx = selectedOptions[card.card_id];
                          const isEditing = editingCardId === card.card_id;
                          const isSaving = savingCardId === card.card_id;
                          const isDismissing =
                            dismissingCardId === card.card_id;
                          const isApproving =
                            approvingCardId === card.card_id;
                          const isQueued = card.status === "queued_for_anki";
                          const isSynced = card.status === "synced_to_anki";

                          return (
                            <div
                              key={card.card_id}
                              data-testid={`flashcard-tile-${card.card_id}`}
                              className="blueprint-card p-4 flex flex-col justify-between space-y-4"
                            >
                              <div className="space-y-3">
                                {/* Card Top Meta Row */}
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-ink/30 font-mono text-[11px] text-ink-muted">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span>
                                      CARD #{idx + 1} //{" "}
                                      {card.is_custom
                                        ? "CUSTOM"
                                        : `CHUNK ${card.chunk_index + 1}`}
                                    </span>
                                    {card.is_custom && (
                                      <span className="px-1.5 py-0.5 bg-ink text-manila-card text-[10px] font-bold">
                                        CUSTOM
                                      </span>
                                    )}
                                    {card.is_edited && (
                                      <span className="px-1.5 py-0.5 border border-ink bg-manila-muted text-ink text-[10px] font-bold">
                                        EDITED
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    {!isEditing && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleStartEditCard(card)
                                        }
                                        data-testid={`edit-card-btn-${card.card_id}`}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 border border-ink bg-manila hover:bg-manila-muted text-ink text-[10px] font-bold uppercase"
                                      >
                                        <Pencil className="w-3 h-3" />
                                        Edit
                                      </button>
                                    )}
                                    <span
                                      className={`uppercase px-1.5 py-0.5 border border-ink font-semibold ${
                                        isSynced
                                          ? "bg-status-green text-white"
                                          : isQueued
                                          ? "bg-status-yellow text-ink"
                                          : "bg-manila text-ink"
                                      }`}
                                    >
                                      {isSynced
                                        ? "Synced to Anki"
                                        : isQueued
                                        ? "Queued for Anki"
                                        : card.status.replace(/_/g, " ")}
                                    </span>
                                  </div>
                                </div>

                                {/* Inline Editor Mode vs Read Mode */}
                                {isEditing ? (
                                  <div className="space-y-3 pt-1">
                                    <div>
                                      <label className="block font-mono text-[11px] font-bold uppercase mb-1">
                                        Question
                                      </label>
                                      <textarea
                                        rows={2}
                                        value={editDraft.question}
                                        onChange={(e) =>
                                          setEditDraft((prev) => ({
                                            ...prev,
                                            question: e.target.value,
                                          }))
                                        }
                                        className="blueprint-input text-xs"
                                      />
                                    </div>

                                    <div>
                                      <label className="block font-mono text-[11px] font-bold uppercase mb-1">
                                        Multiple-Choice Options
                                      </label>
                                      <div className="space-y-1.5">
                                        {editDraft.options.map(
                                          (optVal, oIdx) => (
                                            <input
                                              key={oIdx}
                                              type="text"
                                              value={optVal}
                                              onChange={(e) => {
                                                const nextOpts = [
                                                  ...editDraft.options,
                                                ];
                                                nextOpts[oIdx] = e.target.value;
                                                setEditDraft((prev) => ({
                                                  ...prev,
                                                  options: nextOpts,
                                                }));
                                              }}
                                              placeholder={`Option ${String.fromCharCode(
                                                65 + oIdx
                                              )})`}
                                              className="blueprint-input text-xs py-1.5"
                                            />
                                          )
                                        )}
                                      </div>
                                    </div>

                                    <div>
                                      <label className="block font-mono text-[11px] font-bold uppercase mb-1">
                                        Answer &amp; Explanation
                                      </label>
                                      <textarea
                                        rows={3}
                                        value={editDraft.answer}
                                        onChange={(e) =>
                                          setEditDraft((prev) => ({
                                            ...prev,
                                            answer: e.target.value,
                                          }))
                                        }
                                        className="blueprint-input text-xs"
                                      />
                                    </div>

                                    <div className="flex items-center justify-end gap-2 pt-1">
                                      <button
                                        type="button"
                                        onClick={handleCancelEditCard}
                                        className="blueprint-btn-secondary py-1 px-2.5 text-xs"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={() => handleSaveEditCard(card)}
                                        data-testid={`save-card-btn-${card.card_id}`}
                                        className="blueprint-btn py-1 px-3 text-xs"
                                      >
                                        {isSaving ? (
                                          <>
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            Saving...
                                          </>
                                        ) : (
                                          <>
                                            <Save className="w-3.5 h-3.5" />
                                            Save Changes
                                          </>
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {/* Question */}
                                    <p className="font-sans text-sm font-semibold text-ink leading-snug">
                                      {card.question}
                                    </p>

                                    {/* Multiple-Choice Options */}
                                    {card.options.length > 0 && (
                                      <div className="space-y-1.5">
                                        {card.options.map((opt, optIdx) => {
                                          const isSelected =
                                            chosenOptIdx === optIdx;
                                          return (
                                            <button
                                              key={optIdx}
                                              type="button"
                                              onClick={() =>
                                                setSelectedOptions((prev) => ({
                                                  ...prev,
                                                  [card.card_id]: optIdx,
                                                }))
                                              }
                                              className={`w-full text-left px-3 py-2 text-xs border transition-colors font-sans ${
                                                isSelected
                                                  ? "border-ink bg-ink text-manila-card font-medium"
                                                  : "border-ink/50 bg-manila hover:bg-manila-muted text-ink"
                                              }`}
                                            >
                                              {opt}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Answer Reveal Toggle */}
                                    <div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setRevealedAnswers((prev) => ({
                                            ...prev,
                                            [card.card_id]: !prev[card.card_id],
                                          }))
                                        }
                                        className="font-mono text-xs underline underline-offset-4 text-ink-muted hover:text-ink inline-flex items-center gap-1"
                                      >
                                        {isRevealed ? (
                                          <>
                                            <EyeOff className="w-3.5 h-3.5" />
                                            Hide Answer &amp; Explanation
                                          </>
                                        ) : (
                                          <>
                                            <Eye className="w-3.5 h-3.5" />
                                            Show Answer &amp; Explanation
                                          </>
                                        )}
                                      </button>

                                      {isRevealed && (
                                        <div className="mt-2 p-3 bg-manila border border-ink text-xs space-y-1 whitespace-pre-line">
                                          {card.answer}
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Bottom Action Bar (✓ / ✕ buttons) */}
                              <div className="pt-3 border-t border-ink flex items-center justify-between gap-2">
                                <span className="font-mono text-[10px] uppercase text-ink-muted">
                                  {isSynced
                                    ? "In Anki Deck"
                                    : isQueued
                                    ? "Waiting in Pub/Sub"
                                    : "Per-User Curation"}
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={isDismissing}
                                    onClick={() => handleDismissCard(card)}
                                    data-testid={`dismiss-card-btn-${card.card_id}`}
                                    title="Dismiss this card for your user only"
                                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-ink bg-status-red text-white font-mono text-xs font-bold shadow-[1px_1px_0px_#1C1B18] hover:opacity-90 disabled:opacity-50"
                                  >
                                    {isDismissing ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <X className="w-3.5 h-3.5" />
                                    )}
                                    Dismiss
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isApproving || isSynced}
                                    onClick={() => handleApproveCard(card)}
                                    data-testid={`approve-card-btn-${card.card_id}`}
                                    title="Approve & Queue for Anki via Pub/Sub"
                                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-ink bg-status-green text-white font-mono text-xs font-bold shadow-[1px_1px_0px_#1C1B18] hover:opacity-90 disabled:opacity-60"
                                  >
                                    {isApproving ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5" />
                                    )}
                                    {isSynced
                                      ? "Synced"
                                      : isQueued
                                      ? "Re-queue"
                                      : "Approve"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
