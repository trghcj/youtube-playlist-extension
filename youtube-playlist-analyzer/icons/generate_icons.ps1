Add-Type -AssemblyName System.Drawing

$basePath = "c:\Users\suremdra singh\Documents\antigravity\blissful-goodall\youtube-playlist-analyzer\icons"
$sizes = @(16, 48, 128)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    
    # Red background
    $g.Clear([System.Drawing.Color]::FromArgb(255, 204, 0, 0))
    
    # White play triangle
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    
    $cx = [int]($size * 0.35)
    $cy = [int]($size * 0.25)
    $tw = [int]($size * 0.35)
    $th = [int]($size * 0.5)
    
    $points = @(
        (New-Object System.Drawing.Point($cx, $cy)),
        (New-Object System.Drawing.Point(($cx + $tw), ($cy + [int]($th / 2)))),
        (New-Object System.Drawing.Point($cx, ($cy + $th)))
    )
    $g.FillPolygon($brush, $points)
    
    # Clock indicator bottom-right
    $clockSize = [int]($size * 0.35)
    $clockX = [int]($size * 0.7) - [int]($clockSize / 2)
    $clockY = [int]($size * 0.7) - [int]($clockSize / 2)
    $g.FillEllipse($brush, $clockX, $clockY, $clockSize, $clockSize)
    
    # Clock hands
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 204, 0, 0), [Math]::Max(1, $size * 0.04))
    $centerX = $clockX + [int]($clockSize / 2)
    $centerY = $clockY + [int]($clockSize / 2)
    $handLen = [int]($clockSize * 0.3)
    $g.DrawLine($pen, $centerX, $centerY, $centerX, ($centerY - $handLen))
    $g.DrawLine($pen, $centerX, $centerY, ($centerX + $handLen), $centerY)
    
    $outputPath = Join-Path $basePath "icon$size.png"
    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $g.Dispose()
    $bmp.Dispose()
    $pen.Dispose()
    $brush.Dispose()
    
    Write-Host "Created icon$size.png"
}

Write-Host "All icons generated successfully!"
