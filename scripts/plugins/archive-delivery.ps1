param([string]$OutputName = 'AI-video-workbench-0.1.0-win-x64-speech-test.zip')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$releaseRoot = Join-Path $projectRoot 'release'
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName -or -not $OutputName.EndsWith('.zip')) {
  throw 'OutputName must be a ZIP filename, not a path.'
}
$outputPath = Join-Path $releaseRoot $OutputName
if (Test-Path -LiteralPath $outputPath) { throw 'Archive already exists; choose a new filename.' }
foreach ($name in @('win-unpacked', 'plugin-support')) {
  if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot $name) -PathType Container)) {
    throw "Missing delivery directory: $name"
  }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in @('win-unpacked', 'plugin-support')) {
    $directory = Join-Path $releaseRoot $name
    foreach ($file in Get-ChildItem -LiteralPath $directory -Recurse -File) {
      $relative = $file.FullName.Substring($releaseRoot.Length + 1).Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal)
    }
  }
} finally {
  $zip.Dispose()
  $stream.Dispose()
}
Get-Item -LiteralPath $outputPath | Select-Object FullName, Length
