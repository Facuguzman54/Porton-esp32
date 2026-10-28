from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EstadoPorton = Literal["CERRADO", "ABIERTO", "CAMARA_MOVIDA"]
MetodoConfirmacion = Literal["ESP32_LOCAL", "JUEZ_IA"]
TipoEvento = Literal[
    "PORTON_CERRADO",
    "PORTON_ABIERTO",
    "VALIDACION_IA",
    "ALERTA_TIEMPO",
    "CAMARA_MOVIDA",
    "CAMARA_DESCONECTADA",
]


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=120)
    password: str = Field(..., min_length=3, max_length=128)


class UsuarioAutenticado(BaseModel):
    id: str
    username: str
    nombre: str
    rol: str


class LoginResponse(BaseModel):
    ok: bool = True
    access_token: str
    supabase_access_token: str | None = None
    supabase_refresh_token: str | None = None
    usuario: UsuarioAutenticado


class CambiarPasswordRequest(BaseModel):
    password_actual: str = Field(..., min_length=1, max_length=128)
    password_nueva: str = Field(..., min_length=4, max_length=128)


class UsuarioAdminItem(BaseModel):
    id: str
    username: str
    nombre: str
    rol: Literal["admin", "familiar"] | str
    activo: bool
    ultimo_acceso: str | None = None
    created_at: str | None = None


class CrearUsuarioRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=80)
    nombre: str = Field(..., min_length=1, max_length=120)
    rol: Literal["admin", "familiar"] = "familiar"
    password: str = Field(..., min_length=4, max_length=128)
    activo: bool = True


CrearUsuarioAdminRequest = CrearUsuarioRequest


class ActualizarUsuarioRequest(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=120)
    rol: Literal["admin", "familiar"] | None = None
    password: str | None = Field(default=None, min_length=4, max_length=128)
    activo: bool | None = None


ActualizarUsuarioAdminRequest = ActualizarUsuarioRequest



class TelemetriaPayload(BaseModel):
    """
    Payload enviado cada 5 segundos por el nodo Edge ESP32 a `POST /api/telemetria`.
    Respeta estrictamente las métricas de las ROIs calibradas en `main.cpp`.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    estado: EstadoPorton = Field(
        ...,
        description="Estado determinado por el ESP32: CERRADO, ABIERTO o CAMARA_MOVIDA.",
    )
    lecturas_consecutivas: int = Field(
        default=3,
        ge=1,
        le=100,
        description="Cantidad de lecturas consecutivas idénticas (debounce 3/3 = 15s).",
    )
    brillo_a: float = Field(
        ...,
        ge=0.0,
        le=255.0,
        description="Brillo promedio (0-255) en Zona A (Pared de referencia: X 335..382, Y 95..175).",
    )
    brillo_b: float = Field(
        ...,
        ge=0.0,
        le=255.0,
        description="Brillo promedio (0-255) en Zona B (Hoja del portón: X 475..575, Y 100..175).",
    )
    diff_porton: float | None = Field(
        default=None,
        description="Diferencial brillo_a - brillo_b (Umbral calibrado: -25.0).",
    )
    brillo_techo: float = Field(
        ...,
        ge=0.0,
        le=255.0,
        description="Brillo promedio en Ancla Principal (Techo de madera: X 15..130, Y 5..45).",
    )
    brillo_rincon: float = Field(
        default=90.0,
        ge=0.0,
        le=255.0,
        description="Brillo promedio en Ancla Secundaria (Rincón: X 160..230, Y 55..150).",
    )
    es_de_dia: bool = Field(
        default=True,
        description="Horario solar según NTP UTC-3 (True de 07:00 a 19:59 hs).",
    )
    camara_online: bool = Field(
        default=True,
        description="False si la cámara IP acumula >= 6 fallos HTTP consecutivos (30s).",
    )
    imagen_base64: str | None = Field(
        default=None,
        description="Imagen JPEG 640x360 codificada en Base64 (opcional si se sube por binario o LAN).",
    )

    @field_validator("estado", mode="before")
    @classmethod
    def normalizar_estado(cls, v: object) -> str:
        if isinstance(v, str):
            limpio = v.strip().upper()
            if limpio in ("CAMARA_FUERA_DE_POSICION", "CAMARA_DESVIADA"):
                return "CAMARA_MOVIDA"
            return limpio
        return "CERRADO"

    @model_validator(mode="after")
    def calcular_diff_si_falta(self) -> "TelemetriaPayload":
        if self.diff_porton is None:
            self.diff_porton = round(self.brillo_a - self.brillo_b, 2)
        else:
            self.diff_porton = round(self.diff_porton, 2)
        return self


class TelemetriaResponse(BaseModel):
    ok: bool
    estado_final: EstadoPorton
    metodo_confirmacion: MetodoConfirmacion
    cambio_estado: bool
    juez_ia_invocado: bool
    alerta_disparada: bool
    segundos_abierto: int
    ultima_captura_url: str | None = None
    detalle: str


class JuezIaVeredicto(BaseModel):
    estado_visual: EstadoPorton
    confianza: float = Field(default=0.85, ge=0.0, le=1.0)
    justificacion: str


class ConsultaIaRequest(BaseModel):
    pregunta: str = Field(
        ...,
        min_length=2,
        max_length=500,
        description="Pregunta en lenguaje natural realizada desde la PWA familiar.",
    )


class ConsultaIaResponse(BaseModel):
    pregunta: str
    respuesta: str
    timestamp_captura: str
    consultado_en: str


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    endpoint: str
    keys: PushKeys
