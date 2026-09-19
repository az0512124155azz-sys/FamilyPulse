# FamilyPulse

FamilyPulse הוא אתר PWA מתקין למשפחות, עם מצב הורה ומצב ילד/ה.

## מה כבר קיים

- בחירת תפקיד: הורה / ילד
- יצירת פרופיל עם שם ותמונה
- קוד אישי לילד
- קוד הורה לשיתוף עם הורה נוסף
- זיהוי אוטומטי של סוג הקוד
- כמה ילדים וכמה הורים באותה משפחה
- בקשת מיקום לפי דרישה בלבד
- מפה מבוססת OpenStreetMap
- התקנה למסך הבית כ-PWA
- Service Worker בסיסי
- כללי Firestore ו-Storage
- GitHub Actions לבדיקת build

## מגבלת iPhone חשובה

PWA ב-iOS אינו אפליקציה Native ואינו יכול להפעיל GPS בשקט כאשר האתר סגור לגמרי.

לכן המימוש הנוכחי עובד כך:
1. ההורה לוחץ "מצא עכשיו".
2. בקשת מיקום נשמרת ב-Firestore.
3. אם FamilyPulse פתוח במכשיר הילד, הוא מבקש מיקום מדויק באותו רגע ושולח אותו.
4. אם ה-PWA סגור לגמרי באייפון, הבקשה תחכה עד שהילד יפתח אותו.

אין מעקב GPS רציף ולכן השימוש בסוללה נמוך משמעותית.

## הגדרת Firebase

1. צור פרויקט Firebase.
2. הפעל Anonymous Authentication.
3. צור Cloud Firestore.
4. הפעל Storage.
5. צור Web App בתוך Firebase.
6. העתק את הקובץ .env.example אל .env.local והכנס את פרטי Firebase.

VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

7. פרוס את כללי האבטחה:
firebase deploy --only firestore:rules,storage

## הרצה מקומית

npm install
npm run dev

## Build

npm run build

## התקנה באייפון

פתח את האתר ב-Safari -> Share -> Add to Home Screen.

## התקנה באנדרואיד

פתח את האתר ב-Chrome -> תפריט -> Install app / Add to Home screen.

## פריסה

אפשר לפרוס את תיקיית ה-build דרך Firebase Hosting או לחבר את המאגר ל-Vercel. חובה HTTPS בשביל Geolocation ו-PWA.


<!-- redeploy: firebase env configured -->
