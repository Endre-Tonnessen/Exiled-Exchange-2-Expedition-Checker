# Bridges to Windows' own OCR engine (Windows.Media.Ocr - the same engine behind
# PowerToys' Text Extractor and Snipping Tool's text actions). There is no Node/
# Electron API for this; WindowsOcr.ts spawns this script per call as the only way
# to reach it. Ported unchanged from ocr-playground/winocr/recognize.ps1, where it
# was validated interactively against real captures before porting - see that
# project's README ("Windows OCR (native)" section) for what was observed.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File <this file> <image path>
# Prints one JSON object to stdout: {ok, text, lines[{text, words[{text,x,y,width,height}]}],
# elapsedMs, engineLanguage, imageWidth, imageHeight} on success, or {ok:false, error} on failure.

param(
    [Parameter(Mandatory = $true)][string]$ImagePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]

# WinRT's IAsyncOperation<T> has no awaiter PowerShell can use directly - the
# standard workaround is reflecting into System.WindowsRuntimeSystemExtensions'
# generic AsTask<T>(), then blocking on the resulting Task (fine here: this script
# is a one-shot subprocess, not something with its own UI thread to keep responsive).
function Await($WinRtTask, $ResultType) {
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0].MakeGenericMethod($ResultType)
    $task = $asTaskGeneric.Invoke($null, @($WinRtTask))
    $task.Wait(-1) | Out-Null
    $task.Result
}

try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    # OcrEngine.RecognizeAsync only accepts Gray8/Nv12/Bgra8 pixel format with
    # Premultiplied-or-Ignore alpha - normalize unconditionally rather than assume
    # the PNG WindowsOcr.ts wrote decodes to exactly that.
    $needsConvert = $bitmap.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8 `
        -or $bitmap.BitmapAlphaMode -eq [Windows.Graphics.Imaging.BitmapAlphaMode]::Straight
    if ($needsConvert) {
        $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert(
            $bitmap,
            [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
            [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)
    }

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) {
        throw "No OCR engine available for any installed user-profile language. Install an OCR language pack: Settings > Time & language > Language & region > (your language) > Language options > Optical character recognition."
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $sw.Stop()

    $lines = @()
    foreach ($line in $result.Lines) {
        $words = @()
        foreach ($word in $line.Words) {
            $r = $word.BoundingRect
            $words += [ordered]@{
                text   = $word.Text
                x      = [math]::Round($r.X, 1)
                y      = [math]::Round($r.Y, 1)
                width  = [math]::Round($r.Width, 1)
                height = [math]::Round($r.Height, 1)
            }
        }
        $lines += [ordered]@{ text = $line.Text; words = $words }
    }

    $output = [ordered]@{
        ok             = $true
        text           = $result.Text
        lines          = $lines
        elapsedMs      = $sw.ElapsedMilliseconds
        engineLanguage = $engine.RecognizerLanguage.DisplayName
        imageWidth     = $bitmap.PixelWidth
        imageHeight    = $bitmap.PixelHeight
    }
    Write-Output ($output | ConvertTo-Json -Depth 5 -Compress)
}
catch {
    $errOutput = [ordered]@{ ok = $false; error = $_.Exception.Message }
    Write-Output ($errOutput | ConvertTo-Json -Compress)
    exit 1
}
