# Local server for Somata on Windows - no Python or Node needed (PowerShell is part of Windows).
# Started by start.bat. Serves this folder at http://localhost:8000/ (or the next free port),
# sends .js as JavaScript (required for ES modules) and disables caching.
# Close the window to stop the server.
param([int]$Port = 8000, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.plist' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'; '.gif' = 'image/gif'; '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'
  '.md' = 'text/markdown; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'
}

function Resolve-LocalFile([string]$urlPath) {
  $rel = [System.Uri]::UnescapeDataString($urlPath).TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $rel))
  if ($full -ne $root -and -not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
  if ([System.IO.Directory]::Exists($full)) { $full = [System.IO.Path]::Combine($full, 'index.html') }
  if ([System.IO.File]::Exists($full)) { return $full }
  return $null
}
function Get-ContentType([string]$file) {
  $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
  if ($types.ContainsKey($ext)) { return $types[$ext] }
  return 'application/octet-stream'
}

# HttpListener on http://localhost:<port>/ works without administrator rights.
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  $candidate = New-Object System.Net.HttpListener
  $candidate.Prefixes.Add("http://localhost:$p/")
  try { $candidate.Start(); $listener = $candidate; $Port = $p; break }
  catch { try { $candidate.Close() } catch { } }
}
if (-not $listener) {
  Write-Host "Could not start a server on ports $Port..$($Port + 19)." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host "Somata: $url"
Write-Host 'Close this window to stop the server.'
if (-not $NoBrowser) { Start-Process $url }

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $file = Resolve-LocalFile $ctx.Request.Url.AbsolutePath
    $res.Headers.Add('Cache-Control', 'no-store')
    if ($null -eq $file) {
      $res.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $res.ContentType = 'text/plain; charset=utf-8'
    } else {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentType = Get-ContentType $file
    }
    $res.ContentLength64 = $bytes.Length
    if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.Close() } catch { }
  }
}
