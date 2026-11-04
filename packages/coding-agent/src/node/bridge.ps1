$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'bridge.cs')
[Alpha.CodingBridge]::Run()
