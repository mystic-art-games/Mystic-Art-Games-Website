Add-Type -AssemblyName System.Drawing

$assets = (Resolve-Path (Join-Path $PSScriptRoot '..\assets')).Path
$terrainArt = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\Helianthe\media\Terrains')).Path
$output = Join-Path $assets 'vision-board-transparent.png'

function New-RoundedPath([int]$x, [int]$y, [int]$width, [int]$height, [int]$radius) {
    $path = [Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-Shadow($graphics, [int]$x, [int]$y, [int]$width, [int]$height) {
    $shadow = New-RoundedPath ($x + 9) ($y + 13) $width $height 23
    $brush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(65, 9, 22, 16))
    $graphics.FillPath($brush, $shadow)
    $brush.Dispose()
    $shadow.Dispose()
}

function Draw-Terrain($graphics, [string]$type, [int]$x, [int]$y) {
    $width = 360
    $height = 504
    Draw-Shadow $graphics $x $y $width $height

    $outer = New-RoundedPath $x $y $width $height 23
    $sleeve = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 30, 91, 59))
    $graphics.FillPath($sleeve, $outer)

    $inset = 9
    $inner = New-RoundedPath ($x + $inset) ($y + $inset) ($width - 2 * $inset) ($height - 2 * $inset) 16
    $image = [Drawing.Image]::FromFile((Join-Path $terrainArt "Terrain_${type}_Full_Art.png"))
    $graphics.SetClip($inner)
    $graphics.DrawImage($image, [Drawing.Rectangle]::new($x + $inset, $y + $inset, $width - 2 * $inset, $height - 2 * $inset))
    $graphics.ResetClip()

    $image.Dispose()
    $inner.Dispose()
    $sleeve.Dispose()
    $outer.Dispose()
}

function Draw-Entity($graphics, [string]$name, [int]$x, [int]$y) {
    $width = 360
    $height = 504
    Draw-Shadow $graphics $x $y $width $height
    $image = [Drawing.Image]::FromFile((Join-Path $assets "about-entities\$name.png"))
    $graphics.DrawImage($image, [Drawing.Rectangle]::new($x, $y, $width, $height))
    $image.Dispose()
}

$canvas = [Drawing.Bitmap]::new(1950, 1920, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([Drawing.Color]::Transparent)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$left = 70
$stepX = 445
$top = 48
$stepY = 640
$terrain = @(
    @('Symbiosis', 2, 0), @('Verdant', 3, 0),
    @('Radiance', 0, 1), @('Flow', 1, 1), @('Symbiosis', 2, 1), @('Verdant', 3, 1),
    @('Radiance', 2, 2)
)
foreach ($card in $terrain) {
    Draw-Terrain $graphics $card[0] ($left + $stepX * $card[1]) ($top + $stepY * $card[2])
}

# These are actual Entity PNG exports from Card Editor, on matching Terrain.
Draw-Entity $graphics 'Confluence' ($left + $stepX + 65) ($top + $stepY + 46)
Draw-Entity $graphics 'Fungal-Rainwood' ($left + 2 * $stepX + 65) ($top + $stepY + 46)
Draw-Entity $graphics 'Bramble-Briar' ($left + 3 * $stepX + 65) ($top + $stepY + 46)

$canvas.Save($output, [Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$canvas.Dispose()
Write-Output $output
