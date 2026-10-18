from collections.abc import Generator
from sqlalchemy import create_engine, select
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATABASE_URL, DEFAULT_USER_ID

connect_args = (
    {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.models import User  # noqa: F401

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        existing_user = db.execute(
            select(User).where(User.id == DEFAULT_USER_ID)
        ).scalar_one_or_none()
        if existing_user is None:
            default_user = User(
                id=DEFAULT_USER_ID,
                email="engineer@cortexlog.dev",
                name="Default Engineer",
            )
            db.add(default_user)
            db.commit()
