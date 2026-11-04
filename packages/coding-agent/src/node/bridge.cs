// Narrow Windows host: exclusive OS file lock + jobs. No user script runs in this process.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Alpha {
public static class CodingBridge {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int size; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string reserved, desktop, title;
    public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reserved2;
    public IntPtr reservedPtr, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct SIX { public SI si; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process, thread; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC {
    public long processTime, jobTime; public uint flags; public UIntPtr min,max;
    public uint active; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong r,w,o,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC basic; public IO io; public UIntPtr pm,jm,peakp,peakj; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNT { public long u,k,pu,pk; public uint faults,total,active,terminated; }
  [DllImport("kernel32", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr sa, IntPtr name);
  [DllImport("kernel32", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref EXT data,int size);
  [DllImport("kernel32", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out ACCOUNT data,int size,IntPtr len);
  [DllImport("kernel32", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint exit);
  [DllImport("kernel32", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint exit);
  [DllImport("kernel32", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SA sa,int size);
  [DllImport("kernel32", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint share,ref SA sa,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
  [DllImport("kernel32", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attr,IntPtr value,IntPtr size,IntPtr prev,IntPtr returned);
  [DllImport("kernel32")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr psa,IntPtr tsa,bool inherit,uint flags,IntPtr env,string cwd,ref SIX start,out PI info);

  static readonly object outputLock = new object();
  static string Decode(string value) { return Encoding.UTF8.GetString(Convert.FromBase64String(value)); }
  static void Emit(string value) { lock(outputLock) { Console.WriteLine(value); Console.Out.Flush(); } }
  static void Check(bool ok) { if(!ok) throw new IOException("WIN32_"+Marshal.GetLastWin32Error()); }
  sealed class Command {
    public volatile bool cancelled;
    public string[] args; public Task task;
    int remaining; bool truncated;
    void Pump(IntPtr handle,string channel) {
      using(var stream=new FileStream(new SafeFileHandle(handle,true),FileAccess.Read))
      using(var reader=new StreamReader(stream,new UTF8Encoding(false,false))) {
        char[] buffer=new char[2048]; int n;
        while((n=reader.Read(buffer,0,buffer.Length))>0) {
          lock(outputLock) {
            string text=new string(buffer,0,n);
            while(text.Length>0 && Encoding.UTF8.GetByteCount(text)>remaining) text=text.Substring(0,text.Length-1);
            if(text.Length>0 && char.IsHighSurrogate(text[text.Length-1])) text=text.Substring(0,text.Length-1);
            remaining-=Encoding.UTF8.GetByteCount(text); if(text.Length<n) truncated=true;
            if(text.Length>0) Emit("OUT|"+args[1]+"|"+channel+"|"+Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
          }
        }
      }
    }
    public void Execute() {
      IntPtr job=IntPtr.Zero, attributes=IntPtr.Zero, handles=IntPtr.Zero, env=IntPtr.Zero;
      IntPtr ro=IntPtr.Zero, wo=IntPtr.Zero, re=IntPtr.Zero, we=IntPtr.Zero, input=IntPtr.Zero;
      PI pi=new PI(); Task stdout=null,stderr=null; bool resumed=false, attrsReady=false;
      string status="not_started",code="COMMAND_START_FAILED"; uint exit=0;
      try {
        remaining=int.Parse(args[6]); int timeout=int.Parse(args[5]);
        job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero); Check(job!=IntPtr.Zero);
        EXT limits=new EXT(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE, no breakaway
        Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf<EXT>()));
        SA sa=new SA { size=Marshal.SizeOf<SA>(), inherit=1 };
        Check(CreatePipe(out ro,out wo,ref sa,0)); Check(SetHandleInformation(ro,1,0));
        Check(CreatePipe(out re,out we,ref sa,0)); Check(SetHandleInformation(re,1,0));
        input=CreateFileW("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero); Check(input!=new IntPtr(-1));
        IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
        attributes=Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes,1,0,ref size)); attrsReady=true;
        handles=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.WriteIntPtr(handles,0,input); Marshal.WriteIntPtr(handles,IntPtr.Size,wo); Marshal.WriteIntPtr(handles,IntPtr.Size*2,we);
        Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
        SIX si=new SIX(); si.si.cb=Marshal.SizeOf<SIX>(); si.si.flags=0x100; si.si.input=input; si.si.output=wo; si.si.error=we; si.attributes=attributes;
        string shell=Decode(args[2]); string script=Decode(args[4]);
        string command="\""+shell+"\" -NoLogo -NoProfile -NonInteractive -EncodedCommand "+Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        env=Marshal.StringToHGlobalUni(Decode(args[7]));
        if(cancelled) { code="COMMAND_CANCELLED"; return; }
        Check(CreateProcessW(shell,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x08080404,env,Decode(args[3]),ref si,out pi));
        Check(AssignProcessToJobObject(job,pi.process));
        CloseHandle(wo); wo=IntPtr.Zero; CloseHandle(we); we=IntPtr.Zero; CloseHandle(input); input=IntPtr.Zero;
        IntPtr outHandle=ro,errHandle=re;
        stdout=Task.Run(()=>Pump(outHandle,"stdout")); ro=IntPtr.Zero;
        stderr=Task.Run(()=>Pump(errHandle,"stderr")); re=IntPtr.Zero;
        if(cancelled) { code="COMMAND_CANCELLED"; return; }
        Check(ResumeThread(pi.thread)!=uint.MaxValue); resumed=true;
        Emit("STARTED|"+args[1]);
        var timer=System.Diagnostics.Stopwatch.StartNew();
        bool terminated=false;
        while(true) {
          ACCOUNT accounting; Check(QueryInformationJobObject(job,1,out accounting,Marshal.SizeOf<ACCOUNT>(),IntPtr.Zero));
          if(accounting.active==0) break;
          if(!terminated && (cancelled || timer.ElapsedMilliseconds>=timeout)) {
            code=cancelled ? "COMMAND_CANCELLED" : "COMMAND_TIMEOUT"; Check(TerminateJobObject(job,130)); terminated=true;
          }
          Thread.Sleep(10);
        }
        Check(GetExitCodeProcess(pi.process,out exit)); Task.WaitAll(stdout,stderr);
        status=terminated ? "unknown" : "exited"; if(!terminated) code="";
      } catch { status=resumed ? "unknown" : "not_started"; code=resumed ? "COMMAND_OUTCOME_UNKNOWN" : "COMMAND_START_FAILED"; }
      finally {
        // Retain the workspace lock until the entire Job has drained, including on failures.
        if(job!=IntPtr.Zero) {
          TerminateJobObject(job,130);
          ACCOUNT a;
          while(QueryInformationJobObject(job,1,out a,Marshal.SizeOf<ACCOUNT>(),IntPtr.Zero) && a.active!=0) Thread.Sleep(10);
          CloseHandle(job);
        }
        if(pi.process!=IntPtr.Zero) { TerminateProcess(pi.process,130); WaitForSingleObject(pi.process,0xffffffff); CloseHandle(pi.process); }
        if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
        foreach(IntPtr h in new[]{ro,wo,re,we,input}) if(h!=IntPtr.Zero && h!=new IntPtr(-1)) CloseHandle(h);
        try { if(stdout!=null) stdout.Wait(); if(stderr!=null) stderr.Wait(); } catch { if(resumed) {status="unknown";code="COMMAND_OUTPUT_FAILED";} }
        if(attrsReady) DeleteProcThreadAttributeList(attributes);
        if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
        if(handles!=IntPtr.Zero) Marshal.FreeHGlobal(handles);
        if(env!=IntPtr.Zero) Marshal.FreeHGlobal(env);
        Emit("END|"+args[1]+"|"+status+"|"+unchecked((int)exit)+"|"+(truncated?"1":"0")+"|"+code);
      }
    }
  }
  public static void Run() {
    Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
    FileStream lease=null; Command active=null;
    try {
      Emit("BOOT|1"); string line;
      while((line=Console.ReadLine())!=null) {
        string[] args=line.Split('|');
        if(args[0]=="LOCK" && lease==null) {
          try { lease=new FileStream(Decode(args[1]),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None); Emit("LOCKED"); }
          catch { Emit("BUSY"); }
        } else if(args[0]=="RUN" && lease!=null) {
          if(active!=null) active.task.Wait();
          active=new Command {args=args}; Command current=active; active.task=Task.Run(()=>current.Execute());
        } else if(args[0]=="CANCEL" && active!=null && active.args[1]==args[1]) active.cancelled=true;
        else if(args[0]=="CLOSE") break;
        else Emit("ERROR|PROTOCOL");
      }
    } finally {
      if(active!=null) { active.cancelled=true; active.task.Wait(); }
      if(lease!=null) lease.Dispose();
    }
  }
}
}
