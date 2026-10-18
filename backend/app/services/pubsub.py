import json
import logging
import queue
import threading
import uuid
from collections.abc import Callable
from typing import Any

from app.config import (
    GCP_PROJECT_ID,
    GOOGLE_APPLICATION_CREDENTIALS,
    PUBSUB_ANKI_SUB,
    PUBSUB_ANKI_TOPIC,
    PUBSUB_BLOG_SUB,
    PUBSUB_BLOG_TOPIC,
)

logger = logging.getLogger(__name__)

# Local in-process queues used when GCP Pub/Sub is not configured
_local_blog_queue: "queue.Queue[int]" = queue.Queue()
_local_anki_queue: dict[str, dict[str, Any]] = {}
_local_worker_started = False
_gcp_ready = bool(GCP_PROJECT_ID)
_lock = threading.Lock()


def _client_options() -> dict[str, str] | None:
    if GCP_PROJECT_ID and not GOOGLE_APPLICATION_CREDENTIALS:
        return {"quota_project_id": GCP_PROJECT_ID}
    return None


def publish_blog_ingestion(blog_id: int) -> str:
    """Publish a blog-ingestion job to GCP Pub/Sub (or local fallback queue if GCP is not configured)."""
    payload = json.dumps({"blog_id": blog_id}).encode("utf-8")

    if _gcp_ready and GCP_PROJECT_ID:
        try:
            from google.cloud import pubsub_v1

            publisher = pubsub_v1.PublisherClient(client_options=_client_options())
            topic_path = publisher.topic_path(GCP_PROJECT_ID, PUBSUB_BLOG_TOPIC)
            future = publisher.publish(topic_path, payload)
            message_id = future.result(timeout=15.0)
            logger.warning(
                "Published blog_id=%s to GCP Pub/Sub topic %s (msg_id=%s)",
                blog_id,
                topic_path,
                message_id,
            )
            return str(message_id)
        except Exception as exc:
            logger.warning(
                "GCP Pub/Sub publish failed (%s); falling back to local queue for blog_id=%s",
                exc,
                blog_id,
            )

    _local_blog_queue.put(blog_id)
    msg_id = f"local-blog-{blog_id}-{uuid.uuid4().hex[:8]}"
    logger.info(
        "Published blog_id=%s to local blog-ingestion queue (%s)", blog_id, msg_id
    )
    return msg_id


def start_blog_subscriber(handler_fn: Callable[[int], None]) -> None:
    """Start background consumer for blog-ingestion messages."""
    global _local_worker_started
    with _lock:
        if _local_worker_started:
            return
        _local_worker_started = True

    def _local_loop() -> None:
        while True:
            blog_id = _local_blog_queue.get()
            try:
                handler_fn(blog_id)
            except Exception as exc:
                logger.exception(
                    "Error processing blog_id=%s in local subscriber: %s", blog_id, exc
                )
            finally:
                _local_blog_queue.task_done()

    thread = threading.Thread(
        target=_local_loop, name="blog-ingestion-local-worker", daemon=True
    )
    thread.start()

    if GCP_PROJECT_ID:

        def _gcp_subscriber_boot() -> None:
            global _gcp_ready
            try:
                from google.cloud import pubsub_v1

                subscriber = pubsub_v1.SubscriberClient(
                    client_options=_client_options()
                )
                sub_path = subscriber.subscription_path(
                    GCP_PROJECT_ID, PUBSUB_BLOG_SUB
                )

                def _callback(message: Any) -> None:
                    try:
                        data = json.loads(message.data.decode("utf-8"))
                        b_id = int(data["blog_id"])
                        logger.warning(
                            "GCP Pub/Sub subscriber received blog_id=%s (msg_id=%s)",
                            b_id,
                            message.message_id,
                        )
                        handler_fn(b_id)
                        message.ack()
                    except Exception as exc:
                        logger.exception(
                            "Error handling GCP Pub/Sub blog message: %s", exc
                        )
                        message.nack()

                streaming_future = subscriber.subscribe(sub_path, callback=_callback)
                _gcp_ready = True
                logger.warning(
                    "Connected to GCP Pub/Sub subscription %s", sub_path
                )
                streaming_future.result()
            except Exception as exc:
                _gcp_ready = False
                logger.warning(
                    "GCP Pub/Sub subscriber error (%s: %s); falling back to in-process queue.",
                    exc.__class__.__name__,
                    exc,
                )

        gcp_thread = threading.Thread(
            target=_gcp_subscriber_boot,
            name="blog-ingestion-gcp-subscriber",
            daemon=True,
        )
        gcp_thread.start()


