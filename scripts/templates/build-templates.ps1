# Builds the template lab: HTML -> PDF with Chrome, .docx -> PDF with Microsoft Word.
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts/templates/build-templates.ps1
$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$out = Join-Path $root "fixtures\templates\pdf"
New-Item -ItemType Directory -Force $out | Out-Null

node scripts/templates/make-html.mjs
python scripts/templates/make-docx.py

# --- Chrome: print each HTML template ---
$chrome = @("C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome not found" }
$profileDir = Join-Path $env:TEMP "ats-template-chrome"
Get-ChildItem (Join-Path $root "fixtures\templates\html") -Filter *.html | ForEach-Object {
  $pdf = Join-Path $out ($_.BaseName + ".pdf")
  $url = "file:///" + ($_.FullName -replace "\\", "/")
  # Chrome logs harmless warnings to stderr; Start-Process keeps them out of PowerShell's error stream.
  $args = @("--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--user-data-dir=`"$profileDir`"", "--print-to-pdf=`"$pdf`"", "`"$url`"")
  Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden -RedirectStandardError (Join-Path $env:TEMP "ats-chrome-err.log")
  Write-Output ("chrome  -> " + $_.BaseName + ".pdf")
}

# --- Word: add a floating text box to one template, then export all .docx to PDF ---
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  Get-ChildItem (Join-Path $root "fixtures\templates\docx") -Filter *.docx | ForEach-Object {
    $doc = $word.Documents.Open($_.FullName)
    if ($_.BaseName -eq "word-textbox") {
      # Contact block in a floating text box at the top right, as many Word templates do.
      $tb = $doc.Shapes.AddTextbox(1, 380, 30, 190, 70)
      $tb.TextFrame.TextRange.Text = "jordan.rivera@example.com`r(512) 555-0142`rAustin, TX`rlinkedin.com/in/jordan-rivera-dev"
      $tb.TextFrame.TextRange.Font.Size = 9
      $doc.Save()
    }
    $pdf = [string](Join-Path $out ($_.BaseName + ".pdf"))
    $doc.ExportAsFixedFormat($pdf, 17)   # 17 = wdExportFormatPDF
    $doc.Close(0)
    Write-Output ("word    -> " + $_.BaseName + ".pdf")
  }
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
