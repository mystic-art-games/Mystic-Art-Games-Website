Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$assets = (Resolve-Path (Join-Path $PSScriptRoot '..\assets')).Path
$output = Join-Path $assets 'vision-board-hex-transparent.png'
$terrainTypes = @{
    '-2,0' = 'Verdant'; '-2,1' = 'Verdant'; '-2,2' = 'Verdant'
    '-1,-1' = 'Verdant'; '-1,0' = 'Flow'; '-1,1' = 'Verdant'; '-1,2' = 'Verdant'
    '0,-2' = 'Flow'; '0,-1' = 'Flow'; '0,0' = 'Verdant'; '0,1' = 'Verdant'; '0,2' = 'Flow'
    '1,-2' = 'Flow'; '1,-1' = 'Flow'; '1,0' = 'Flow'; '1,1' = 'Verdant'
    '2,-2' = 'Flow'; '2,-1' = 'Flow'; '2,0' = 'Flow'
}

$canvas = [Drawing.Bitmap]::new(1690, 1740, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([Drawing.Color]::Transparent)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$cx = 845.0
$cy = 870.0
$radius = 194.0
$tileRadius = $radius - 8
$hexHeight = [Math]::Sqrt(3) * $radius
$terrainImages = @{}
foreach ($type in @('Flow', 'Verdant')) {
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
    $clip.Dispose()
}

function Draw-Entity([string]$name, [int]$q, [int]$r, [float]$rotation) {
    $x = $cx + 1.5 * $radius * $q
    $y = $cy + $hexHeight * ($r + $q / 2.0)
    # The rotated portrait card stays inside the flat-top hex at this size.
    $width = 182
    $height = 255
    $image = [Drawing.Image]::FromFile((Join-Path $assets "about-entities\$name.png"))
    $state = $graphics.Save()
    $graphics.TranslateTransform([single]$x, [single]$y)
    $graphics.RotateTransform($rotation)
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
Draw-Entity 'Confluence' -1 0 -3
Draw-Entity 'Bramble-Briar' 0 1 -2
Draw-Entity 'Tideglass-Lagoon' 1 -1 3
Draw-Entity 'Mirrorpool-Shrine' 1 0 -2
Draw-Entity 'Terrace-Keepers' -1 1 2

$canvas.Save($output, [Drawing.Imaging.ImageFormat]::Png)
foreach ($image in $terrainImages.Values) { $image.Dispose() }
$graphics.Dispose()
$canvas.Dispose()
Write-Output $output
