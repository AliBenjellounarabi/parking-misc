#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>

// Définition des broches SPI pour le RC522 (RST sur 4, SS sur 15)
#define RST_PIN 4  
#define SS_PIN  15   

MFRC522 mfrc522(SS_PIN, RST_PIN);   // Instance du lecteur RFID

// Initialisation de l'écran LCD (adresse 0x27, 16 colonnes, 2 lignes)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Broches pour les LED (séparées du bus SPI)
const int redLedPin = 25;   // LED Rouge sur GPIO 25
const int greenLedPin = 33; // LED Verte sur GPIO 33

void setup() {
  Serial.begin(115200);
  SPI.begin();          // Initialisation du bus SPI (18, 19, 23)
  mfrc522.PCD_Init();   // Initialisation du lecteur RFID

  // Configuration des broches LED en sortie
  pinMode(redLedPin, OUTPUT);
  pinMode(greenLedPin, OUTPUT);

  // Initialisation du bus I2C pour l'écran (SDA = 21, SCL = 22)
  Wire.begin(21, 22);
  lcd.init();                      
  lcd.backlight(); 

  // État initial (En attente : LED rouge allumée)
  digitalWrite(redLedPin, HIGH);
  digitalWrite(greenLedPin, LOW);

  lcd.setCursor(0, 0);
  lcd.print("MISC2 System");
  lcd.setCursor(0, 1);
  lcd.print("Scan your card");
}

void loop() {
  // Vérifier si une nouvelle carte est présente et lue
  if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
    
    // --- Carte détectée ---
    digitalWrite(redLedPin, LOW);    // Éteindre la rouge
    digitalWrite(greenLedPin, HIGH); // Allumer la verte

    // Récupérer l'UID de la carte et le formater en chaîne hexadécimale
    String cardUID = "";
    for (byte i = 0; i < mfrc522.uid.size; i++) {
      if (mfrc522.uid.uidByte[i] < 0x10) {
        cardUID += "0";
      }
      cardUID += String(mfrc522.uid.uidByte[i], HEX);
    }
    cardUID.toUpperCase(); // Mettre en majuscules pour plus de lisibilité

    // Affichage "Welcome" et de l'UID sur l'écran LCD
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Welcome !");
    
    lcd.setCursor(0, 1);
    // Si l'UID est trop long pour 16 caractères, on affiche les 16 premiers
    lcd.print(cardUID); 

    // Garder l'état pendant 3 secondes
    delay(3000);

    // Retour à l'état d'attente initial
    digitalWrite(redLedPin, HIGH);
    digitalWrite(greenLedPin, LOW);
    
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("MISC2 System");
    lcd.setCursor(0, 1);
    lcd.print("Scan your card");

    // Arrêter la lecture pour libérer la carte
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
  }
}