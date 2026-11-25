#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>

#include "firebase_roots.h"
#include "secrets.h"

constexpr int redLedPin = 25;
constexpr int greenLedPin = 33;
constexpr unsigned long resultDurationMs = 3000;

MFRC522 cardReader(15, 4);
LiquidCrystal_I2C lcd(0x27, 16, 2);
FirebaseData request;
FirebaseAuth auth;
FirebaseConfig config;

enum class Result { Granted, Unknown, Revoked, Unavailable };

void showMessage(const char *first, const char *second) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(first);
  lcd.setCursor(0, 1);
  lcd.print(second);
}

void showIdle() {
  digitalWrite(redLedPin, HIGH);
  digitalWrite(greenLedPin, LOW);
  showMessage("MISC2 Parking", "Scan your card");
}

String readUid() {
  String uid;
  uid.reserve(cardReader.uid.size * 2);
  for (byte i = 0; i < cardReader.uid.size; i++) {
    byte value = cardReader.uid.uidByte[i];
    if (value < 0x10) uid += '0';
    uid += String(value, HEX);
  }
  uid.toUpperCase();
  return uid;
}

Result checkAccess(const String &uid, bool online) {
  if (!online) return Result::Unavailable;

  String path = "/cards/" + uid + "/active";
  if (!Firebase.RTDB.get(&request, path)) {
    Serial.println("Firebase access check failed: " + request.errorReason());
    return Result::Unavailable;
  }

  switch (request.dataTypeEnum()) {
    case firebase_rtdb_data_type_null:
      return Result::Unknown;
    case firebase_rtdb_data_type_boolean:
      return request.boolData() ? Result::Granted : Result::Revoked;
    default:
      return Result::Unavailable;
  }
}

const char *resultName(Result result) {
  switch (result) {
    case Result::Granted: return "granted";
    case Result::Unknown: return "unknown";
    case Result::Revoked: return "revoked";
    default: return "unavailable";
  }
}

void showResult(Result result) {
  bool granted = result == Result::Granted;
  digitalWrite(redLedPin, granted ? LOW : HIGH);
  digitalWrite(greenLedPin, granted ? HIGH : LOW);

  switch (result) {
    case Result::Granted: showMessage("Access granted", "Welcome"); break;
    case Result::Unknown: showMessage("Access denied", "Unknown card"); break;
    case Result::Revoked: showMessage("Access denied", "Card revoked"); break;
    case Result::Unavailable: showMessage("Access denied", "System offline"); break;
  }
}

void logScan(const String &uid, Result result) {
  FirebaseJson event;
  event.set("uid", uid);
  event.set("result", resultName(result));
  event.set("scannedAt/.sv", "timestamp");
  event.set("readerId", auth.token.uid);

  if (!Firebase.RTDB.pushJSON(&request, "/accessEvents", &event)) {
    Serial.println("Firebase scan log failed: " + request.errorReason());
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(redLedPin, OUTPUT);
  pinMode(greenLedPin, OUTPUT);
  SPI.begin();
  cardReader.PCD_Init();
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  showIdle();

  WiFi.mode(WIFI_STA);
  WiFi.begin(PARKING_WIFI_SSID, PARKING_WIFI_PASSWORD);
  config.api_key = PARKING_FIREBASE_API_KEY;
  config.database_url = PARKING_DATABASE_URL;
  config.cert.data = FIREBASE_ROOTS;
  auth.user.email = PARKING_READER_EMAIL;
  auth.user.password = PARKING_READER_PASSWORD;
  Firebase.begin(&config, &auth);
  Firebase.reconnectNetwork(true);
  Firebase.RTDB.setReadTimeout(&request, 4500);
}

void loop() {
  // Call ready regularly so the client can refresh the reader's ID token.
  bool online = WiFi.status() == WL_CONNECTED && Firebase.ready();
  if (!cardReader.PICC_IsNewCardPresent() || !cardReader.PICC_ReadCardSerial()) return;

  String uid = readUid();
  cardReader.PICC_HaltA();
  cardReader.PCD_StopCrypto1();
  if (uid.length() != 8 && uid.length() != 14 && uid.length() != 20) return;

  showMessage("Checking card", "");
  Result result = checkAccess(uid, online);
  showResult(result);
  Serial.printf("Parking scan %s: %s\n", uid.c_str(), resultName(result));

  unsigned long displayStarted = millis();
  if (online) logScan(uid, result);
  unsigned long elapsed = millis() - displayStarted;
  if (elapsed < resultDurationMs) delay(resultDurationMs - elapsed);
  showIdle();
}
