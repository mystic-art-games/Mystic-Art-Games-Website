$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\assets'
$types = [ordered]@{ Entity = 'Type_Entity_Simple.png'; Event = 'Type_Event_Scroll_v2.png'; Patron = 'Type_Patron_Simple.png' }
$factions = [ordered]@{ Symbiosis = 'Faction_Symbiosis.png'; Flow = 'Faction_Flow.png'; Verdant = 'Faction_Verdant.png'; Radiance = 'Faction_Radiance.png'; Nomads = 'Faction_Nomads_Cairn.png' }

function Get-FactionPalette([string]$path) {
  $image = [System.Drawing.Bitmap]::new($path)
  try {
    $counts = [long[]]::new(256)
    $red = [double[]]::new(256); $green = [double[]]::new(256); $blue = [double[]]::new(256)
    $step = [math]::Max(1, [int][math]::Floor([math]::Min($image.Width, $image.Height) / 256))
    for ($y = 0; $y -lt $image.Height; $y += $step) {
      for ($x = 0; $x -lt $image.Width; $x += $step) {
        $color = $image.GetPixel($x, $y)
        if ($color.A -lt 180) { continue }
        $light = [int][math]::Round((54 * $color.R + 183 * $color.G + 19 * $color.B) / 256)
        $counts[$light]++; $red[$light] += $color.R; $green[$light] += $color.G; $blue[$light] += $color.B
      }
    }
    $total = ($counts | Measure-Object -Sum).Sum
    if ($total -eq 0) { throw "No opaque pixels in $path" }
    $palette = [System.Drawing.Color[]]::new(256)
    for ($index = 0; $index -lt 256; $index++) {
      $lowerRank = [math]::Max(0, ($index / 255.0 - 0.008) * $total)
      $upperRank = [math]::Min($total, ($index / 255.0 + 0.008) * $total)
      if ($upperRank -eq $lowerRank) { $upperRank = [math]::Min($total, $lowerRank + 1) }
      $rank = 0.0; $weightSum = 0.0; $r = 0.0; $g = 0.0; $b = 0.0
      for ($light = 0; $light -lt 256; $light++) {
        $nextRank = $rank + $counts[$light]
        if ($counts[$light] -gt 0) {
          $weight = [math]::Max(0, [math]::Min($nextRank, $upperRank) - [math]::Max($rank, $lowerRank))
          $r += $weight * $red[$light] / $counts[$light]
          $g += $weight * $green[$light] / $counts[$light]
          $b += $weight * $blue[$light] / $counts[$light]
          $weightSum += $weight
        }
        $rank = $nextRank
      }
      $palette[$index] = [System.Drawing.Color]::FromArgb([int][math]::Round($r / $weightSum), [int][math]::Round($g / $weightSum), [int][math]::Round($b / $weightSum))
    }
    return ,$palette
  }
  finally { $image.Dispose() }
}

function Get-TypeSource([string]$path) {
  $original = [System.Drawing.Bitmap]::new($path)
  $image = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($original, 0, 0, 512, 512)
    }
    finally { $graphics.Dispose() }
    $histogram = [long[]]::new(256); $total = 0
    for ($y = 0; $y -lt 512; $y++) {
      for ($x = 0; $x -lt 512; $x++) {
        $color = $image.GetPixel($x, $y)
        if ($color.A -lt 128) { continue }
        $light = [int][math]::Round((54 * $color.R + 183 * $color.G + 19 * $color.B) / 256)
        $histogram[$light]++; $total++
      }
    }
    if ($total -eq 0) { throw "No opaque pixels in $path" }
    $percentiles = [double[]]::new(256); $cumulative = 0
    for ($light = 0; $light -lt 256; $light++) {
      $percentiles[$light] = ($cumulative + $histogram[$light] / 2.0) / $total
      $cumulative += $histogram[$light]
    }
    return @{ Image = $image; Percentiles = $percentiles }
  }
  catch { $image.Dispose(); throw }
  finally { $original.Dispose() }
}

function Write-TypeIcon($source, $palette, [string]$path) {
  $output = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $opacityByLight = [double[]]::new(256)
    for ($light = 0; $light -lt 256; $light++) {
      $wash = [math]::Max(0, ($source.Percentiles[$light] - 0.15) / 0.85)
      $opacityByLight[$light] = 1 - 0.4 * $wash
    }
    for ($y = 0; $y -lt 512; $y++) {
      for ($x = 0; $x -lt 512; $x++) {
        $color = $source.Image.GetPixel($x, $y)
        if ($color.A -eq 0) { continue }
        $light = [int][math]::Round((54 * $color.R + 183 * $color.G + 19 * $color.B) / 256)
        $index = [int][math]::Round($source.Percentiles[$light] * 255)
        $match = $palette[$index]
        $alpha = [int][math]::Round($color.A * $opacityByLight[$light])
        $output.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $match.R, $match.G, $match.B))
      }
    }
    $output.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally { $output.Dispose() }
}

$palettes = @{}
foreach ($faction in $factions.Keys) { $palettes[$faction] = Get-FactionPalette (Join-Path $assets $factions[$faction]) }
foreach ($type in $types.Keys) {
  $source = Get-TypeSource (Join-Path $assets $types[$type])
  try {
    foreach ($faction in $factions.Keys) {
      Write-TypeIcon $source $palettes[$faction] (Join-Path $assets "Type_${type}_${faction}.png")
    }
  }
  finally { $source.Image.Dispose() }
}
