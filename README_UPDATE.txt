FamilyPulse - updated files
===========================

Replace these files in your repository:

1. src/App.tsx
2. src/styles.css
3. firestore.rules

What changed
------------
- Child markers on the map are now the child's profile photo INSIDE the circular marker.
- If no profile photo exists, the first letter of the child's name is shown.
- Clicking a marker opens a compact child card with name, update time, accuracy, and refresh button.
- Very close markers are slightly separated visually so multiple children can still be selected.
- When a child presses "התנתק":
  * FamilyPulse first tries to obtain a fresh last location.
  * A logout event is saved for the family.
  * The child is marked inactive and disappears from the parent's active children list.
  * The parent sees an in-app logout notice with last location, time, and accuracy when available.
  * If Web notification permission was already granted, FamilyPulse also tries to show a system Web notification.
- Parent can press "אפשר התראות" to grant Web notification permission.
- Reconnecting the same child code marks the child active again.
- Location requests remain fast-first, then precise.

IMPORTANT
---------
After replacing firestore.rules in the repo, you MUST also publish the updated rules in Firebase Firestore -> Rules.
Vercel deployment alone does not publish Firestore security rules.

This version cannot guarantee a push notification while the PWA is completely closed on iPhone.
That requires the planned native/Capacitor layer with APNs/background capabilities.

Logout location also depends on iOS/browser location permission. If location is blocked, logout still works but the event is saved without coordinates.
