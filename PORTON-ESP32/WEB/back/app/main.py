import base64
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
from pathlib import Path
import time
from typing import Any, AsyncGenerator

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .auth_service import (
    AuthService,
    verificar_admin_autenticado,
    verificar_usuario_autenticado,
)
from .config import Settings, get_settings
from .gemini_service import GeminiService
from .push_service import PushService
from .schemas import (
    ActualizarUsuarioRequest,
    CambiarPasswordRequest,
    ConsultaIaRequest,
    ConsultaIaResponse,
    CrearUsuarioRequest,
    EstadoPorton,
    LoginRequest,
    LoginResponse,
    MetodoConfirmacion,
    PushSubscriptionPayload,
    TelemetriaPayload,
    TelemetriaResponse,
    UsuarioAdminItem,
    UsuarioAutenticado,
)
from .supabase_service import SupabaseService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vigilante.api")

# Caché en memoria RAM para la última captura JPEG del ESP32 (~15-30 KB).
# Permite servir la imagen a los usuarios autenticados en <1ms sin gastar cuota de Egress
# de Supabase Storage, sincronizando al bucket solo en cambios de estado o cada 10 minutos.
_CAPTURA_RAM_CACHE: dict[str, Any] = {
    "bytes": None,
    "updated_at": None,
    "last_storage_sync_ts": 0.0,
}
STORAGE_BACKUP_INTERVAL_SEC = 600.0  # 10 minutos entre backups pasivos a Supabase Storage


async def obtener_captura_memoria_o_storage(supabase: SupabaseService) -> bytes | None:
    """Devuelve el último JPEG desde la RAM del servidor o hace fallback a Supabase Storage."""
    cached = _CAPTURA_RAM_CACHE.get("bytes")
    if isinstance(cached, (bytes, bytearray)) and len(cached) > 0:
        return bytes(cached)
    descargado = await supabase.descargar_ultima_captura()
    if descargado:
        _CAPTURA_RAM_CACHE["bytes"] = descargado
        _CAPTURA_RAM_CACHE["updated_at"] = datetime.now(timezone.utc).isoformat()
    return descargado


def formatear_duracion_humana(segundos: int) -> str:
    if segundos < 60:
        return f"{segundos} seg"
    minutos = segundos // 60
    resto_seg = segundos % 60
    if resto_seg == 0:
        return f"{minutos} min"
    return f"{minutos} min {resto_seg} seg"


def parse_iso_utc(iso_str: str | None) -> datetime | None:
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    supabase = SupabaseService(settings)
    eliminados = await supabase.limpiar_eventos_antiguos()
    if eliminados > 0:
        logger.info("Retención 90 días: se limpiaron %d eventos antiguos.", eliminados)
    yield


app = FastAPI(
    title="Vigilante Frente - Backend API",
    description=(
        "Backend intermediario Edge-First + Cloud Backup para monitoreo de portón corredizo "
        "(ESP32 + Supabase Realtime/Storage + Google Gemini 2.5 Flash + Web Push VAPID)."
    ),
    version="1.1.0",
    lifespan=lifespan,
)

