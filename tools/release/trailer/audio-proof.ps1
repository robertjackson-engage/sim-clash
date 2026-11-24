# Proof that the trailer recorder plays nothing: watches every audio session on every active
# playback device (Windows Core Audio) for -Seconds seconds and reports, per process, whether
# it has an audio session at all and the highest peak level it reached (0 = silence).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\release\trailer\audio-proof.ps1 -Seconds 60
#
# Run it WHILE shoot.mjs is filming. The recorder's processes are every electron.exe whose
# command line names tools\release\trailer\recorder.cjs, and their children. Expected: they
# have no audio session, or one whose peak stays 0.
param([int]$Seconds = 30, [int]$EveryMs = 100)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace TrailerAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr props);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
  }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }
  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
    [PreserveSig] int GetGroupingParam(out Guid g);
    [PreserveSig] int SetGroupingParam(ref Guid g, ref Guid ctx);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference(bool optOut);
  }
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }

  public class Sample { public uint Pid; public float Peak; public int State; public string Device; }

  public static class Meter {
    // one pass over every session of every ACTIVE render endpoint
    public static List<Sample> Read(out float devicePeak) {
      var list = new List<Sample>();
      devicePeak = 0;
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
      IMMDeviceCollection col;
      if (en.EnumAudioEndpoints(0 /* eRender */, 1 /* ACTIVE */, out col) != 0) return list;
      int n; col.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IMMDevice dev; if (col.Item(i, out dev) != 0) continue;
        string id; dev.GetId(out id);
        object o;
        Guid meterId = typeof(IAudioMeterInformation).GUID;
        if (dev.Activate(ref meterId, 23, IntPtr.Zero, out o) == 0) { float p; ((IAudioMeterInformation)o).GetPeakValue(out p); if (p > devicePeak) devicePeak = p; }
        Guid mgrId = typeof(IAudioSessionManager2).GUID;
        if (dev.Activate(ref mgrId, 23, IntPtr.Zero, out o) != 0) continue;
        IAudioSessionEnumerator se; if (((IAudioSessionManager2)o).GetSessionEnumerator(out se) != 0) continue;
        int m; se.GetCount(out m);
        for (int j = 0; j < m; j++) {
          IAudioSessionControl2 s; if (se.GetSession(j, out s) != 0) continue;
          uint pid; s.GetProcessId(out pid);
          int state; s.GetState(out state);
          float peak = 0;
          var meter = s as IAudioMeterInformation;
          if (meter != null) meter.GetPeakValue(out peak);
          list.Add(new Sample { Pid = pid, Peak = peak, State = state, Device = id });
        }
      }
      return list;
    }
  }
}
'@

# the recorder's processes: electron.exe started on recorder.cjs, and everything under them
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
$roots = @($all | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -match 'recorder\.cjs' } | ForEach-Object { $_.ProcessId })
$mine = New-Object System.Collections.Generic.HashSet[uint32]
$queue = New-Object System.Collections.Queue
foreach ($r in $roots) { $queue.Enqueue([uint32]$r) }
while ($queue.Count) {
  $p = $queue.Dequeue()
  if ($mine.Add($p)) { foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $p })) { $queue.Enqueue([uint32]$c.ProcessId) } }
}

$peaks = @{}
$states = @{}
$devicePeak = 0.0
$samples = 0
$until = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $until) {
  $dp = 0.0
  $read = [TrailerAudio.Meter]::Read([ref]$dp)
  if ($dp -gt $devicePeak) { $devicePeak = $dp }
  foreach ($s in $read) {
    if (-not $peaks.ContainsKey($s.Pid) -or $s.Peak -gt $peaks[$s.Pid]) { $peaks[$s.Pid] = $s.Peak }
    if ($s.State -eq 1) { $states[$s.Pid] = 'active' } elseif (-not $states.ContainsKey($s.Pid)) { $states[$s.Pid] = 'inactive' }
  }
  $samples++
  Start-Sleep -Milliseconds $EveryMs
}

"watched $Seconds s ($samples samples, every $EveryMs ms); playback devices' own peak (everything on this PC): $([math]::Round($devicePeak, 4))"
"recorder processes (electron on recorder.cjs and children): $(if ($mine.Count) { ($mine | Sort-Object) -join ', ' } else { 'NONE RUNNING' })"
"audio sessions seen:"
foreach ($procId in ($peaks.Keys | Sort-Object)) {
  $name = ($all | Where-Object { $_.ProcessId -eq $procId } | Select-Object -First 1).Name
  if (-not $name) { $name = if ($procId -eq 0) { 'system sounds' } else { '?' } }
  $tag = if ($mine.Contains([uint32]$procId)) { '  <-- RECORDER' } else { '' }
  "  pid $procId  $name  session $($states[$procId])  max peak $([math]::Round($peaks[$procId], 4))$tag"
}
$recPeak = 0.0
$recSessions = 0
foreach ($procId in $peaks.Keys) { if ($mine.Contains([uint32]$procId)) { $recSessions++; if ($peaks[$procId] -gt $recPeak) { $recPeak = $peaks[$procId] } } }
if (-not $mine.Count) { "RESULT: no recorder was running: nothing proved" }
elseif ($recSessions -eq 0) { "RESULT: the recorder has NO audio session on any playback device: nothing of it can be heard" }
elseif ($recPeak -eq 0) { "RESULT: the recorder's $recSessions audio session(s) stayed at peak 0: silent" }
else { "RESULT: THE RECORDER PLAYED SOUND (peak $recPeak)" }
