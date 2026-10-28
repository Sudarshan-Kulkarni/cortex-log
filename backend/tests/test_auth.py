import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import get_db, Base, engine as prod_engine
# Override prod engine completely to avoid memory db issues
import app.database
from app.models import User, APIKey
import hashlib

# Test Database Setup
import sqlalchemy.pool
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=sqlalchemy.pool.StaticPool
)
import sqlalchemy.pool
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.database.engine = engine
app.database.SessionLocal = TestingSessionLocal

from app.main import app

app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    # Make sure all tables are created for tests
    from app.models import APIKey, User, Blog, UserBlog, Flashcard, UserFlashcard
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def test_unauthenticated_calendar():
    with TestClient(app) as test_client:
        response = test_client.get("/api/calendar?month=2023-10&today=2023-10-15")
        assert response.status_code == 403 or response.status_code == 401


def test_clerk_auth_fallback():
    # As configured, token "test_token" creates/uses a mock user
    with TestClient(app) as test_client:
        response = test_client.get("/api/calendar?month=2023-10&today=2023-10-15", headers={"Authorization": "Bearer test_token"})
        assert response.status_code == 200


def test_anki_pat_auth():
    with TestClient(app) as test_client:
        # Setup PAT
        with TestingSessionLocal() as db:
            user = User(clerk_user_id="pat_user", email="pat@example.com", name="PAT User")
            db.add(user)
            db.commit()
            db.refresh(user)

            raw_key = "cl_pat_mysecret"
            hashed = hashlib.sha256(raw_key.encode()).hexdigest()
            ak = APIKey(user_id=user.id, prefix="cl_pat_m", hashed_key=hashed)
            db.add(ak)
            db.commit()

        # Access endpoint with PAT
        response = test_client.post("/api/anki/pull", headers={"Authorization": "Bearer cl_pat_mysecret"})
        assert response.status_code == 200
        assert response.json().get("cards") == []


def test_invalid_pat_auth():
    with TestClient(app) as test_client:
        response = test_client.post("/api/anki/pull", headers={"Authorization": "Bearer cl_pat_invalid"})
        assert response.status_code == 401


def test_log_blog_authenticated():
    with TestClient(app) as test_client:
        response = test_client.post(
            "/api/blogs/log",
            headers={"Authorization": "Bearer test_token"},
            json={
                "logged_date": "2026-10-29",
                "raw_text": "Engineering blog post about distributed consensus algorithms and raft protocols.",
                "title": "Raft Consensus Explained",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Raft Consensus Explained"
        assert data["logged_date"] == "2026-10-29"