settings_init = get_settings()
origins = (
    ["*"]
    if settings_init.cors_origins.strip() == "*"
    else [o.strip() for o in settings_init.cors_origins.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verificar_api_key_esp32(
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
    settings: Settings = Depends(get_settings),
) -> None:
    """Valida el header `x-api-key` enviado por el nodo Edge ESP32 (Regla 1 de AGENTS.md)."""
    if not x_api_key or x_api_key.strip() != settings.esp32_api_key.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Header x-api-key inválido o ausente.",
        )


@app.get("/api/health")
async def health_check(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "ok": True,
        "servicio": "vigilante-frente-backend",
        "supabase_url": settings.supabase_url,
        "bucket": settings.supabase_bucket,
        "gemini_configurado": bool(settings.gemini_api_key),
        "vapid_configurado": bool(settings.vapid_public_key and settings.vapid_private_key),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# AUTENTICACIÓN DE USUARIOS FAMILIARES (Tabla `public.usuarios` en Supabase)
# ---------------------------------------------------------------------------
@app.post("/api/auth/login", response_model=LoginResponse)
async def login_usuario(
    req: LoginRequest,
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    """
    Autentica un usuario contra la tabla `public.usuarios` de Supabase (con bcrypt).
    Además sincroniza su sesión con Supabase Auth para habilitar Realtime autenticado.
    """
    supabase = SupabaseService(settings)
    auth_service = AuthService(settings)

    usuario_db = await supabase.verificar_credenciales_db(req.username, req.password)
    if not usuario_db:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos, o cuenta deshabilitada.",
        )

    access_token = auth_service.crear_access_token(usuario_db)
    sb_access, sb_refresh = await supabase.sincronizar_sesion_supabase_auth(
        usuario_db, req.password
    )

    return LoginResponse(
        ok=True,
        access_token=access_token,
        supabase_access_token=sb_access,
        supabase_refresh_token=sb_refresh,
        usuario=UsuarioAutenticado(
            id=str(usuario_db["id"]),
            username=str(usuario_db["username"]),
            nombre=str(usuario_db.get("nombre") or "Familiar"),
            rol=str(usuario_db.get("rol") or "familiar"),
        ),
    )


@app.get("/api/auth/me", response_model=UsuarioAutenticado)
async def obtener_sesion_actual(
    usuario: UsuarioAutenticado = Depends(verificar_usuario_autenticado),
) -> UsuarioAutenticado:
    return usuario


@app.post("/api/auth/cambiar-password")
async def cambiar_propia_password(
    req: CambiarPasswordRequest,
    usuario: UsuarioAutenticado = Depends(verificar_usuario_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """
    Permite al usuario autenticado (ej. admin) cambiar su propia contraseña
    verificando primero la contraseña actual contra `public.usuarios`.
    """
    supabase = SupabaseService(settings)
    verificado = await supabase.verificar_credenciales_db(
        usuario.username, req.password_actual
    )
    if not verificado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual ingresada es incorrecta.",
        )

    actualizado = await supabase.actualizar_usuario(
        usuario.id, {"password": req.password_nueva}
    )
    if not actualizado:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo actualizar la contraseña en la base de datos.",
        )

    return {
        "ok": True,
        "mensaje": "Contraseña actualizada correctamente.",
    }


# ---------------------------------------------------------------------------
# ADMINISTRACIÓN DE USUARIOS (Exclusivo rol `admin`)
# ---------------------------------------------------------------------------
@app.get("/api/usuarios", response_model=list[UsuarioAdminItem])
async def listar_usuarios_admin(
    _admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> list[UsuarioAdminItem]:
    supabase = SupabaseService(settings)
    filas = await supabase.listar_usuarios()
    return [
        UsuarioAdminItem(
            id=str(u["id"]),
            username=str(u["username"]),
            nombre=str(u.get("nombre") or "Familiar"),
            rol=str(u.get("rol") or "familiar"),
            activo=bool(u.get("activo", True)),
            ultimo_acceso=u.get("ultimo_acceso"),
            created_at=u.get("created_at"),
        )
        for u in filas
    ]


@app.post("/api/usuarios", response_model=UsuarioAdminItem)
async def crear_usuario_admin(
    req: CrearUsuarioRequest,
    _admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> UsuarioAdminItem:
    supabase = SupabaseService(settings)
    creado = await supabase.crear_usuario(
        username=req.username,
        nombre=req.nombre,
        rol=req.rol,
        password=req.password,
        activo=req.activo,
    )
    if not creado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo crear el usuario (verificá que el nombre de usuario no exista ya).",
        )
    return UsuarioAdminItem(
        id=str(creado["id"]),
        username=str(creado["username"]),
        nombre=str(creado.get("nombre") or "Familiar"),
        rol=str(creado.get("rol") or "familiar"),
        activo=bool(creado.get("activo", True)),
        ultimo_acceso=creado.get("ultimo_acceso"),
        created_at=creado.get("created_at"),
    )


@app.patch("/api/usuarios/{usuario_id}", response_model=UsuarioAdminItem)
async def actualizar_usuario_admin(
    usuario_id: str,
    req: ActualizarUsuarioRequest,
    admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> UsuarioAdminItem:
    if usuario_id == admin.id:
        if req.activo is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No podés desactivar tu propia cuenta de administrador.",
            )
        if req.rol is not None and req.rol != "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No podés quitarte el rol de administrador a vos mismo.",
            )

    cambios: dict[str, Any] = {}
    if req.nombre is not None:
        cambios["nombre"] = req.nombre.strip()
    if req.rol is not None:
        cambios["rol"] = req.rol
    if req.activo is not None:
        cambios["activo"] = req.activo
    if req.password is not None and req.password.strip():
        cambios["password"] = req.password

    if not cambios:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se enviaron cambios para actualizar.",
        )

    supabase = SupabaseService(settings)
    actualizado = await supabase.actualizar_usuario(usuario_id, cambios)
    if not actualizado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró el usuario o no se pudo actualizar.",
        )

    return UsuarioAdminItem(
        id=str(actualizado["id"]),
        username=str(actualizado["username"]),
        nombre=str(actualizado.get("nombre") or "Familiar"),
        rol=str(actualizado.get("rol") or "familiar"),
        activo=bool(actualizado.get("activo", True)),
        ultimo_acceso=actualizado.get("ultimo_acceso"),
        created_at=actualizado.get("created_at"),
    )


