#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <TJpg_Decoder.h>

const char* WIFI_SSID = "TU_WIFI_SSID";
const char* WIFI_PASS = "TU_WIFI_PASSWORD";
const char* CAM_URL = "http://192.168.0.166/webcapture.jpg?command=snap&channel=1&user=admin&password=TU_PASSWORD";

// Coordenadas Zona A (Pared izquierda) y Zona B (Portón derecha) en 640x360
const uint16_t ZONA_A_X1 = 325, ZONA_A_Y1 = 80,  ZONA_A_X2 = 385, ZONA_A_Y2 = 220;
const uint16_t ZONA_B_X1 = 460, ZONA_B_Y1 = 100, ZONA_B_X2 = 570, ZONA_B_Y2 = 240;

uint32_t sumaBrilloA = 0, pixelesA = 0;
uint32_t sumaBrilloB = 0, pixelesB = 0;

bool analizarBloqueJpg(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t *bitmap) {
    bool tocaA = !(x + w < ZONA_A_X1 || x > ZONA_A_X2 || y + h < ZONA_A_Y1 || y > ZONA_A_Y2);
    bool tocaB = !(x + w < ZONA_B_X1 || x > ZONA_B_X2 || y + h < ZONA_B_Y1 || y > ZONA_B_Y2);
    if (!tocaA && !tocaB) return true;

    for (uint16_t j = 0; j < h; j++) {
        for (uint16_t i = 0; i < w; i++) {
            uint16_t px = x + i;
            uint16_t py = y + j;

            uint16_t color = bitmap[j * w + i];
            uint8_t r = ((color >> 11) & 0x1F) << 3;
            uint8_t g = ((color >> 5) & 0x3F) << 2;
            uint8_t b = (color & 0x1F) << 3;
            uint8_t gris = (r + g + b) / 3;

            if (px >= ZONA_A_X1 && px <= ZONA_A_X2 && py >= ZONA_A_Y1 && py <= ZONA_A_Y2) {
                sumaBrilloA += gris;
                pixelesA++;
            }
            if (px >= ZONA_B_X1 && px <= ZONA_B_X2 && py >= ZONA_B_Y1 && py <= ZONA_B_Y2) {
                sumaBrilloB += gris;
                pixelesB++;
            }
        }
    }
    return true;
}

void setup() {
    Serial.begin(115200);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("Conectando al WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi conectado! Iniciando Etapa 1...");

    TJpgDec.setJpgScale(1);
    TJpgDec.setCallback(analizarBloqueJpg);
}

void loop() {
    HTTPClient http;
    http.begin(CAM_URL);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
        int len = http.getSize();
        uint8_t *jpgBuffer = (uint8_t*)malloc(len);

        if (jpgBuffer) {
            WiFiClient *stream = http.getStreamPtr();
            int leidos = stream->readBytes(jpgBuffer, len);

            sumaBrilloA = 0; pixelesA = 0;
            sumaBrilloB = 0; pixelesB = 0;

            TJpgDec.drawJpg(0, 0, jpgBuffer, leidos);
            free(jpgBuffer);

            if (pixelesA > 0 && pixelesB > 0) {
                float brilloA = (float)sumaBrilloA / pixelesA;
                float brilloB = (float)sumaBrilloB / pixelesB;
                float diff = brilloA - brilloB;

                const char* estado = (diff > 0.0) ? "CERRADO" : "ABIERTO";
                Serial.printf("[Foto %d bytes] Pared(A): %.1f | Porton(B): %.1f | Diff: %+.1f ---> %s\n", 
                              leidos, brilloA, brilloB, diff, estado);
            }
        } else {
            Serial.println("Error: No hay RAM suficiente para descargar la foto.");
        }
    } else {
        Serial.printf("Error HTTP al conectar con la camara: %d\n", httpCode);
    }
    http.end();

    delay(5000); // Prueba cada 5 segundos
}