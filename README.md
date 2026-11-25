# EILCO Parking

The ESP32 reads a card with the RC522 and checks its UID in Firebase Realtime Database. The green LED lights only when Firebase returns an active card. Unknown and revoked cards, and scans that cannot be verified, keep the red LED on. The LCD shows the outcome. The Angular dashboard manages card access and shows the latest 100 scans.

## Set up Firebase

1. Open your [Firebase project](https://console.firebase.google.com/) and create a Realtime Database if you do not have one. Copy the database URL from the **Data** tab and the Web API key from **Project settings**. If the key is missing, register a Web app under **Your apps** and copy its API key.
2. In **Authentication → Sign-in method**, enable **Email/Password**. Under **Users**, add two accounts, one for the dashboard administrator and one for the ESP32 reader. Copy each account’s **User UID**.
3. In **Realtime Database → Data**, add the following branches. Enter the value `true` as a Boolean for each UID.

   | Database path | Value |
   | --- | --- |
   | `roles/admins/<administrator-auth-uid>` | `true` |
   | `roles/readers/<reader-auth-uid>` | `true` |

4. Copy [firebase/database.rules.json](firebase/database.rules.json) into **Realtime Database → Rules** and publish. If this database serves another app, merge these rules and review that app’s permissions before publishing. The supplied rules deny access to the old test paths.

The database starts with an empty allowlist. The dashboard creates the `cards` records, and the reader appends to `accessEvents`. Only administrators can manage cards. Readers can check an individual UID’s active flag and append scans under their own Firebase account. Admin and reader roles are assigned in the Firebase console.

## Run the Angular dashboard

Copy [web/public/firebase-config.example.json](web/public/firebase-config.example.json) to `web/public/firebase-config.json`. Enter the Web API key and database URL. This file is served to the browser and contains public Firebase project settings. Keep the reader and admin passwords out of it.

From PowerShell:

```powershell
cd web
npm.cmd ci
npm.cmd start
```

Open [http://localhost:4200](http://localhost:4200) and sign in with the administrator account. Run `npm.cmd run build` to build the static site into `web/dist/parking/browser`. Use HTTPS if you host it.

## Upload the ESP32 sketch

1. Copy [reader/secrets.h.example](reader/secrets.h.example) to `reader/secrets.h`. Set the Wi-Fi values, the same Firebase settings, and the **reader** account’s email and password.
2. In Arduino IDE, open [reader/reader.ino](reader/reader.ino) directly. Select your existing ESP32 board and port. Use the same libraries as the original sketches: **MFRC522**, **LiquidCrystal_I2C**, and **Firebase Arduino Client Library for ESP8266 and ESP32** by Mobizt.
3. Upload the sketch. The wiring is unchanged. The RC522 uses SS 15 and RST 4 with the default ESP32 SPI pins, the LCD uses SDA 21 and SCL 22, and the red and green LEDs use GPIO 25 and 33.

### Check the full flow

1. Scan a card. The reader should show **Access denied / Unknown card**. Find the UID in the dashboard’s scan log or open Serial Monitor at 115200 baud.
2. Click **Register** on that scan, enter a label, and register it. Scan again to see **Access granted** and the green LED.
3. Revoke the card in **Cards**, then scan again. The LCD should show **Access denied / Card revoked**. Use **Reactivate** to grant access again.
4. Disconnect the reader from Wi-Fi and scan a card. Access stays denied. Scans made while the reader is offline are not recorded in Firebase.

The reader checks card UIDs rather than cryptographic credentials. Use this setup for a prototype where UID-based access is sufficient.
