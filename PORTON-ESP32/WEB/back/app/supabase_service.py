from datetime import datetime, timedelta, timezone
import logging
from typing import Any
import httpx

from .config import Settings

logger = logging.getLogger("vigilante.supabase")


class SupabaseService:
    """
    Cliente asíncrono liviano sobre PostgREST, GoTrue Auth y Supabase Storage.
    Aplica timeouts estrictos para no bloquear el ACK hacia el ESP32 y garantiza
    la política de almacenamiento cero-crecimiento (`ultima_captura.jpg` con `x-upsert: true`).
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_url = settings.supabase_url.rstrip("/")
        self.rest_url = f"{self.base_url}/rest/v1"
        self.storage_url = f"{self.base_url}/storage/v1"
        self.auth_url = f"{self.base_url}/auth/v1"

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        key = self.settings.effective_supabase_key
        headers: dict[str, str] = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "x-backend-key": self.settings.supabase_backend_key,
        }
        if extra:
            headers.update(extra)
        return headers

    def get_public_captura_url(self) -> str:
        """Ruta relativa autenticada servida desde la caché en RAM del backend."""
        return "/api/captura/ultima"

    async def verificar_credenciales_db(
        self, username: str, password: str
    ) -> dict[str, Any] | None:
        """
        Invoca la función RPC `public.verificar_credenciales_usuario` que valida
        el hash bcrypt (`pgcrypto`) contra la tabla `public.usuarios`.
        """
        url = f"{self.rest_url}/rpc/verificar_credenciales_usuario"
        headers = self._headers({"Content-Type": "application/json"})
        payload = {"p_username": username.strip(), "p_password": password}
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                rows = resp.json()
                if not rows:
                    return None
                usuario = rows[0]

                # Registrar último acceso
                await client.patch(
                    f"{self.rest_url}/usuarios?id=eq.{usuario['id']}",
                    headers=headers,
                    json={"ultimo_acceso": datetime.now(timezone.utc).isoformat()},
                )
                return usuario
        except Exception as exc:
            logger.error("Error verificando credenciales en Supabase: %s", exc)
            return None

    async def sincronizar_sesion_supabase_auth(
        self, usuario: dict[str, Any], raw_password: str
    ) -> tuple[str | None, str | None]:
        """
        Asegura que el usuario de `public.usuarios` tenga cuenta en `auth.users`
        (para que Supabase Realtime y RLS `TO authenticated` funcionen nativamente)
        y devuelve `(supabase_access_token, supabase_refresh_token)`.
        """
        uname = str(usuario["username"]).strip().lower()
        email = uname if "@" in uname else f"{uname}@vigilantefrente.local"
        auth_user_id = usuario.get("auth_user_id")

        try:
            async with httpx.AsyncClient(timeout=7.0) as client:
                # 1. Si aún no tiene auth_user_id en public.usuarios, crear o actualizar en GoTrue Admin API
                if not auth_user_id:
                    create_resp = await client.post(
                        f"{self.auth_url}/admin/users",
                        headers=self._headers({"Content-Type": "application/json"}),
                        json={
                            "email": email,
                            "password": raw_password,
                            "email_confirm": True,
                            "user_metadata": {"nombre": usuario.get("nombre", "Familiar")},
                        },
                    )
                    if create_resp.status_code in (200, 201):
                        created_user = create_resp.json()
                        auth_user_id = created_user.get("id")
                        if auth_user_id:
                            await client.patch(
                                f"{self.rest_url}/usuarios?id=eq.{usuario['id']}",
                                headers=self._headers({"Content-Type": "application/json"}),
                                json={"auth_user_id": auth_user_id},
                            )
                else:
                    # Sincronizar contraseña en GoTrue Admin por si el admin la cambió en public.usuarios
                    await client.put(
                        f"{self.auth_url}/admin/users/{auth_user_id}",
                        headers=self._headers({"Content-Type": "application/json"}),
                        json={
                            "email": email,
                            "password": raw_password,
                            "email_confirm": True,
                        },
                    )

                # 2. Iniciar sesión en GoTrue para obtener el JWT de Supabase Realtime
                anon_key = (
                    self.settings.supabase_anon_key or self.settings.effective_supabase_key
                )
                token_resp = await client.post(
                    f"{self.auth_url}/token?grant_type=password",
                    headers={
                        "apikey": anon_key,
                        "Content-Type": "application/json",
                    },
                    json={"email": email, "password": raw_password},
                )
                if token_resp.status_code == 200:
                    tok = token_resp.json()
                    return tok.get("access_token"), tok.get("refresh_token")
        except Exception as exc:
            logger.warning("No se pudo sincronizar sesión GoTrue opcional: %s", exc)

        return None, None

    async def obtener_usuario_por_id(self, user_id: str) -> dict[str, Any] | None:
        url = f"{self.rest_url}/usuarios?id=eq.{user_id}&select=id,username,nombre,rol,activo,auth_user_id,ultimo_acceso,created_at"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                rows = resp.json()
                return rows[0] if rows else None
        except Exception as exc:
            logger.warning("Error consultando usuario %s: %s", user_id, exc)
            return None

    async def listar_usuarios(self) -> list[dict[str, Any]]:
        url = (
            f"{self.rest_url}/usuarios"
            "?select=id,username,nombre,rol,activo,ultimo_acceso,created_at"
            "&order=created_at.asc"
        )
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.error("Error listando usuarios en Supabase: %s", exc)
            return []

    async def crear_usuario(
        self,
        username: str,
        nombre: str,
        rol: str,
        password: str,
        activo: bool = True,
    ) -> dict[str, Any] | None:
        url = f"{self.rest_url}/usuarios"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
        )
        body = {
            "username": username.strip().lower(),
            "nombre": nombre.strip(),
            "rol": rol.strip().lower(),
            "password": password,
            "activo": activo,
        }
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(url, headers=headers, json=body)
                resp.raise_for_status()
                rows = resp.json()
                return rows[0] if rows else None
        except Exception as exc:
            logger.error("Error creando usuario %s en Supabase: %s", username, exc)
            return None

    async def actualizar_usuario(
        self, user_id: str, cambios: dict[str, Any]
    ) -> dict[str, Any] | None:
        actual = await self.obtener_usuario_por_id(user_id)
        if not actual:
            return None

        # Incluir siempre `username` para que el trigger `trg_hash_usuario_password`
        # sincronice el estado, rol, nombre y contraseña con `auth.users`.
        payload = {"username": actual["username"], **cambios}
        url = f"{self.rest_url}/usuarios?id=eq.{user_id}"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
        )
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.patch(url, headers=headers, json=payload)
                resp.raise_for_status()
                rows = resp.json()
                return rows[0] if rows else None
        except Exception as exc:
            logger.error("Error actualizando usuario %s en Supabase: %s", user_id, exc)
            return None

    async def eliminar_usuario(self, user_id: str) -> bool:
        actual = await self.obtener_usuario_por_id(user_id)
        if not actual:
            return False

        url = f"{self.rest_url}/usuarios?id=eq.{user_id}"
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.delete(url, headers=self._headers())
                resp.raise_for_status()
                auth_uid = actual.get("auth_user_id")
                if auth_uid:
                    await client.delete(
                        f"{self.auth_url}/admin/users/{auth_uid}",
                        headers=self._headers(),
                    )
                return True
        except Exception as exc:
            logger.error("Error eliminando usuario %s en Supabase: %s", user_id, exc)
            return False

    async def obtener_estado_actual(self) -> dict[str, Any] | None:
        url = f"{self.rest_url}/estado_actual?id=eq.1&select=*"
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                rows = resp.json()
                return rows[0] if rows else None
        except Exception as exc:
            logger.warning("No se pudo leer estado_actual desde Supabase: %s", exc)
            return None

    async def listar_eventos_hoy(self, limite: int = 50) -> list[dict[str, Any]]:
        ahora = datetime.now(timezone.utc)
        inicio_dia = ahora.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=3)
        inicio_iso = inicio_dia.strftime("%Y-%m-%dT%H:%M:%SZ")
        url = (
            f"{self.rest_url}/eventos_porton"
            f"?created_at=gte.{inicio_iso}"
            f"&order=created_at.desc&limit={limite}"
        )
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Error listando eventos de hoy: %s", exc)
            return []

    async def actualizar_estado_actual(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        url = f"{self.rest_url}/estado_actual?id=eq.1"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation,resolution=merge-duplicates",
            }
        )
        datos = {"id": 1, **payload}
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(url, headers=headers, json=datos)
                resp.raise_for_status()
                rows = resp.json()

                # Sincronizar también tabla legacy estado_porton
                await client.patch(
                    f"{self.rest_url}/estado_porton?id=eq.1",
                    headers=self._headers({"Content-Type": "application/json"}),
                    json={
                        "estado": datos.get("estado", "CERRADO"),
                        "actualizado_at": datos.get(
                            "updated_at", datetime.now(timezone.utc).isoformat()
                        ),
                    },
                )
                return rows[0] if rows else datos
        except Exception as exc:
            logger.error("Error actualizando estado_actual en Supabase: %s", exc)
            return None

    async def registrar_evento(
        self,
        tipo: str,
        titulo: str,
        detalle: str,
        metodo: str = "ESP32_LOCAL",
        duracion_segundos: int | None = None,
        estado_texto: str | None = None,
    ) -> dict[str, Any] | None:
        url = f"{self.rest_url}/eventos_porton"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
        )
        body = {
            "tipo": tipo,
            "titulo": titulo,
            "detalle": detalle,
            "metodo": metodo,
            "duracion_segundos": duracion_segundos,
            "duracion_seg": duracion_segundos or 0,
            "estado": estado_texto or tipo,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(url, headers=headers, json=body)
                resp.raise_for_status()
                rows = resp.json()
                return rows[0] if rows else body
        except Exception as exc:
            logger.error("Error insertando evento en eventos_porton: %s", exc)
            return None

    async def subir_ultima_captura(self, jpeg_bytes: bytes) -> str | None:
        """
        Sobrescribe SIEMPRE `ultima_captura.jpg` (`x-upsert: true`) cumpliendo
        la Política de Almacenamiento Cero-Crecimiento de AGENTS.md.
        """
        if not jpeg_bytes:
            return None

        bucket = self.settings.supabase_bucket
        url = f"{self.storage_url}/object/{bucket}/ultima_captura.jpg"
        headers = self._headers(
            {
                "Content-Type": "image/jpeg",
                "x-upsert": "true",
                "Cache-Control": "no-cache, no-store, must-revalidate",
            }
        )
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(url, headers=headers, content=jpeg_bytes)
                if resp.status_code >= 400:
                    resp = await client.put(url, headers=headers, content=jpeg_bytes)
                resp.raise_for_status()
                return self.get_public_captura_url()
        except Exception as exc:
            logger.warning("Error sobrescribiendo ultima_captura.jpg en Storage: %s", exc)
            return None

    async def descargar_ultima_captura(self) -> bytes | None:
        """Descarga `ultima_captura.jpg` desde el bucket privado usando credenciales del backend, o desde la cámara en LAN."""
        bucket = self.settings.supabase_bucket
        url = f"{self.storage_url}/object/{bucket}/ultima_captura.jpg"
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(url, headers=self._headers())
                if resp.status_code == 200 and resp.content:
                    return resp.content
        except Exception as exc:
            logger.debug("No se pudo descargar ultima_captura.jpg de Storage: %s", exc)

        # Fallback: intentar capturar directo de la cámara IP local si el backend corre en LAN
        if self.settings.cam_snapshot_url:
            try:
                async with httpx.AsyncClient(timeout=3.5) as client:
                    cam_resp = await client.get(self.settings.cam_snapshot_url)
                    if cam_resp.status_code == 200 and cam_resp.content:
                        await self.subir_ultima_captura(cam_resp.content)
                        return cam_resp.content
            except Exception:
                pass
        return None

    async def guardar_suscripcion_push(
        self, endpoint: str, p256dh: str, auth: str, user_agent: str | None = None
    ) -> bool:
        url = f"{self.rest_url}/push_subscriptions?on_conflict=endpoint"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            }
        )
        payload = {
            "endpoint": endpoint,
            "p256dh": p256dh,
            "auth": auth,
            "user_agent": user_agent,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                return True
        except Exception as exc:
            logger.error("Error guardando suscripción Web Push: %s", exc)
            return False

    async def listar_suscripciones_push(self) -> list[dict[str, Any]]:
        url = f"{self.rest_url}/push_subscriptions?select=*"
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            logger.warning("Error listando suscripciones Web Push: %s", exc)
            return []

    async def eliminar_suscripcion_push(self, endpoint: str) -> None:
        url = f"{self.rest_url}/push_subscriptions?endpoint=eq.{endpoint}"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.delete(url, headers=self._headers())
        except Exception:
            pass

    async def limpiar_eventos_antiguos(self, dias: int | None = None) -> int:
        """Elimina eventos con más de 90 días de antigüedad (Regla 5 de AGENTS.md)."""
        retencion = dias or self.settings.retencion_historial_dias
        limite_iso = (datetime.now(timezone.utc) - timedelta(days=retencion)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        url = f"{self.rest_url}/eventos_porton?created_at=lt.{limite_iso}"
        headers = self._headers({"Prefer": "return=representation"})
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.delete(url, headers=headers)
                resp.raise_for_status()
                borrados = resp.json()
                return len(borrados) if isinstance(borrados, list) else 0
        except Exception as exc:
            logger.warning("No se pudo ejecutar limpieza de eventos >%d días: %s", retencion, exc)
            return 0
