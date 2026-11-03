param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Output,
  [ValidateRange(45, 52)][int]$Voice = 45,
  [ValidateRange(0.5, 2.0)][double]$Speed = 1.0
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pythonPath = Join-Path $projectRoot '.cache/local-tts/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
  throw 'Local TTS runtime is missing. See scripts/local-tts/README.md.'
}
$speedArgument = $Speed.ToString([Globalization.CultureInfo]::InvariantCulture)
& $pythonPath (Join-Path $PSScriptRoot 'synthesize.py') --text $Text --output $Output --voice $Voice --speed $speedArgument
if ($LASTEXITCODE -ne 0) { throw "Local TTS exited with code $LASTEXITCODE." }
