"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  fetchLoggedBlogsWithFlashcards,
  FlashcardItem,
  LoggedBlogAccordion,
  submitBlogRawText,
} from "@/lib/api";

interface FlashcardsTabProps {
  onSwitchToCalendar?: () => void;
}

export default function FlashcardsTab({
  onSwitchToCalendar,
}: FlashcardsTabProps) {
  const [blogs, setBlogs] = useState<LoggedBlogAccordion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBlogIds, setExpandedBlogIds] = useState<Record<number, boolean>>(
    {}
  );

  // Per-card answer reveal state & selected option highlight
  const [revealedAnswers, setRevealedAnswers] = useState<
    Record<number, boolean>
  >({});
  const [selectedOptions, setSelectedOptions] = useState<
    Record<number, number>
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
      const data = await fetchLoggedBlogsWithFlashcards();
      setBlogs(data);
      setError(null);
      // Auto-expand the first blog on initial load if none are expanded yet
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

  // Poll every 2.5s while any blog is in "processing" status so the accordion updates live
  useEffect(() => {
    const hasProcessing = blogs.some((b) => b.status === "processing");
    if (!hasProcessing) return;

    const timer = setInterval(() => {
      loadBlogs(true);
    }, 2500);
    return () => clearInterval(timer);
  }, [blogs, loadBlogs]);

  const toggleAccordion = (blogId: number) => {
    setExpandedBlogIds((prev) => ({
      ...prev,
      [blogId]: !prev[blogId],
    }));
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
        <h2 className="font-mono text-xl font-bold">
          No Logged Blogs Yet
        </h2>
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
      {/* Top Dashboard Bar */}
      <div className="blueprint-card p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-mono text-xs uppercase tracking-widest text-ink-muted block">
            Pub/Sub Extraction &amp; Curation Pipeline
          </span>
          <h2 className="font-mono text-xl font-bold">
            Logged Blogs &amp; Flashcard Accordions ({blogs.length})
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadBlogs(false)}
            className="blueprint-btn-secondary"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Status
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 border border-status-red bg-status-red/10 text-status-red font-mono text-xs">
          {error}
        </div>
      )}

      {/* Vertical Stack of Blog Accordions */}
      <div className="space-y-4">
        {blogs.map((blog) => {
          const isExpanded = Boolean(expandedBlogIds[blog.blog_id]);

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

                  {/* State 3: Ready -> Summary + 2-Column Flashcard Grid */}
                  {blog.status === "ready" && (
                    <div className="space-y-5">
                      {/* Article Summary Box */}
                      <div className="p-4 bg-manila-card border border-ink space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5" />
                            Technical Summary
                          </span>
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
                        </div>
                        <p className="text-sm text-ink leading-relaxed">
                          {blog.summary ||
                            "Summary extracted from article chunks."}
                        </p>
                      </div>

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

                          return (
                            <div
                              key={card.card_id}
                              data-testid={`flashcard-tile-${card.card_id}`}
                              className="blueprint-card p-4 flex flex-col justify-between space-y-4"
                            >
                              <div className="space-y-3">
                                {/* Card Top Meta Row */}
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-ink/30 font-mono text-[11px] text-ink-muted">
                                  <span>
                                    CARD #{idx + 1} // CHUNK{" "}
                                    {card.chunk_index + 1}
                                  </span>
                                  <span className="uppercase px-1.5 py-0.5 border border-ink bg-manila text-ink font-semibold">
                                    {card.status.replace(/_/g, " ")}
                                  </span>
                                </div>

                                {/* Question */}
                                <p className="font-sans text-sm font-semibold text-ink leading-snug">
                                  {card.question}
                                </p>

                                {/* 4 Multiple-Choice Options */}
                                <div className="space-y-1.5">
                                  {card.options.map((opt, optIdx) => {
                                    const isSelected = chosenOptIdx === optIdx;
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
                              </div>

                              {/* Bottom Action Bar (✓ / ✕ buttons — wired to per-user curation in Slice 3 & Anki queue in Slice 4) */}
                              <div className="pt-3 border-t border-ink flex items-center justify-between gap-2">
                                <span className="font-mono text-[10px] uppercase text-ink-muted">
                                  Curation Actions
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    title="Dismiss for me (wired in Slice 3)"
                                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-ink bg-status-red text-white font-mono text-xs font-bold shadow-[1px_1px_0px_#1C1B18]"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                    Dismiss
                                  </button>
                                  <button
                                    type="button"
                                    title="Approve & Queue for Anki (wired in Slice 4)"
                                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-ink bg-status-green text-white font-mono text-xs font-bold shadow-[1px_1px_0px_#1C1B18]"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    Approve
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
