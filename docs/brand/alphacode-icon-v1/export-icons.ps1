$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repository = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$webDirectory = Join-Path $repository 'apps/alphacode-web/public'
$desktopDirectory = Join-Path $repository 'apps/alphacode-app/assets'
$terminalDirectory = Join-Path $repository 'apps/alphacode/src/ui'
New-Item -ItemType Directory -Path (Join-Path $webDirectory 'icons'), $desktopDirectory -Force | Out-Null

$source = [System.Drawing.Bitmap]::new((Join-Path $PSScriptRoot 'alfi-icon-transparent.png'))
$images = @{}
try {
    foreach ($size in @(16, 24, 32, 48, 64, 128, 180, 256, 512, 1024)) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $stream = [System.IO.MemoryStream]::new()
        try {
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $images[$size] = $stream.ToArray()
        } finally {
            $stream.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $source.Dispose()
}

foreach ($size in @(16, 32, 64, 128, 180)) {
    [System.IO.File]::WriteAllBytes((Join-Path $webDirectory "icons/alphacode-$size.png"), $images[$size])
}
[System.IO.File]::WriteAllBytes((Join-Path $desktopDirectory 'icon.png'), $images[512])
# Embed the small PNG in the CLI bundle; startup never depends on cwd or asset paths.
$terminalAsset = @{ png = [Convert]::ToBase64String($images[128]) } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $terminalDirectory 'alfi-image.json'), $terminalAsset + "`n", [System.Text.UTF8Encoding]::new($false))

# ICO entries contain complete RGBA PNGs (Windows Vista and newer).
$iconSizes = @(16, 24, 32, 48, 64, 128, 256)
$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$iconSizes.Count)
    $offset = 6 + 16 * $iconSizes.Count
    foreach ($size in $iconSizes) {
        $dimension = if ($size -eq 256) { 0 } else { $size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$size].Length)
        $writer.Write([uint32]$offset)
        $offset += $images[$size].Length
    }
    foreach ($size in $iconSizes) { $writer.Write([byte[]]$images[$size]) }
    $writer.Flush()
    $icon = $stream.ToArray()
    [System.IO.File]::WriteAllBytes((Join-Path $desktopDirectory 'icon.ico'), $icon)
    [System.IO.File]::WriteAllBytes((Join-Path $webDirectory 'favicon.ico'), $icon)
} finally {
    $writer.Dispose()
    $stream.Dispose()
}

# Modern ICNS entries use PNG payloads and big-endian chunk lengths.
function Write-BigEndianUInt32($writer, [uint32]$value) {
    $bytes = [System.BitConverter]::GetBytes($value)
    if ([System.BitConverter]::IsLittleEndian) { [Array]::Reverse($bytes) }
    $writer.Write($bytes)
}
$entries = @(@('icp4', 16), @('icp5', 32), @('icp6', 64), @('ic07', 128), @('ic08', 256), @('ic09', 512), @('ic10', 1024))
$length = 8
foreach ($entry in $entries) { $length += 8 + $images[$entry[1]].Length }
$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
try {
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('icns'))
    Write-BigEndianUInt32 $writer $length
    foreach ($entry in $entries) {
        $writer.Write([System.Text.Encoding]::ASCII.GetBytes($entry[0]))
        Write-BigEndianUInt32 $writer (8 + $images[$entry[1]].Length)
        $writer.Write([byte[]]$images[$entry[1]])
    }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes((Join-Path $desktopDirectory 'icon.icns'), $stream.ToArray())
} finally {
    $writer.Dispose()
    $stream.Dispose()
}
Write-Output 'Exported AlphaCode web and desktop icons.'
