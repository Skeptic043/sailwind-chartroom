# Makes assets/sailwind from the downloaded CC0 images listed in THIRD-PARTY-NOTICES.md: crops, resizes, rotates and darkens.
param([string]$Source, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Save-Jpeg($bitmap, $path, $quality = 82) {
    $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
    $parameters = New-Object Drawing.Imaging.EncoderParameters 1
    $parameters.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]$quality)
    $bitmap.Save($path, $codec, $parameters)
}

# Draws $image into a new bitmap of the given size, optionally from a source rectangle and through a colour matrix.
# $shift is [r, g, b] added after $scale, so a darker version can keep the paper's full contrast.
function Render($image, [int]$width, [int]$height, $sourceRect = $null, [float[]]$scale = $null, [float[]]$shift = $null) {
    $bitmap = New-Object Drawing.Bitmap $width, $height, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $attributes = New-Object Drawing.Imaging.ImageAttributes
    if ($scale) {
        $matrix = New-Object Drawing.Imaging.ColorMatrix
        $matrix.Matrix00 = $scale[0]; $matrix.Matrix11 = $scale[1]; $matrix.Matrix22 = $scale[2]; $matrix.Matrix33 = 1; $matrix.Matrix44 = 1
        if ($shift) { $matrix.Matrix40 = $shift[0]; $matrix.Matrix41 = $shift[1]; $matrix.Matrix42 = $shift[2] }
        $attributes.SetColorMatrix($matrix)
    }
    if (-not $sourceRect) { $sourceRect = New-Object Drawing.Rectangle 0, 0, $image.Width, $image.Height }
    $graphics.DrawImage($image, (New-Object Drawing.Rectangle 0, 0, $width, $height), $sourceRect.X, $sourceRect.Y, $sourceRect.Width, $sourceRect.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
    $graphics.Dispose()
    return $bitmap
}

# Night paper: the same parchment, shifted dark with a warm tint and its contrast slightly raised.
$night = [float[]](1.10, 1.12, 1.16)
$nightShift = [float[]](-0.76, -0.76, -0.73)
$paper = [Drawing.Image]::FromFile((Join-Path $Source 'old_paper_paper_1_1_800x500.png'))
$scroll = [Drawing.Image]::FromFile((Join-Path $Source 'container.png'))

# Paper tile: the sheet's even middle at full resolution, with each edge cross-faded into the opposite
# edge over $band pixels, so it repeats without seams and without mirrored patterns.
function Tile($image, [float[]]$scale, [float[]]$shift, [int]$band = 80) {
    $crop = Render $image 620 360 (New-Object Drawing.Rectangle 90, 70, 620, 360) $scale $shift
    $w = $crop.Width; $h = $crop.Height; $tw = $w - $band; $th = $h - $band
    $rect = New-Object Drawing.Rectangle 0, 0, $w, $h
    $data = $crop.LockBits($rect, [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $source = New-Object byte[] ($data.Stride * $h); [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $source, 0, $source.Length); $stride = $data.Stride
    $crop.UnlockBits($data); $crop.Dispose()
    # Horizontal pass into a $tw x $h buffer, then vertical pass into the $tw x $th tile.
    $wide = New-Object double[] ($tw * $h * 3)
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $tw; $x++) {
            $a = $y * $stride + $x * 4
            $t = if ($x -lt $band) { $x / $band } else { 1.0 }
            $b = $y * $stride + ($x + $tw) * 4
            for ($c = 0; $c -lt 3; $c++) {
                $value = if ($t -lt 1) { $source[$b + $c] * (1 - $t) + $source[$a + $c] * $t } else { $source[$a + $c] }
                $wide[($y * $tw + $x) * 3 + $c] = $value
            }
        }
    }
    $tile = New-Object Drawing.Bitmap $tw, $th, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $out = $tile.LockBits((New-Object Drawing.Rectangle 0, 0, $tw, $th), [Drawing.Imaging.ImageLockMode]::WriteOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bytes = New-Object byte[] ($out.Stride * $th)
    for ($y = 0; $y -lt $th; $y++) {
        $t = if ($y -lt $band) { $y / $band } else { 1.0 }
        for ($x = 0; $x -lt $tw; $x++) {
            $o = $y * $out.Stride + $x * 4
            for ($c = 0; $c -lt 3; $c++) {
                $near = $wide[($y * $tw + $x) * 3 + $c]
                $value = if ($t -lt 1) { $wide[(($y + $th) * $tw + $x) * 3 + $c] * (1 - $t) + $near * $t } else { $near }
                $bytes[$o + $c] = [byte][Math]::Round($value)
            }
            $bytes[$o + 3] = 255
        }
    }
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $out.Scan0, $bytes.Length); $tile.UnlockBits($out)
    return $tile
}
$tile = Tile $paper $null $null; Save-Jpeg $tile (Join-Path $Out 'paper-light.jpg'); $tile.Dispose()
$tile = Tile $paper $night $nightShift; Save-Jpeg $tile (Join-Path $Out 'paper-dark.jpg'); $tile.Dispose()

# Buttons: the scroll turned sideways so its rollers sit at the ends.
foreach ($variant in @(@{ Name = 'scroll-light.png'; Scale = $null }, @{ Name = 'scroll-dark.png'; Scale = [float[]](1.1, 1.06, 1.0); Shift = [float[]](-0.58, -0.62, -0.66) })) {
    $small = Render $scroll 320 320 $null $variant.Scale $variant.Shift
    $small.RotateFlip([Drawing.RotateFlipType]::Rotate90FlipNone)
    $small.Save((Join-Path $Out $variant.Name), [Drawing.Imaging.ImageFormat]::Png)
    $small.Dispose()
}
$paper.Dispose(); $scroll.Dispose()
Get-ChildItem $Out | ForEach-Object { "{0} {1:N0} KB" -f $_.Name, ($_.Length / 1KB) }
