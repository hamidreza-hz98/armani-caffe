$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot 'data\mongodb'))
if (-not $dataDirectory.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'MongoDB data path must stay inside this project.'
}

$mongod = 'C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe'
if (-not (Test-Path -LiteralPath $mongod)) {
  throw 'MongoDB 8.0 is not installed at the expected path. Use the documented Docker stack instead.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 27018 -ErrorAction SilentlyContinue) {
  throw 'Port 27018 is already in use; inspect the existing process before starting another MongoDB.'
}

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$logPath = Join-Path $dataDirectory 'mongod.log'
$process = Start-Process -FilePath $mongod -ArgumentList @(
  '--dbpath', "`"$dataDirectory`"",
  '--port', '27018',
  '--replSet', 'rsowner',
  '--bind_ip', '127.0.0.1',
  '--logpath', "`"$logPath`"",
  '--logappend'
) -WindowStyle Hidden -PassThru

try {
  & node (Join-Path $PSScriptRoot 'init-local-mongo.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Replica-set initialization failed.' }
  Write-Output "Armani Caffe MongoDB is ready on 127.0.0.1:27018 (PID $($process.Id))."
} catch {
  Write-Error "MongoDB did not become ready. Inspect $logPath. The process was not stopped automatically."
  throw
}