@app.delete("/api/usuarios/{usuario_id}")
async def eliminar_usuario_admin(
    usuario_id: str,
    admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    if usuario_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No podés eliminar tu propia cuenta de administrador.",
        )

    supabase = SupabaseService(settings)
    eliminado = await supabase.eliminar_usuario(usuario_id)
    if not eliminado:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se pudo eliminar el usuario solicitado.",
        )

    return {
        "ok": True,
        "mensaje": "Usuario eliminado correctamente.",
    }


@app.get("/api/admin/usuarios")
async def listar_usuarios_admin_wrapped(
    admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    items = await listar_usuarios_admin(_admin=admin, settings=settings)
    return {"ok": True, "usuarios": [i.model_dump() for i in items]}


@app.post("/api/admin/usuarios")
async def crear_usuario_admin_wrapped(
    req: CrearUsuarioRequest,
    admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    item = await crear_usuario_admin(req=req, _admin=admin, settings=settings)
    return {"ok": True, "usuario": item.model_dump()}


@app.patch("/api/admin/usuarios/{usuario_id}")
async def actualizar_usuario_admin_wrapped(
    usuario_id: str,
    req: ActualizarUsuarioRequest,
    admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    item = await actualizar_usuario_admin(
        usuario_id=usuario_id, req=req, admin=admin, settings=settings
    )
    return {"ok": True, "usuario": item.model_dump()}


@app.delete("/api/admin/usuarios/{usuario_id}")
async def eliminar_usuario_admin_wrapped(
    usuario_id: str,
    admin: UsuarioAutenticado = Depends(verificar_admin_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    return await eliminar_usuario_admin(
        usuario_id=usuario_id, admin=admin, settings=settings
    )



@app.get("/api/estado")
async def obtener_estado_y_eventos_autenticado(
    _usuario: UsuarioAutenticado = Depends(verificar_usuario_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """
    Devuelve el estado actual y los eventos del día solo a usuarios autenticados.
    """
    supabase = SupabaseService(settings)
    estado_actual = await supabase.obtener_estado_actual()
    eventos_hoy = await supabase.listar_eventos_hoy(limite=50)
    return {
        "ok": True,
        "estado_actual": estado_actual,
        "eventos_hoy": eventos_hoy,
    }


# ---------------------------------------------------------------------------
# TELEMETRÍA Y CAPTURA DESDE EL NODO EDGE ESP32 (Protegido con `x-api-key`)
# ---------------------------------------------------------------------------
@app.post(
    "/api/captura",
    dependencies=[Depends(verificar_api_key_esp32)],
)
async def subir_captura_binaria(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """
    Endpoint liviano para que el ESP32 envíe directamente el buffer `jpgBuffer` (`image/jpeg`)
    sin usar memoria RAM extra en codificación Base64 ni `String` dinámico.
    Guarda siempre en caché RAM del backend y hace backup periódico a Supabase Storage.
    """
    jpeg_bytes = await request.body()
    if not jpeg_bytes:
        raise HTTPException(status_code=400, detail="Cuerpo de imagen JPEG vacío.")

    ahora_iso = datetime.now(timezone.utc).isoformat()
    ahora_ts = time.time()

    _CAPTURA_RAM_CACHE["bytes"] = jpeg_bytes
    _CAPTURA_RAM_CACHE["updated_at"] = ahora_iso

    supabase = SupabaseService(settings)
    captura_url = "/api/captura/ultima"

    # Sincronizar con Supabase Storage solo en el primer frame o cada 10 min (las transiciones sincronizan en /api/telemetria)
    ultimo_sync = float(_CAPTURA_RAM_CACHE.get("last_storage_sync_ts") or 0.0)
    persistido_en_storage = False
    if (ahora_ts - ultimo_sync) >= STORAGE_BACKUP_INTERVAL_SEC:
        url_storage = await supabase.subir_ultima_captura(jpeg_bytes)
        if url_storage:
            _CAPTURA_RAM_CACHE["last_storage_sync_ts"] = ahora_ts
            persistido_en_storage = True

    await supabase.actualizar_estado_actual(
        {
            "ultima_captura_url": captura_url,
            "updated_at": ahora_iso,
        }
    )
    return {
        "ok": True,
        "ultima_captura_url": captura_url,
        "persistido_en_storage": persistido_en_storage,
        "bytes": len(jpeg_bytes),
    }


@app.get("/api/captura/ultima")
async def obtener_ultima_captura_autenticada(
    _usuario: UsuarioAutenticado = Depends(verificar_usuario_autenticado),
    settings: Settings = Depends(get_settings),
) -> Response:
    """
    Sirve la última captura JPEG desde la memoria RAM del backend (o Supabase Storage como respaldo)
    exclusivamente a usuarios familiares autenticados (por Bearer token o `?token=`).
    """
    supabase = SupabaseService(settings)
    jpeg_bytes = await obtener_captura_memoria_o_storage(supabase)
    if not jpeg_bytes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aún no hay captura disponible desde el ESP32.",
        )

    return Response(
        content=jpeg_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
            "X-Captura-Updated-At": str(_CAPTURA_RAM_CACHE.get("updated_at") or ""),
        },
    )


@app.post(
    "/api/telemetria",
    response_model=TelemetriaResponse,
    dependencies=[Depends(verificar_api_key_esp32)],
)
async def procesar_telemetria(
    payload: TelemetriaPayload,
    settings: Settings = Depends(get_settings),
) -> TelemetriaResponse:
    """
    Endpoint principal invocado por el ESP32 (`POST /api/telemetria` con `x-api-key`).
    """
    ahora = datetime.now(timezone.utc)
    ahora_iso = ahora.isoformat()

    supabase = SupabaseService(settings)
    gemini = GeminiService(settings)
    push = PushService(settings, supabase)

    # 1. Procesar imagen si vino en base64 o usar la caché en RAM
    jpeg_bytes: bytes | None = None
    if payload.imagen_base64:
        try:
            b64_clean = payload.imagen_base64.split(",")[-1].strip()
            jpeg_bytes = base64.b64decode(b64_clean)
            _CAPTURA_RAM_CACHE["bytes"] = jpeg_bytes
            _CAPTURA_RAM_CACHE["updated_at"] = ahora_iso
        except Exception as exc:
            logger.warning("Imagen base64 inválida en telemetría: %s", exc)

    ultima_captura_url: str = "/api/captura/ultima"

    # 2. Leer estado previo desde Supabase (stateless)
    prev = await supabase.obtener_estado_actual() or {}
    estado_previo: EstadoPorton = prev.get("estado", "CERRADO")
    metodo_previo: MetodoConfirmacion = prev.get("metodo_confirmacion", "ESP32_LOCAL")
    abierto_desde_str: str | None = prev.get("abierto_desde")
    alerta_enviada: bool = bool(prev.get("alerta_enviada", False))
    camara_online_previa: bool = bool(prev.get("camara_online", True))

    # 3. Manejo de fallo de conexión con la cámara IP (6 fallos = 30s)
    if not payload.camara_online:
        if camara_online_previa:
            await supabase.registrar_evento(
                tipo="CAMARA_DESCONECTADA",
                titulo="Cámara Desconectada",
                detalle="6 fallos HTTP consecutivos (30s) hacia 192.168.0.166",
                metodo="ESP32_LOCAL",
            )
            await push.enviar_alerta_familiar(
                titulo="🔌 Cámara desconectada",
                cuerpo="El nodo ESP32 perdió conexión con la cámara IP del frente (30s sin respuesta).",
                tag="camara-offline",
            )
        await supabase.actualizar_estado_actual(
            {
                "camara_online": False,
                "updated_at": ahora_iso,
            }
        )
        return TelemetriaResponse(
            ok=True,
            estado_final=estado_previo,
            metodo_confirmacion=metodo_previo,
            cambio_estado=False,
            juez_ia_invocado=False,
            alerta_disparada=not camara_online_previa,
            segundos_abierto=0,
            ultima_captura_url=ultima_captura_url,
            detalle="Cámara reportada offline por el ESP32.",
        )

    # 4. Determinar si hay intención de cambio de estado confirmada por debounce (3/3)
    estado_final: EstadoPorton = payload.estado
    metodo_confirmacion: MetodoConfirmacion = "ESP32_LOCAL"
    juez_ia_invocado = False
    alerta_disparada = False
    detalle_respuesta = "Pulso procesado localmente."

    intenta_cambiar_estado = (
        payload.lecturas_consecutivas >= 3 and payload.estado != estado_previo
    )

    diff_val = payload.diff_porton if payload.diff_porton is not None else 0.0
    en_zona_gris = (
        settings.zona_gris_diff_min <= diff_val <= settings.zona_gris_diff_max
    )

    # Regla 4.1: Invocar a Gemini si intenta cambiar de estado dentro de la zona gris (-30.0 a -20.0)
    if intenta_cambiar_estado and payload.estado in ("ABIERTO", "CERRADO") and en_zona_gris:
        if not jpeg_bytes:
            jpeg_bytes = await obtener_captura_memoria_o_storage(supabase)
        veredicto = await gemini.evaluar_como_juez(
            telemetria=payload,
            motivo=f"Transición {estado_previo} -> {payload.estado} en zona gris (Diff={diff_val:+.1f})",
            jpeg_bytes=jpeg_bytes,
        )
        if veredicto:
            juez_ia_invocado = True
            estado_final = veredicto.estado_visual
            metodo_confirmacion = "JUEZ_IA"
            detalle_respuesta = f"Juez IA resolvió zona gris: {veredicto.justificacion}"
            await supabase.registrar_evento(
                tipo="VALIDACION_IA",
                titulo="Validación por Juez IA",
                detalle=f"Duda en zona gris ({diff_val:+.1f}) resuelta → {estado_final} ({veredicto.justificacion})",
                metodo="JUEZ_IA",
            )

    # Regla 4.2a: Revalidar visualmente con Gemini antes de disparar alerta crítica de CAMARA_MOVIDA
    elif intenta_cambiar_estado and payload.estado == "CAMARA_MOVIDA":
        if not jpeg_bytes:
            jpeg_bytes = await obtener_captura_memoria_o_storage(supabase)
        veredicto = await gemini.evaluar_como_juez(
            telemetria=payload,
            motivo=f"Alerta de cámara fuera de posición (Ancla Techo={payload.brillo_techo:.1f})",
            jpeg_bytes=jpeg_bytes,
        )
        if veredicto:
            juez_ia_invocado = True
            estado_final = veredicto.estado_visual
            metodo_confirmacion = "JUEZ_IA"
            detalle_respuesta = f"Juez IA evaluó encuadre: {veredicto.justificacion}"

    cambio_estado = payload.lecturas_consecutivas >= 3 and (estado_final != estado_previo)

    # 5. Gestionar transiciones de estado y temporizador stateless
    if cambio_estado:
        if estado_final == "ABIERTO":
            abierto_desde_str = ahora_iso
            alerta_enviada = False
            await supabase.registrar_evento(
                tipo="PORTON_ABIERTO",
                titulo="Portón Abierto",
                detalle=(
                    f"Validado por Juez IA · Diff {diff_val:+.1f}"
                    if metodo_confirmacion == "JUEZ_IA"
                    else f"Confirmado ({min(payload.lecturas_consecutivas, 3)}/3 lecturas) · Diff {diff_val:+.1f}"
                ),
                metodo=metodo_confirmacion,
                estado_texto="ABIERTO",
            )
            detalle_respuesta = "Transición a PORTÓN ABIERTO registrada."

        elif estado_final == "CERRADO":
            duracion_seg: int | None = None
            abierto_dt = parse_iso_utc(abierto_desde_str)
            if abierto_dt:
                duracion_seg = max(1, int((ahora - abierto_dt).total_seconds()))

            abierto_desde_str = None
            alerta_enviada = False

            origen_txt = "Juez IA" if metodo_confirmacion == "JUEZ_IA" else "Local ESP32"
            if estado_previo == "CAMARA_MOVIDA":
                detalle_ev = f"Encuadre normalizado (Techo {payload.brillo_techo:.0f}) · {origen_txt}"
            elif duracion_seg is not None:
                detalle_ev = f"Estuvo abierto {formatear_duracion_humana(duracion_seg)} · {origen_txt}"
            else:
                detalle_ev = f"Confirmado cerrado · {origen_txt}"

            await supabase.registrar_evento(
                tipo="PORTON_CERRADO",
                titulo="Portón Cerrado",
                detalle=detalle_ev,
                metodo=metodo_confirmacion,
                duracion_segundos=duracion_seg,
                estado_texto="CERRADO",
            )
            detalle_respuesta = "Transición a PORTÓN CERRADO registrada."

        elif estado_final == "CAMARA_MOVIDA":
            alerta_disparada = True
            await supabase.registrar_evento(
                tipo="CAMARA_MOVIDA",
                titulo="¡Cámara Fuera de Posición!",
                detalle=f"Ancla Techo fuera de rango ({payload.brillo_techo:.0f}) en horario {'diurno' if payload.es_de_dia else 'nocturno'}",
                metodo=metodo_confirmacion,
                estado_texto="CAMARA_MOVIDA",
            )
            await push.enviar_alerta_familiar(
                titulo="🚨 ¡Cámara fuera de posición!",
                cuerpo="Se detectó que la cámara del frente se movió o perdió su ángulo de referencia.",
                tag="camara-movida",
            )
            detalle_respuesta = "Alerta crítica de CÁMARA MOVIDA registrada y enviada."
    else:
        if not juez_ia_invocado:
            metodo_confirmacion = metodo_previo

    # 6. Regla 3 y 4.2b: Evaluar Temporizador Stateless de 10 minutos (600 segundos)
    segundos_abierto = 0
    if estado_final == "ABIERTO":
        if not abierto_desde_str:
            abierto_desde_str = ahora_iso
        abierto_dt = parse_iso_utc(abierto_desde_str)
        if abierto_dt:
            segundos_abierto = max(0, int((ahora - abierto_dt).total_seconds()))

        if segundos_abierto >= settings.tiempo_alerta_segundos and not alerta_enviada:
            if not jpeg_bytes:
                jpeg_bytes = await obtener_captura_memoria_o_storage(supabase)

            veredicto_alerta = await gemini.evaluar_como_juez(
                telemetria=payload,
                motivo=f"Revalidación previa a alerta crítica: portón lleva {segundos_abierto}s (>10 min) abierto",
                jpeg_bytes=jpeg_bytes,
            )

            if veredicto_alerta and veredicto_alerta.estado_visual == "CERRADO":
                juez_ia_invocado = True
                estado_final = "CERRADO"
                metodo_confirmacion = "JUEZ_IA"
                abierto_desde_str = None
                alerta_enviada = False
                segundos_abierto = 0
                await supabase.registrar_evento(
                    tipo="VALIDACION_IA",
                    titulo="Falsa Alarma Evitada por Juez IA",
                    detalle=f"Revalidación a los 10 min detectó portón CERRADO ({veredicto_alerta.justificacion})",
                    metodo="JUEZ_IA",
                    estado_texto="CERRADO",
                )
                detalle_respuesta = "Juez IA corrigió falso positivo antes de enviar alerta de 10 min."
            else:
                if veredicto_alerta:
                    juez_ia_invocado = True
                    metodo_confirmacion = "JUEZ_IA"
                alerta_enviada = True
                alerta_disparada = True
                justif = (
                    f" · {veredicto_alerta.justificacion}"
                    if veredicto_alerta
                    else ""
                )
                await supabase.registrar_evento(
                    tipo="ALERTA_TIEMPO",
                    titulo="Alerta: >10 min Abierto",
                    detalle=f"Tiempo límite superado ({formatear_duracion_humana(segundos_abierto)}){justif}",
                    metodo=metodo_confirmacion,
                    duracion_segundos=segundos_abierto,
                    estado_texto="ALERTA_TIEMPO",
                )
                await push.enviar_alerta_familiar(
                    titulo="⚠️ ¡Portón abierto hace más de 10 min!",
                    cuerpo=f"El portón corredizo lleva {formatear_duracion_humana(segundos_abierto)} abierto. Revisá la PWA.",
                    tag="porton-10min",
                )
                detalle_respuesta = "Alerta >10 min disparada y notificada por Web Push."

    # 7. Si hubo un evento relevante (cambio de estado, Juez IA o alerta), respaldar la imagen de RAM en Supabase Storage
    if cambio_estado or juez_ia_invocado or alerta_disparada:
        img_para_backup = jpeg_bytes or _CAPTURA_RAM_CACHE.get("bytes")
        if isinstance(img_para_backup, (bytes, bytearray)) and len(img_para_backup) > 0:
            await supabase.subir_ultima_captura(bytes(img_para_backup))
            _CAPTURA_RAM_CACHE["last_storage_sync_ts"] = time.time()

    # 8. Persistir estado actual en Supabase
    await supabase.actualizar_estado_actual(
        {
            "estado": estado_final,
            "metodo_confirmacion": metodo_confirmacion,
            "lecturas_consecutivas": min(payload.lecturas_consecutivas, 3),
            "brillo_a": round(payload.brillo_a, 1),
            "brillo_b": round(payload.brillo_b, 1),
            "diff_porton": round(diff_val, 1),
            "brillo_techo": round(payload.brillo_techo, 1),
            "brillo_rincon": round(payload.brillo_rincon, 1),
            "es_de_dia": payload.es_de_dia,
            "abierto_desde": abierto_desde_str,
            "alerta_enviada": alerta_enviada,
            "ultima_captura_url": ultima_captura_url,
            "camara_online": True,
            "updated_at": ahora_iso,
        }
    )

    return TelemetriaResponse(
        ok=True,
        estado_final=estado_final,
        metodo_confirmacion=metodo_confirmacion,
        cambio_estado=cambio_estado,
        juez_ia_invocado=juez_ia_invocado,
        alerta_disparada=alerta_disparada,
        segundos_abierto=segundos_abierto,
        ultima_captura_url=ultima_captura_url,
        detalle=detalle_respuesta,
    )


# ---------------------------------------------------------------------------
# ENDPOINTS PROTEGIDOS PARA LA PWA FAMILIAR (Requieren Bearer Token válido)
# ---------------------------------------------------------------------------
@app.post("/api/consultar-ia", response_model=ConsultaIaResponse)
async def consultar_asistente_visual(
    req: ConsultaIaRequest,
    _usuario: UsuarioAutenticado = Depends(verificar_usuario_autenticado),
    settings: Settings = Depends(get_settings),
) -> ConsultaIaResponse:
    """
    Endpoint invocado bajo demanda desde el módulo 'Consulta Visual a la IA' de la PWA.
    Requiere sesión iniciada.
    """
    supabase = SupabaseService(settings)
    gemini = GeminiService(settings)

    estado_actual = await supabase.obtener_estado_actual()
    jpeg_bytes = await obtener_captura_memoria_o_storage(supabase)

    respuesta_texto = await gemini.responder_consulta_visual(
        pregunta=req.pregunta,
        jpeg_bytes=jpeg_bytes,
        estado_contexto=estado_actual,
    )

    ahora_iso = datetime.now(timezone.utc).isoformat()
    ts_captura = (
        estado_actual.get("updated_at", ahora_iso) if estado_actual else ahora_iso
    )

    return ConsultaIaResponse(
        pregunta=req.pregunta,
        respuesta=respuesta_texto,
        timestamp_captura=ts_captura,
        consultado_en=ahora_iso,
    )


@app.post("/api/push/suscribir")
async def suscribir_notificaciones_push(
    payload: PushSubscriptionPayload,
    request: Request,
    _usuario: UsuarioAutenticado = Depends(verificar_usuario_autenticado),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """
    Registra o actualiza una suscripción Web Push VAPID de un navegador familiar autenticado.
    """
    supabase = SupabaseService(settings)
    user_agent = request.headers.get("user-agent")
    guardado = await supabase.guardar_suscripcion_push(
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        user_agent=user_agent,
    )
    if not guardado:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo almacenar la suscripción Web Push en Supabase.",
        )

    return {
        "ok": True,
        "mensaje": "Suscripción Web Push registrada correctamente.",
    }


# ---------------------------------------------------------------------------
# SERVIDOR ESTÁTICO DE LA PWA COMPILADA (Despliegue Todo-en-Uno Render/Koyeb)
# ---------------------------------------------------------------------------
_CANDIDATE_STATIC_DIRS = [
    Path(__file__).resolve().parent.parent / "static",
    Path(__file__).resolve().parent.parent.parent / "front" / "dist",
]
_FRONTEND_DIST_DIR: Path | None = next(
    (p for p in _CANDIDATE_STATIC_DIRS if p.is_dir() and (p / "index.html").is_file()),
    None,
)

if _FRONTEND_DIST_DIR:
    assets_dir = _FRONTEND_DIST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="pwa-assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def servir_pwa_spa(full_path: str) -> Response:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Ruta API no encontrada.")

        if full_path:
            archivo_candidato = (_FRONTEND_DIST_DIR / full_path).resolve()
            if (
                str(archivo_candidato).startswith(str(_FRONTEND_DIST_DIR.resolve()))
                and archivo_candidato.is_file()
            ):
                return FileResponse(str(archivo_candidato))

        return FileResponse(str(_FRONTEND_DIST_DIR / "index.html"))
