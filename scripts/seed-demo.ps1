# Seeds synthetic demo data through the real sync API, so versions, quality checks and engineer names are set exactly
# like field data. Adds 18 findings (4 quality-flagged, 1 with an open conflict). Re-running adds another set.
#   ./scripts/seed-demo.ps1                                   # live API
#   ./scripts/seed-demo.ps1 -Api http://localhost:5080/api    # local API
param([string]$Api = 'https://fieldsync-api-dp.azurewebsites.net/api')
$ErrorActionPreference = 'Stop'

function Login($u, $p) { (Invoke-RestMethod "$Api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ username = $u; password = $p } | ConvertTo-Json)).token }
function Push($token, $device, $findings) {
  $body = @{ deviceId = $device; findings = @($findings) } | ConvertTo-Json -Depth 5
  (Invoke-RestMethod "$Api/sync/push" -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body).results
}
function F($exp, $lat, $lon, $mat, $depth, $hc, $notes, $daysAgo, $gps = 6) {
  $t = [DateTimeOffset]::UtcNow.AddDays(-$daysAgo).ToString('o')
  @{ id = [guid]::NewGuid(); expeditionId = $exp; latitude = $lat; longitude = $lon; gpsAccuracyM = $gps; materialType = $mat
     hydrocarbonIndicator = $hc; depthM = $depth; notes = $notes; capturedAt = $t; clientUpdatedAt = $t; baseServerVersion = $null; isDeleted = $false }
}
function Summary($results) { ($results.status | Group-Object | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ' }

$e1 = Login 'engineer1' 'Field@123'
$e2 = Login 'engineer2' 'Field@123'

# Block A: Cambay Basin 22.0-23.5 N / 72.0-73.0 E
"Block A: " + (Summary (Push $e1 'tablet-A1' @(
  (F 1 22.5123 72.5011 'Shale'     42.5 'GasShow' 'Grey laminated shale, faint gas odour at core break' 9),
  (F 1 22.5310 72.5188 'Sandstone' 61.0 'OilShow' 'Medium-grained sandstone, brown oil staining along bedding' 9),
  (F 1 22.5476 72.4930 'Siltstone' 18.2 'None'    'Buff siltstone, well cemented' 8),
  (F 1 22.6021 72.5402 'Limestone' 75.3 'GasShow' 'Fossiliferous limestone, gas bubbles in drilling mud' 8),
  (F 1 22.6190 72.5611 'Claystone' 12.0 'None'    'Soft red claystone, no shows' 7),
  (F 1 22.6505 72.5807 'Sandstone' 88.4 'OilShow' 'Fine sandstone, fluorescence under UV' 6),
  (F 1 22.7012 72.6103 'Shale'     53.6 'None'    'Dark carbonaceous shale' 5),
  (F 1 22.7240 72.6325 'Coal'      31.0 'GasShow' 'Thin lignite seam, methane detected' 4),
  (F 1 22.7500 72.6500 'Basalt'    95.0 'GasShow' 'Deccan basalt flow, gas reading on detector' 3),   # flag: show in basalt
  (F 1 23.8000 72.4000 'Sandstone' 20.0 'None'    'Recorded while driving to camp' 2)                  # flag: outside the block
)))

# Block B: Upper Assam Shelf 26.5-27.5 N / 94.0-95.5 E
"Block B: " + (Summary (Push $e2 'tablet-B7' @(
  (F 2 26.8125 94.6011 'Sandstone'    47.0 'OilShow' 'Tipam sandstone, oil bleeding from core' 9),
  (F 2 26.8402 94.6450 'Shale'        66.2 'GasShow' 'Barail shale, gas show at 66 m' 8),
  (F 2 26.9010 94.7120 'Conglomerate' 22.5 'None'    'Polymictic conglomerate, poorly sorted' 7),
  (F 2 26.9377 94.7803 'Siltstone'    35.8 'None'    'Micaceous siltstone' 6),
  (F 2 27.0102 94.8505 'Coal'         40.1 'GasShow' 'Coal seam, strong gas odour' 5 75),     # flag: weak GPS
  (F 2 27.0555 94.9021 'Sandstone'    58.0 'OilShow' 'Coarse sandstone, live oil in pores' 4)
)))
# Pushed after the first sample exists, ~1 m away: flag: possible duplicate
"Duplicate: " + (Summary (Push $e2 'tablet-B7' (F 2 27.05551 94.9021 'Sandstone' 58.5 'OilShow' 'Same outcrop, second sample' 3)))

# One conflict for the dashboard: two tablets edit the same finding from the same base version
$c = F 2 26.7450 94.5520 'Limestone' 70.0 'None' 'Grey limestone, tight' 2
$v1 = (Push $e2 'tablet-B7' $c)[0].serverVersion
$ok = $c.Clone(); $ok.depthM = 72.0; $ok.baseServerVersion = $v1; $ok.clientUpdatedAt = [DateTimeOffset]::UtcNow.AddMinutes(-30).ToString('o')
$stale = $c.Clone(); $stale.depthM = 74.5; $stale.hydrocarbonIndicator = 'GasShow'; $stale.notes = 'Grey limestone, gas show at 74.5 m on re-log'
$stale.baseServerVersion = $v1; $stale.clientUpdatedAt = [DateTimeOffset]::UtcNow.AddMinutes(-10).ToString('o')
"Conflict: " + (Push $e2 'tablet-B7' $ok)[0].status + ' then ' + (Push $e1 'tablet-A1' $stale)[0].status
