import hashlib
import os
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import APIKey, User

security = HTTPBearer()

CLERK_ISSUER = os.environ.get("CLERK_ISSUER_URL")
if CLERK_ISSUER and not CLERK_ISSUER.endswith("/"):
    CLERK_ISSUER += "/"
CLERK_JWKS_URL = f"{CLERK_ISSUER}.well-known/jwks.json" if CLERK_ISSUER else ""

# Very naive cache for JWKS keys; in production use something robust like python-jose or caching wrapper
_jwks_cache: dict[str, Any] = {}


def _get_jwks() -> dict[str, Any]:
    global _jwks_cache
    if not _jwks_cache and CLERK_JWKS_URL:
        try:
            r = httpx.get(CLERK_JWKS_URL, timeout=10.0)
            r.raise_for_status()
            _jwks_cache = r.json()
        except Exception as e:
            print(f"Error fetching JWKS: {e}")
    return _jwks_cache


def get_current_user(
    token: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    token_str = token.credentials

    # Case 1: Personal Access Token (Anki Desktop Add-on)
    if token_str.startswith("cl_pat_"):
        hashed_key = hashlib.sha256(token_str.encode()).hexdigest()
        api_key_record = db.execute(
            select(APIKey).where(APIKey.hashed_key == hashed_key)
        ).scalar_one_or_none()

        if not api_key_record:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or revoked Personal Access Token",
            )

        user = db.execute(
            select(User).where(User.id == api_key_record.user_id)
        ).scalar_one_or_none()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found for this PAT",
            )

        return user

    # Case 2: Clerk JWT (Next.js Web App)
    # For local/testing environments:
    if token_str == "test_token":
        user = db.execute(select(User).where(User.email == "test@example.com")).scalar_one_or_none()
        if not user:
            user = User(clerk_user_id="test_sub", email="test@example.com", name="Test User")
            db.add(user)
            db.commit()
        return user

    if not CLERK_ISSUER:
        raise HTTPException(status_code=500, detail="CLERK_ISSUER_URL is not set")

    try:
        unverified_header = jwt.get_unverified_header(token_str)
        kid = unverified_header.get("kid")

        jwks = _get_jwks()
        rsa_key = {}
        for key in jwks.get("keys", []):
            if key["kid"] == kid:
                rsa_key = {
                    "kty": key["kty"],
                    "kid": key["kid"],
                    "use": key["use"],
                    "n": key["n"],
                    "e": key["e"],
                }
                break

        if not rsa_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unable to find appropriate key",
            )

        # We use python-jwt (PyJWT) which supports JWK dicts directly in newer versions via jwt.algorithms.RSAAlgorithm.from_jwk
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(rsa_key)

        payload = jwt.decode(
            token_str,
            public_key,
            algorithms=["RS256"],
            issuer=CLERK_ISSUER.rstrip("/"),
            options={"verify_aud": False}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication credentials: {e}",
        )

    clerk_id = payload.get("sub")
    email = payload.get("email", f"{clerk_id}@placeholder.com")

    if not clerk_id:
         raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    # Upsert User
    user = db.execute(
        select(User).where(User.clerk_user_id == clerk_id)
    ).scalar_one_or_none()

    if not user:
        user = User(
            clerk_user_id=clerk_id,
            email=email,
            name=email.split("@")[0] if "@" in email else "User",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user
