from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración centralizada del backend FastAPI (Vigilante Frente)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Autenticación Dispositivo-Backend (Header x-api-key)
    esp32_api_key: str = "porton-esp32-secret-key-2026"

    # Supabase (PostgreSQL + Realtime + Storage)
    supabase_url: str = "https://sseonoxhacutaxchbgmj.supabase.co"
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_backend_key: str = "vf_backend_9f8e7d6c5b4a3f2e1d0c"
    supabase_bucket: str = "capturas-porton"

    # Google Gemini 2.5 Flash (Juez de Última Instancia + Chat Visual PWA)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Notificaciones Web Push (VAPID)
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_claims_email: str = "mailto:alertas@vigilantefrente.local"

    # Parámetros de Reglas de Negocio (AGENTS.md)
    tiempo_alerta_segundos: int = 600  # 10 minutos stateless
    zona_gris_diff_min: float = -30.0
    zona_gris_diff_max: float = -20.0
    retencion_historial_dias: int = 90
    cam_snapshot_url: str = ""
    cors_origins: str = "*"

    @property
    def effective_supabase_key(self) -> str:
        """Usa service_role si está configurada; de lo contrario usa anon_key junto con x-backend-key."""
        return (self.supabase_service_role_key or self.supabase_anon_key).strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
