Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$assets = (Resolve-Path (Join-Path $PSScriptRoot '..\assets')).Path
$output = Join-Path $assets 'vision-board-hex-transparent.png'
$terrainTypes = @{
    '-2,0' = 'Flow'; '-2,1' = 'Radiance'; '-2,2' = 'Verdant'
    '-1,-1' = 'Symbiosis'; '-1,0' = 'Flow'; '-1,1' = 'Verdant'; '-1,2' = 'Radiance'
    '0,-2' = 'Radiance'; '0,-1' = 'Verdant'; '0,0' = 'Symbiosis'; '0,1' = 'Verdant'; '0,2' = 'Flow'
    '1,-2' = 'Flow'; '1,-1' = 'Symbiosis'; '1,0' = 'Radiance'; '1,1' = 'Verdant'
    '2,-2' = 'Verdant'; '2,-1' = 'Flow'; '2,0' = 'Radiance'
}

$canvas = [Drawing.Bitmap]::new(1950, 1900, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([Drawing.Color]::Transparent)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$cx = 975.0
$cy = 950.0
$radius = 194.0
$tileRadius = $radius - 9
$hexHeight = [Math]::Sqrt(3) * $radius
$terrainImages = @{}
foreach ($type in @('Symbiosis', 'Flow', 'Verdant', 'Radiance')) {
    $terrainImages[$type] = [Drawing.Image]::FromFile((Join-Path $assets "Terrain_${type}_Full_Art.png"))
}

function Get-HexPoints([double]$x, [double]$y, [double]$r, [double]$offsetX = 0, [double]$offsetY = 0) {
    $points = [Drawing.PointF[]]::new(6)
    for ($i = 0; $i -lt 6; $i++) {
        $angle = [Math]::PI * $i / 3
        $points[$i] = [Drawing.PointF]::new(
            [single]($x + $offsetX + $r * [Math]::Cos($angle)),
            [single]($y + $offsetY + $r * [Math]::Sin($angle))
        )
    }
    return ,$points
}

function Draw-Hex([int]$q, [int]$r, [string]$type) {
    $x = $cx + 1.5 * $radius * $q
    $y = $cy + $hexHeight * ($r + $q / 2.0)
    $shadowPoints = Get-HexPoints $x $y $tileRadius 8 12
    $shadow = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(68, 11, 30, 24))
    $graphics.FillPolygon($shadow, $shadowPoints)
    $shadow.Dispose()

    $points = Get-HexPoints $x $y $tileRadius
    $clip = [Drawing.Drawing2D.GraphicsPath]::new()
    $clip.AddPolygon($points)
    $image = $terrainImages[$type]
    $sourceSize = [Math]::Min($image.Width, $image.Height)
    $source = [Drawing.Rectangle]::new(
        [int](($image.Width - $sourceSize) / 2),
        [int](($image.Height - $sourceSize) / 2),
        $sourceSize, $sourceSize
    )
    $target = [Drawing.Rectangle]::new(
        [int]($x - $tileRadius), [int]($y - $tileRadius),
        [int](2 * $tileRadius), [int](2 * $tileRadius)
    )
    $state = $graphics.Save()
    $graphics.SetClip($clip)
    $graphics.DrawImage($image, $target, $source, [Drawing.GraphicsUnit]::Pixel)
    $graphics.Restore($state)
    $edgeColor = if ($q -eq 0 -and $r -eq 0) {
        [Drawing.Color]::FromArgb(255, 239, 209, 128)
    } else {
        [Drawing.Color]::FromArgb(235, 33, 72, 54)
    }
    $edgeWidth = if ($q -eq 0 -and $r -eq 0) { 12 } else { 8 }
    $edge = [Drawing.Pen]::new($edgeColor, $edgeWidth)
    $edge.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPolygon($edge, $points)
    $edge.Dispose()
    $clip.Dispose()
}

function Draw-Entity([string]$name, [int]$q, [int]$r, [float]$rotation) {
    $x = $cx + 1.5 * $radius * $q
    $y = $cy + $hexHeight * ($r + $q / 2.0)
    $width = 320
    $height = 448
    $image = [Drawing.Image]::FromFile((Join-Path $assets "about-entities\$name.png"))
    $state = $graphics.Save()
    $graphics.TranslateTransform([single]$x, [single]$y)
    $graphics.RotateTransform($rotation)
    $shadow = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(76, 8, 30, 22))
    $graphics.FillRectangle($shadow, -$width / 2 + 12, -$height / 2 + 16, $width, $height)
    $shadow.Dispose()
    $graphics.DrawImage($image, [Drawing.Rectangle]::new(-$width / 2, -$height / 2, $width, $height))
    $graphics.Restore($state)
    $image.Dispose()
}

for ($q = -2; $q -le 2; $q++) {
    for ($r = -2; $r -le 2; $r++) {
        if ([Math]::Abs($q + $r) -gt 2) { continue }
        Draw-Hex $q $r $terrainTypes["$q,$r"]
    }
}

# Current Card Editor exports from the card list, placed on matching Terrain.
Draw-Entity 'Confluence' -1 0 -4
Draw-Entity 'Fungal-Rainwood' 1 -1 3
Draw-Entity 'Bramble-Briar' 0 1 -2

$canvas.Save($output, [Drawing.Imaging.ImageFormat]::Png)
foreach ($image in $terrainImages.Values) { $image.Dispose() }
$graphics.Dispose()
$canvas.Dispose()
Write-Output $output
