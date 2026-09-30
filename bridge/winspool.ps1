param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$DataPath
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ArmaniRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr handle, int level, ref DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
}
'@
$bytes = [System.IO.File]::ReadAllBytes($DataPath)
$handle = [IntPtr]::Zero
if (-not [ArmaniRawPrinter]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) {
  throw "PRINTER_OPEN_FAILED"
}
try {
  $doc = New-Object ArmaniRawPrinter+DOCINFO
  $doc.pDocName = 'Armani Caffe receipt'
  $doc.pDataType = 'RAW'
  if ([ArmaniRawPrinter]::StartDocPrinter($handle, 1, [ref]$doc) -le 0) {
    throw "PRINTER_START_FAILED"
  }
  try {
    if (-not [ArmaniRawPrinter]::StartPagePrinter($handle)) { throw "PRINTER_PAGE_FAILED" }
    try {
      $written = 0
      if (-not [ArmaniRawPrinter]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written) -or $written -ne $bytes.Length) {
        throw "PRINTER_WRITE_FAILED"
      }
    } finally {
      if (-not [ArmaniRawPrinter]::EndPagePrinter($handle)) { throw "PRINTER_END_PAGE_FAILED" }
    }
  } finally {
    if (-not [ArmaniRawPrinter]::EndDocPrinter($handle)) { throw "PRINTER_END_DOC_FAILED" }
  }
} finally {
  [void][ArmaniRawPrinter]::ClosePrinter($handle)
}
