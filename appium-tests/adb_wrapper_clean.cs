using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Collections.Generic;

class AdbWrapper
{
    static int Main(string[] args)
    {
        string logPath = @"C:\Users\aysha\Desktop\PDD\appium-tests\adb_wrapper_log.txt";
        string realAdbPath = @"C:\Users\aysha\AppData\Local\Android\Sdk\platform-tools\adb.exe";

        // Build arguments list
        List<string> newArgs = new List<string>();
        bool hasShell = false;
        bool hasPs = false;
        bool hasA = false;

        foreach (string arg in args)
        {
            if (arg == "shell") hasShell = true;
            if (arg == "ps") hasPs = true;
            if (arg == "-A" || arg == "-e") hasA = true;
        }

        foreach (string arg in args)
        {
            newArgs.Add(arg);
            if (hasShell && hasPs && !hasA && arg == "ps")
            {
                newArgs.Add("-A");
            }
        }

        // Log the call for debugging
        try
        {
            string origCmd = string.Join(" ", args);
            string newCmd = string.Join(" ", newArgs);
            File.AppendAllText(logPath, string.Format("[{0:yyyy-MM-dd HH:mm:ss}] ORIG: {1} | NEW: {2}\n", DateTime.Now, origCmd, newCmd));
        }
        catch {}

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = realAdbPath;
        
        // Escape arguments properly
        StringBuilder sb = new StringBuilder();
        foreach (string arg in newArgs)
        {
            string escaped = arg.Replace("\"", "\\\"");
            if (escaped.Contains(" ") || escaped.Contains("^") || escaped == "")
            {
                sb.Append("\"" + escaped + "\" ");
            }
            else
            {
                sb.Append(escaped + " ");
            }
        }
        psi.Arguments = sb.ToString().TrimEnd();
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardInput = true;
        psi.CreateNoWindow = true;

        using (Process process = new Process())
        {
            process.StartInfo = psi;
            
            process.OutputDataReceived += (sender, e) => {
                if (e.Data != null) Console.Out.WriteLine(e.Data);
            };
            process.ErrorDataReceived += (sender, e) => {
                if (e.Data != null) Console.Error.WriteLine(e.Data);
            };

            try
            {
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                return process.ExitCode;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Wrapper Error: " + ex.Message);
                return 1;
            }
        }
    }
}
