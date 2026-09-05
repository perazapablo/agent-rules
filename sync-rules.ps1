# Sync RULES.md (canon) -> ~/.codex/AGENTS.md
# Claude Code y opencode leen RULES.md por referencia, no necesitan sync.
# Codex no soporta import -> requiere copia.

$ErrorActionPreference = "Stop"

$src = "C:\Users\Desarrollos\.config\agent-rules\RULES.md"
$dst = "C:\Users\Desarrollos\.codex\AGENTS.md"

if (-not (Test-Path $src)) {
    Write-Error "No existe el canon: $src"
    exit 1
}

$dstDir = Split-Path -Parent $dst
if (-not (Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}

Copy-Item -Path $src -Destination $dst -Force
Write-Output "Sync OK: $src -> $dst"
