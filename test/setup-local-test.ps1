# Spins up a local Umbraco 17 site that hosts the Lait Content Drag and Drop package, then runs it.
# Usage (from the repo root, in PowerShell):
#   .\test\setup-local-test.ps1
# Requires the .NET 10 SDK (check with: dotnet --version  -> should be 10.x) and Node.js (for the
# backoffice client build, which the package's csproj runs automatically on build).

$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$testDir = Join-Path $repo 'test'
$siteDir = Join-Path $testDir 'TestSite'
$pkgProj = Join-Path $repo 'src\Lait.Umbraco.Content.DragAndDrop\Lait.Umbraco.Content.DragAndDrop.csproj'

Write-Host "==> Installing the Umbraco 17 project template" -ForegroundColor Cyan
dotnet new install Umbraco.Templates::17.0.0 --force

if (Test-Path $siteDir) {
    Write-Host "==> Removing existing test site at $siteDir" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $siteDir
}

Write-Host "==> Creating a new Umbraco 17 site (SQLite, auto-installed)" -ForegroundColor Cyan
dotnet new umbraco --force -n TestSite -o $siteDir `
    --friendly-name "Administrator" `
    --email "admin@example.com" `
    --password "P@ssw0rd1234" `
    --development-database-type SQLite

Write-Host "==> Referencing the Lait Content Drag and Drop package project" -ForegroundColor Cyan
dotnet add $siteDir reference $pkgProj
# The backoffice client ships as static web assets (wwwroot), so a project reference is enough —
# no manual App_Plugins copy needed. The package's csproj runs `npm install` + `npm run build`
# during the build, so the bundle is produced automatically.

Write-Host ""
Write-Host "Login:    admin@example.com / P@ssw0rd1234" -ForegroundColor Green
Write-Host "Backoffice will be at the https://localhost:<port> shown below, path /umbraco" -ForegroundColor Green
Write-Host "Try it: Content section -> reorder/move nodes by dragging. Give a doc type a Collection" -ForegroundColor Green
Write-Host "(list view), then drag a child from the list view onto another node in the tree." -ForegroundColor Green
Write-Host ""

Write-Host "==> Starting the site (Ctrl+C to stop)" -ForegroundColor Cyan
dotnet run --project $siteDir
