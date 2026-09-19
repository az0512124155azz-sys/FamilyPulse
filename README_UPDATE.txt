FamilyPulse - settings/home/cleanup update

Replace these files:
- src/App.tsx
- src/styles.css
- firestore.rules

Changes:
1. Home configuration moved to Settings (⚙️) only.
2. Home radius is fixed at 30 meters. There is no radius slider.
3. Main map always shows a permanent marker named "בית" and a 30m circle after home is configured.
4. Parent-side cleanup removes stale child members whose pairing code was deleted, including children that were deleted from the system but remained as stale family members.
5. Existing features remain: multi-child map, fast/precise location, home status, exit alerts, scheduled buzz window, logout/delete flow.

IMPORTANT:
After replacing firestore.rules in the repository, also publish the same rules in Firebase -> Firestore Database -> Rules.

Note:
The automatic cleanup can reliably detect children whose pairCode was deleted during account deletion. Firebase client apps cannot securely enumerate Authentication users, so the browser cannot directly query whether an arbitrary Auth UID still exists.
