import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from typing import Any

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings
from .schemas import UsuarioAutenticado
from .supabase_service import SupabaseService

security_bearer = HTTPBearer(auto_error=False)


class AuthService:
    """
    Servicio de autenticación JWT (HMAC-SHA256) vinculado en vivo con `public.usuarios` en Supabase.
    Permite administrar usuarios (crear, cambiar clave en texto plano que se hashea con bcrypt,
    o desactivar `activo = false`) directamente desde el Table Editor de Supabase.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # Derivar clave de firma desde service_role o esp32_api_key
        secret_seed = (
            settings.supabase_service_role_key
            or settings.supabase_backend_key
            or settings.esp32_api_key
        )
        self.signing_key = hashlib.sha256(
            f"vigilante-frente-jwt::{secret_seed}".encode("utf-8")
        ).digest()

    def crear_access_token(
        self, usuario: dict[str, Any], expira_horas: int = 168
    ) -> str:
        ahora = datetime.now(timezone.utc)
        exp = ahora + timedelta(hours=expira_horas)
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "sub": str(usuario["id"]),
            "username": str(usuario["username"]),
            "nombre": str(usuario.get("nombre") or "Familiar"),
            "rol": str(usuario.get("rol") or "familiar"),
            "iat": int(ahora.timestamp()),
            "exp": int(exp.timestamp()),
        }

        h_b64 = (
            base64.urlsafe_b64encode(json.dumps(header, separators=(",", ":")).encode())
            .rstrip(b"=")
            .decode("ascii")
        )
        p_b64 = (
            base64.urlsafe_b64encode(
                json.dumps(payload, separators=(",", ":")).encode()
            )
            .rstrip(b"=")
            .decode("ascii")
        )
        mensaje = f"{h_b64}.{p_b64}".encode("ascii")
        firma = hmac.new(self.signing_key, mensaje, hashlib.sha256).digest()
        s_b64 = base64.urlsafe_b64encode(firma).rstrip(b"=").decode("ascii")
        return f"{h_b64}.{p_b64}.{s_b64}"

    def verificar_access_token(self, token: str) -> dict[str, Any] | None:
        partes = token.split(".")
        if len(partes) != 3:
            return None
        h_b64, p_b64, s_b64 = partes
        mensaje = f"{h_b64}.{p_b64}".encode("ascii")
        firma_esperada = (
            base64.urlsafe_b64encode(
                hmac.new(self.signing_key, mensaje, hashlib.sha256).digest()
            )
            .rstrip(b"=")
            .decode("ascii")
        )
        if not hmac.compare_digest(firma_esperada, s_b64):
            return None

        try:
            padding = "=" * ((4 - (len(p_b64) % 4)) % 4)
            payload = json.loads(base64.urlsafe_b64decode(p_b64 + padding).decode("utf-8"))
            exp = int(payload.get("exp", 0))
            if datetime.now(timezone.utc).timestamp() >= exp:
                return None
            return payload
        except Exception:
            return None


async def verificar_usuario_autenticado(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_bearer),
    token_query: str | None = Query(default=None, alias="token"),
    settings: Settings = Depends(get_settings),
) -> UsuarioAutenticado:
    """
    Dependencia FastAPI que exige un Bearer token válido (o `?token=` para `<img>` autenticada)
    y verifica en Supabase que el usuario exista y siga con `activo = true` en `public.usuarios`.
    """
    raw_token = (
        credentials.credentials.strip()
        if (credentials and credentials.credentials)
        else (token_query.strip() if token_query else "")
    )
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión requerida. Iniciá sesión para continuar.",
        )

    token = raw_token
    auth_service = AuthService(settings)
    supabase = SupabaseService(settings)

    payload = auth_service.verificar_access_token(token)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de sesión inválido o expirado.",
        )

    usuario_db = await supabase.obtener_usuario_por_id(str(payload["sub"]))
    if not usuario_db or not usuario_db.get("activo", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario deshabilitado o inexistente en la base de datos.",
        )

    return UsuarioAutenticado(
        id=str(usuario_db["id"]),
        username=str(usuario_db["username"]),
        nombre=str(usuario_db.get("nombre") or "Familiar"),
        rol=str(usuario_db.get("rol") or "familiar"),
    )