def publish_anki_delivery(card_payload: dict[str, Any]) -> str:
    """Publish an approved flashcard to the anki-delivery Pub/Sub topic."""
    encoded = json.dumps(card_payload).encode("utf-8")

    if _gcp_ready and GCP_PROJECT_ID:
        try:
            from google.cloud import pubsub_v1

            publisher = pubsub_v1.PublisherClient(client_options=_client_options())
            topic_path = publisher.topic_path(GCP_PROJECT_ID, PUBSUB_ANKI_TOPIC)
            future = publisher.publish(topic_path, encoded)
            msg_id = str(future.result(timeout=15.0))
            logger.warning(
                "Published card to GCP Pub/Sub %s (msg_id=%s)", topic_path, msg_id
            )
            return msg_id
        except Exception as exc:
            logger.warning(
                "GCP Pub/Sub anki publish failed (%s); buffering in local queue + DB",
                exc,
            )

    ack_id = (
        f"local-anki-{card_payload.get('user_flashcard_id')}-{uuid.uuid4().hex[:8]}"
    )
    _local_anki_queue[ack_id] = card_payload
    return ack_id


def pull_anki_messages(max_messages: int = 50) -> dict[int, str]:
    """Attempt synchronous pull from GCP Pub/Sub anki-delivery-sub to map user_flashcard_id -> ack_id."""
    ack_map: dict[int, str] = {}
    if _gcp_ready and GCP_PROJECT_ID:
        try:
            from google.cloud import pubsub_v1

            subscriber = pubsub_v1.SubscriberClient(client_options=_client_options())
            sub_path = subscriber.subscription_path(GCP_PROJECT_ID, PUBSUB_ANKI_SUB)
            response = subscriber.pull(
                request={"subscription": sub_path, "max_messages": max_messages},
                timeout=10.0,
            )
            for received in response.received_messages:
                try:
                    data = json.loads(received.message.data.decode("utf-8"))
                    uf_id = int(data["user_flashcard_id"])
                    ack_map[uf_id] = received.ack_id
                except Exception:
                    continue
        except Exception as exc:
            logger.debug("GCP Pub/Sub synchronous pull skipped/fallback: %s", exc)

    for ack_id, payload in list(_local_anki_queue.items()):
        uf_id = int(payload.get("user_flashcard_id", 0))
        if uf_id and uf_id not in ack_map:
            ack_map[uf_id] = ack_id

    return ack_map


def ack_anki_messages(ack_ids: list[str]) -> None:
    """Acknowledge delivered Anki messages in GCP Pub/Sub and local queue."""
    gcp_ack_ids = [a for a in ack_ids if not a.startswith("local-anki-")]
    local_ack_ids = [a for a in ack_ids if a.startswith("local-anki-")]

    for a_id in local_ack_ids:
        _local_anki_queue.pop(a_id, None)

    if gcp_ack_ids and _gcp_ready and GCP_PROJECT_ID:
        try:
            from google.cloud import pubsub_v1

            subscriber = pubsub_v1.SubscriberClient(client_options=_client_options())
            sub_path = subscriber.subscription_path(GCP_PROJECT_ID, PUBSUB_ANKI_SUB)
            subscriber.acknowledge(
                request={"subscription": sub_path, "ack_ids": gcp_ack_ids},
                timeout=10.0,
            )
        except Exception as exc:
            logger.warning("GCP Pub/Sub ack warning: %s", exc)
