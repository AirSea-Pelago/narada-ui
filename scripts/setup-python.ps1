# Run this script ONCE to prepare the bundled Python

$pythonVersion = "3.11.9"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"
$pipUrl = "https://bootstrap.pypa.io/get-pip. py"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonDir = Join-Path $projectRoot "python"
$zipFile = Join-Path $projectRoot "python-embed. zip"

# Download Python Embedded
Write-Host "Downloading Python Embedded..."
Invoke-WebRequest -Uri $pythonUrl -OutFile $zipFile

# Extract
Write-Host "Extracting..."
Expand-Archive -Path $zipFile -DestinationPath $pythonDir -Force
Remove-Item $zipFile

# Enable pip by modifying python311._pth
$pthFile = Join-Path $pythonDir "python311._pth"
$pthContent = Get-Content $pthFile
$pthContent = $pthContent -replace "#import site", "import site"
Set-Content -Path $pthFile -Value $pthContent

# Download and install pip
Write-Host "Installing pip..."
$getPipFile = Join-Path $pythonDir "get-pip.py"
Invoke-WebRequest -Uri $pipUrl -OutFile $getPipFile
& "$pythonDir\python.exe" $getPipFile
Remove-Item $getPipFile

# Install dependencies
Write-Host "Installing dependencies..."
& "$pythonDir\python.exe" -m pip install --upgrade pip
& "$pythonDir\python.exe" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
& "$pythonDir\python.exe" -m pip install opencv-contrib-python numpy yacs easydict

Write-Host "Done!  Python is ready in:  $pythonDir"