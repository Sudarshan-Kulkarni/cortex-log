"""
Cortex Log — Anki 2.1+ Outbound Pull & Sync Add-on (`cortex_log_sync`)

Why this exists:
A cloud-deployed backend (e.g., Cloud Run + GCP Pub/Sub) cannot initiate inbound
HTTP requests to `localhost:8765` (AnkiConnect) behind a user's home Wi-Fi NAT.
Instead, this lightweight Anki add-on runs inside Anki Desktop and hooks into
`aqt.gui_hooks.profile_did_open` (plus `Tools -> Sync Cortex Log Cards`) to:
  1. Make an outbound `POST /api/anki/pull` request to the Cortex Log backend.
  2. Create/open the `"Cortex Log"` deck and insert each Multiple-Choice card.
  3. Call `POST /api/anki/ack` to acknowledge the GCP Pub/Sub messages and mark
     the cards as `synced_to_anki`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def _load_addon_config() -> dict[str, Any]:
    """Load config from Anki's addonManager or fall back to local config.json."""
    defaults: dict[str, Any] = {
        "backend_url": "http://localhost:8010",
        "api_key": "",
        "deck_name": "Cortex Log",
        "auto_sync_on_startup": True,
    }
    try:
        from aqt import mw

        if mw and getattr(mw, "addonManager", None):
            user_cfg = mw.addonManager.getConfig(__name__)
            if isinstance(user_cfg, dict):
                defaults.update(user_cfg)
                return defaults
    except Exception:
        pass

    cfg_path = os.path.join(os.path.dirname(__file__), "config.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                defaults.update(json.load(f))
        except Exception:
            pass
    return defaults


def _http_post_json(url: str, payload: dict[str, Any], api_key: str = "") -> dict[str, Any]:
    """Perform an outbound HTTP POST with JSON using Python's stdlib urllib."""
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(
        url,
        data=body,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20.0) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def sync_cortex_log_cards(manual: bool = False) -> None:
    """Pull queued flashcards from Cortex Log, add them to Anki, and acknowledge delivery."""
    from aqt import mw
    from aqt.utils import tooltip

    if mw is None or mw.col is None:
        return

    cfg = _load_addon_config()
    if not manual and not cfg.get("auto_sync_on_startup", True):
        return

    backend_url = str(cfg.get("backend_url", "http://localhost:8010")).rstrip("/")
    default_deck_name = str(cfg.get("deck_name", "Cortex Log"))
    api_key = str(cfg.get("api_key", ""))

    try:
        pull_data = _http_post_json(f"{backend_url}/api/anki/pull", {}, api_key)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            if manual:
                tooltip("Cortex Log sync failed: 401 Unauthorized. Check your API key in config.json.")
            return
        if manual:
            tooltip(f"Cortex Log: HTTP error {exc.code}")
        return
    except urllib.error.URLError as exc:
        if manual:
            tooltip(f"Cortex Log: Could not reach backend at {backend_url} ({exc.reason})")
        return
    except Exception as exc:
        if manual:
            tooltip(f"Cortex Log sync error: {exc}")
        return

    cards = pull_data.get("cards") or []
    if not cards:
        if manual:
            tooltip("Cortex Log: No new queued flashcards to sync.")
        return

    try:
        deck_name = str(pull_data.get("deck_name") or default_deck_name)
        deck_id = mw.col.decks.id(deck_name)

        # Select the standard "Basic" note type (or fallback to current note type)
        model = mw.col.models.by_name("Basic") or mw.col.models.current()
        if model is None:
            tooltip("Cortex Log: Could not find a 'Basic' note type in Anki.")
            return

        synced_card_ids: list[int] = []
        ack_ids: list[str] = []

        for card in cards:
            note = mw.col.new_note(model)
            front_html = str(card.get("front_html") or card.get("question") or "")
            back_html = str(card.get("back_html") or card.get("answer") or "")

            if len(note.fields) >= 2:
                note.fields[0] = front_html
                note.fields[1] = back_html
            elif len(note.fields) == 1:
                note.fields[0] = f"{front_html}<hr>{back_html}"

            note.tags.append("cortex_log")
            mw.col.add_note(note, deck_id)

            uf_id = card.get("user_flashcard_id")
            if uf_id is not None:
                synced_card_ids.append(int(uf_id))

            ack_id = card.get("ack_id")
            if ack_id:
                ack_ids.append(str(ack_id))

        mw.reset()
    except Exception as exc:
        tooltip(f"Cortex Log note creation error: {exc}")
        return

    # Acknowledge delivery so backend marks cards as synced_to_anki & acks Pub/Sub
    try:
        _http_post_json(
            f"{backend_url}/api/anki/ack",
            {
                "user_flashcard_ids": synced_card_ids,
                "ack_ids": ack_ids,
            },
            api_key
        )
    except Exception:
        pass

    tooltip(
        f"Cortex Log: Synced {len(synced_card_ids)} flashcard(s) into '{deck_name}'!"
    )


def _register_anki_hooks() -> None:
    """Register Anki Desktop startup hook and Tools menu action."""
    try:
        from aqt import gui_hooks, mw
        from aqt.qt import QAction, qconnect

        # 1. Hook into profile_did_open so cards sync automatically when Anki opens
        gui_hooks.profile_did_open.append(
            lambda *_args: sync_cortex_log_cards(manual=False)
        )

        # 2. Add "Tools -> Sync Cortex Log Cards" menu item for manual sync anytime
        if mw is not None and getattr(mw, "form", None) is not None:
            action = QAction("Sync Cortex Log Cards", mw)
            qconnect(
                action.triggered, lambda *_args: sync_cortex_log_cards(manual=True)
            )
            mw.form.menuTools.addAction(action)
    except ImportError:
        # Imported outside Anki Desktop (e.g., during automated syntax verification)
        pass


_register_anki_hooks()
