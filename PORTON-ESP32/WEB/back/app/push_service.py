import asyncio
import json
import logging
from typing import Any

from .config import Settings
from .supabase_service import SupabaseService

logger = logging.getLogger("vigilante.push")


class PushService:
    """
    Servicio de notificaciones Web Push (VAPID) para alertar al grupo familiar
    cuando el portón supera los 10 minutos abierto o la cámara se desvía.
    """

    def __init__(self, settings: Settings, supabase: SupabaseService) -> None:
        self.settings = settings
        self.supabase = supabase

    def _enviar_push_sincrono(
        self, sub: dict[str, Any], payload_json: str
    ) -> tuple[bool, int | None]:
        try:
            from pywebpush import WebPushException, webpush  # type: ignore

            subscription_info = {
                "endpoint": sub["endpoint"],
                "keys": {
                    "p256dh": sub["p256dh"],
                    "auth": sub["auth"],
                },
            }
            webpush(
                subscription_info=subscription_info,
                data=payload_json,
                vapid_private_key=self.settings.vapid_private_key,
                vapid_claims={"sub": self.settings.vapid_claims_email},
                timeout=6,
            )
            return True, 201
        except Exception as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            logger.warning("Fallo enviando Web Push a %s: %s", sub.get("endpoint", "")[:40], exc)
            return False, status_code

    async def enviar_alerta_familiar(
        self,
        titulo: str,
        cuerpo: str,
        tag: str = "porton-alerta",
    ) -> int:
        if not self.settings.vapid_private_key or not self.settings.vapid_public_key:
            logger.info("Claves VAPID no configuradas; se omite envío Web Push.")
            return 0

        suscripciones = await self.supabase.listar_suscripciones_push()
        if not suscripciones:
            return 0

        payload_json = json.dumps(
            {
                "title": titulo,
                "body": cuerpo,
                "icon": "/icon-192.svg",
                "badge": "/icon-192.svg",
                "tag": tag,
                "data": {"url": "/"},
            }
        )

        enviados = 0
        for sub in suscripciones:
            ok, status_code = await asyncio.to_thread(
                self._enviar_push_sincrono, sub, payload_json
            )
            if ok:
                enviados += 1
            elif status_code in (404, 410):
                # Suscripción expirada o revocada en el navegador: limpiar de la base
                await self.supabase.eliminar_suscripcion_push(sub["endpoint"])

        return enviados
