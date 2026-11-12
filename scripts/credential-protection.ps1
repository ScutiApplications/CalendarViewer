# DPAPI CurrentUser protects saved API keys without storing a separate encryption key in the app folder.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$inputBytes = $null
$outputBytes = $null
try {
    Add-Type -AssemblyName System.Security
    $payload = [Console]::In.ReadToEnd()
    if ($payload.Length -gt 16384) { throw 'Invalid credential request.' }
    $request = $payload | ConvertFrom-Json
    if ($request.provider -notin @('anthropic', 'openai', 'gemini')) { throw 'Invalid provider.' }
    if ($request.action -notin @('protect', 'unprotect')) { throw 'Invalid operation.' }
    $inputBytes = [Convert]::FromBase64String($request.data)
    if ($inputBytes.Length -gt 8192) { throw 'Invalid credential size.' }
    $entropy = [Text.Encoding]::UTF8.GetBytes('CalendarViewer.api-key.v1.' + $request.provider)
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($request.action -eq 'protect') {
        $outputBytes = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $entropy, $scope)
    } else {
        $outputBytes = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $entropy, $scope)
    }
    [Console]::Out.Write((@{ data = [Convert]::ToBase64String($outputBytes) } | ConvertTo-Json -Compress))
} catch {
    # Never include PowerShell diagnostics: they can contain credential data or plaintext input.
    [Console]::Error.WriteLine('Credential protection failed.')
    exit 1
} finally {
    if ($null -ne $inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
    if ($null -ne $outputBytes) { [Array]::Clear($outputBytes, 0, $outputBytes.Length) }
}
