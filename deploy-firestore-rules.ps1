$ErrorActionPreference = "Stop"

Write-Host "Deploying FamilyPulse Firestore rules..." -ForegroundColor Cyan

npx firebase-tools login:list | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Firebase login is required. Opening login..." -ForegroundColor Yellow
    npx firebase-tools login
}

npx firebase-tools deploy --only firestore:rules --project familypulse-8de4f

if ($LASTEXITCODE -ne 0) {
    throw "Firestore rules deployment failed."
}

Write-Host "Firestore rules deployed successfully." -ForegroundColor Green
