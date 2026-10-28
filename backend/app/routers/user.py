import hashlib
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import APIKey, User

router = APIRouter(prefix="/api/user", tags=["User"])

class APIKeyResponse(BaseModel):
    id: int
    prefix: str
    created_at: str
    last_used_at: str | None

    class Config:
        from_attributes = True

class APIKeyCreateResponse(BaseModel):
    api_key: str
    id: int

@router.get("/api-keys", response_model=list[APIKeyResponse])
def list_api_keys(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    keys = db.execute(
        select(APIKey).where(APIKey.user_id == current_user.id).order_by(APIKey.created_at.desc())
    ).scalars().all()

    return [
        APIKeyResponse(
            id=k.id,
            prefix=k.prefix,
            created_at=k.created_at.isoformat(),
            last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
        )
        for k in keys
    ]

@router.post("/api-keys", response_model=APIKeyCreateResponse)
def create_api_key(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    raw_token = f"cl_pat_{secrets.token_urlsafe(32)}"
    hashed_key = hashlib.sha256(raw_token.encode()).hexdigest()
    prefix = raw_token[:12] # cl_pat_ + 5 chars

    new_key = APIKey(
        user_id=current_user.id,
        prefix=prefix,
        hashed_key=hashed_key,
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)

    return APIKeyCreateResponse(api_key=raw_token, id=new_key.id)

@router.delete("/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_key(
    key_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    key = db.execute(
        select(APIKey).where(APIKey.id == key_id, APIKey.user_id == current_user.id)
    ).scalar_one_or_none()

    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")

    db.delete(key)
    db.commit()
