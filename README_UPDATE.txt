FamilyPulse updated files v2
============================

Replace ALL THREE files in your project:
1. src/App.tsx
2. src/styles.css
3. firestore.rules

Main fixes in v2
----------------
1. NO BLUE DOTS:
   - The Leaflet marker itself is now the child's profile photo.
   - There is no CircleMarker and no permanent name/photo badge next to it.
   - If there is no photo, the marker shows the first letter of the child's name.

2. Existing children logout detection:
   - Parents automatically repair/create childLinks for children already connected before this feature existed.
   - On child logout, FamilyPulse first checks childLinks.
   - If childLinks is missing, it falls back to the child's last locationRequest to recover familyId.
   - Logout saves a fresh last-known position when possible.
   - The child's family member record is immediately updated to active=false.
   - Parent active-child list filters active=false, so the child disappears right away.
   - Parent receives an in-app logout notice with last location when available.

3. Repeated logout history:
   - Logout event document IDs include a timestamp, so repeated logout events are not overwritten.

IMPORTANT
---------
After replacing firestore.rules in GitHub, also open:
Firebase -> Firestore Database -> Rules

Paste the updated firestore.rules and click Publish.

If Vercel is showing the old map after deployment:
- Confirm the deployment was built from the commit containing this v2 App.tsx.
- Hard refresh the page (Ctrl+F5 on Windows).
- On mobile, fully close the installed PWA/browser and reopen it.
- If using an installed PWA, its Service Worker may briefly keep an older bundle; reopening after deployment normally refreshes it.

The logout event can only capture location if the device still grants location permission.
