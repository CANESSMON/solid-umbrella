import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import {
  Printer,
  Settings,
  Activity,
  Wifi,
  WifiOff,
  LogOut,
  Lock,
  Mail,
  Server,
  RefreshCw,
  Coins,
  FileText,
  Clock,
} from "lucide-react";

// Detect if running inside native Tauri environment
const isTauriEnv = () => {
  try {
    return (
      typeof window !== "undefined" &&
      ((window as any).__TAURI_INTERNALS__ !== undefined ||
        (window as any).__TAURI__ !== undefined)
    );
  } catch {
    return false;
  }
};

interface Job {
  id: string;
  token: string;
  copies: number;
  isColor: boolean;
  isDuplex: boolean;
  pageSize: string | null;
  orientation: string | null;
  price: number;
  status: string;
  errorMessage?: string;
  pages: string | null;
  document: {
    id: string;
    originalName: string;
    mimeType: string;
    filesize: number;
    pageCount: number | null;
  };
}

interface LogEntry {
  timestamp: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

export default function App() {
  const isTauri = isTauriEnv();

  // Connection settings
  const [serverUrl, setServerUrl] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Shop settings
  const [shopName, setShopName] = useState("");
  const [bwPrinter, setBwPrinter] = useState("");
  const [bwDuplex, setBwDuplex] = useState(false);
  const [colorPrinter, setColorPrinter] = useState("");
  const [colorDuplex, setColorDuplex] = useState(false);
  const [bwRate, setBwRate] = useState("0.15");
  const [colorRate, setColorRate] = useState("0.75");
  const [isLive, setIsLive] = useState(false);

  // System states
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [jobQueue, setJobQueue] = useState<Job[]>([]);
  const [historyJobs, setHistoryJobs] = useState<Job[]>([]);
  const [activeQueueTab, setActiveQueueTab] = useState<"active" | "history" | "archive">("active");
  const [archivedJobs, setArchivedJobs] = useState<any[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeLogTab, setActiveLogTab] = useState<"active" | "history">("active");
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [jobsCompletedCount, setJobsCompletedCount] = useState(0);
  const [showDetailedLogs, setShowDetailedLogs] = useState(() => {
    try {
      return localStorage.getItem("pf_show_detailed_logs") === "true";
    } catch {
      return false;
    }
  });

  // Active print processing lock
  const processingJobs = useRef<Set<string>>(new Set());

  // Log container ref for auto scroll
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Prunes and returns history logs older than 3 days
  const getPrunedHistory = (): any[] => {
    try {
      const historyStr = localStorage.getItem("pf_log_history") || "[]";
      const history = JSON.parse(historyStr);
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const filtered = history.filter((entry: any) => {
        const entryDate = new Date(entry.timestamp);
        return entryDate >= threeDaysAgo;
      });

      if (filtered.length !== history.length) {
        localStorage.setItem("pf_log_history", JSON.stringify(filtered));
      }
      return filtered;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  // Helper to format ISO timestamp for history view
  const formatHistoryTimestamp = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const datePart = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const timePart = date.toLocaleTimeString();
      return `${datePart} ${timePart}`;
    } catch (e) {
      return isoString;
    }
  };

  const getDisplayMessage = (msg: string) => {
    if (showDetailedLogs) return msg;

    let cleanMsg = msg;

    if (cleanMsg.includes("Initializing RapidDocs Agent")) {
      const isTauriMode = cleanMsg.includes("Tauri Mode: Yes");
      return isTauriMode 
        ? "RapidDocs Agent is starting up..." 
        : "RapidDocs Agent starting in simulation mode...";
    }
    if (cleanMsg.includes("Restored authenticated session")) {
      return "Welcome back! Logged in successfully.";
    }
    const printerMatch = cleanMsg.match(/Discovered (\d+) local hardware printers/);
    if (printerMatch) {
      return `Found ${printerMatch[1]} printers connected to this computer.`;
    }
    if (cleanMsg.includes("Loaded mock printers")) {
      return "Loaded test printers for preview.";
    }
    const dashboardMatch = cleanMsg.match(/Connected to shop dashboard: (.+)/);
    if (dashboardMatch) {
      return `Connected to ${dashboardMatch[1]} dashboard.`;
    }
    if (cleanMsg.includes("Attempting connection to")) {
      return "Connecting to RapidDocs Cloud...";
    }
    if (cleanMsg.includes("Authentication successful")) {
      return "Signed in successfully.";
    }
    if (cleanMsg.includes("Synchronizing configurations")) {
      return "Syncing settings with the cloud...";
    }
    if (cleanMsg.includes("Rates & designated hardware mappings spooled")) {
      return "Printer settings synced successfully.";
    }
    if (cleanMsg.includes("Connecting terminal online...")) {
      return "Connecting to the cloud network...";
    }
    if (cleanMsg.includes("Going offline...")) {
      return "Disconnecting from the cloud network...";
    }
    if (cleanMsg.includes("Terminal is now LIVE")) {
      return "Your shop terminal is now ONLINE and ready to receive prints.";
    }
    if (cleanMsg === "Terminal offline") {
      return "Your shop terminal is now OFFLINE.";
    }
    
    // Printing flow
    const receivedMatch = cleanMsg.match(/Received print job (\S+) for document: (.+)/);
    if (receivedMatch) {
      return `New print request received: "${receivedMatch[2]}" (Job: ${receivedMatch[1]})`;
    }
    const queuedMatch = cleanMsg.match(/Job (\S+) queued locally\./);
    if (queuedMatch) {
      return `Job ${queuedMatch[1]} is preparing to print.`;
    }
    const downloadMatch = cleanMsg.match(/Downloading and sending job (\S+) to native Edge print automation\.\.\./);
    if (downloadMatch) {
      return `Downloading files and sending job ${downloadMatch[1]} to printer...`;
    }
    if (cleanMsg.includes("Document spooled successfully. Printing pages...")) {
      return "Sent to printer queue. Starting print job...";
    }
    
    const pageProgressMatch = cleanMsg.match(/Printing page (\d+) of (\d+) \(Status: (.*?)\)/i);
    if (pageProgressMatch) {
      const [_, page, total, status] = pageProgressMatch;
      let statusStr = "";
      if (status.includes("Error")) statusStr = " - Printer error detected";
      else if (status.includes("PaperOut")) statusStr = " - Printer out of paper";
      else if (status.includes("Offline")) statusStr = " - Printer offline";
      return `Printing page ${page} of ${total}${statusStr}...`;
    }

    if (cleanMsg.includes("Printed completed successfully.") || cleanMsg.includes("Print completed successfully.")) {
      return "Print job completed successfully.";
    }
    const printedSuccessMatch = cleanMsg.match(/Job (\S+) printed successfully on "(.+)"!/);
    if (printedSuccessMatch) {
      return `Finished printing job ${printedSuccessMatch[1]} on printer "${printedSuccessMatch[2]}".`;
    }
    if (cleanMsg.includes("Print spool initiated via SumatraPDF")) {
      return "Document sent to printer successfully.";
    }
    if (cleanMsg.includes("No printer designated for")) {
      const colorType = cleanMsg.includes("Color") ? "Color" : "B&W";
      return `Error: No printer configured for ${colorType} printing. Please check your settings.`;
    }
    
    const simSpoolMatch = cleanMsg.match(/\[SIMULATION\] Spooling (\d+) copies to printer "(.*?)" \((.*?)\)\.\.\./);
    if (simSpoolMatch) {
      const [_, copies, printerName, duplexMode] = simSpoolMatch;
      const pagesText = copies === "1" ? "1 copy" : `${copies} copies`;
      const modeText = duplexMode.toLowerCase() === "double-sided" ? "double-sided" : "single-sided";
      return `[Simulation] Printing ${pagesText} on "${printerName}" (${modeText})...`;
    }

    if (cleanMsg.startsWith("[Job Spooler] ")) {
      cleanMsg = cleanMsg.replace("[Job Spooler] ", "");
    }
    if (cleanMsg.startsWith("Edge Print Spooler: ")) {
      cleanMsg = cleanMsg.replace("Edge Print Spooler: ", "");
    }

    return cleanMsg;
  };

  const loadArchivedJobs = async () => {
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<any[]>("get_archived_jobs");
        setArchivedJobs(list);
      } catch (err: any) {
        addLog(`Failed to load archived jobs: ${err.message || err}`, "error");
      }
    }
  };

  const triggerNotification = (title: string, body: string) => {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            new Notification(title, { body });
          }
        });
      }
    }
  };

  // Set up Tauri event listener for print progress & completion status
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<any>("print-status", async (event) => {
          const { jobId, status, message } = event.payload;
          
          let logType: "info" | "success" | "warning" | "error" = "info";
          if (status === "COMPLETED") logType = "success";
          else if (status === "FAILED") logType = "error";

          addLog(`[Job Spooler] ${message}`, logType);
          
          // Reload archive list to show updated status
          loadArchivedJobs();

          if (status === "COMPLETED" || status === "FAILED") {
            processingJobs.current.delete(jobId);
            
            // Sync status to the central server
            await updateJobStatus(jobId, status, status === "FAILED" ? message : undefined);
            fetchJobHistory();

            if (status === "COMPLETED") {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                const dbJobs = await invoke<any[]>("get_archived_jobs");
                const archJob = dbJobs.find(j => j.id === jobId);
                if (archJob) {
                  setTodayEarnings(prev => prev + archJob.price);
                  setJobsCompletedCount(prev => prev + 1);
                }
              } catch (e) {
                console.error(e);
              }
            } else if (status === "FAILED") {
              triggerNotification("Print Job Failed", `Print job was interrupted. Message: ${message}`);
            }
          }
        });
      } catch (err) {
        console.error("Failed to setup print-status event listener", err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [isTauri, serverUrl, token]);

  // Append a diagnostic system log
  const addLog = (message: string, type: "info" | "success" | "warning" | "error" = "info") => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    const isoString = now.toISOString();

    setLogs((prev) => {
      const next = [...prev, { timestamp, message, type }];
      if (next.length > 100) {
        return next.slice(next.length - 100);
      }
      return next;
    });

    try {
      const historyStr = localStorage.getItem("pf_log_history") || "[]";
      const history = JSON.parse(historyStr);
      history.push({ timestamp: isoString, message, type });

      // Clean up older than 3 days
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const filtered = history.filter((entry: any) => {
        const entryDate = new Date(entry.timestamp);
        return entryDate >= threeDaysAgo;
      });

      localStorage.setItem("pf_log_history", JSON.stringify(filtered));
      setHistoryLogs(filtered);
    } catch (e) {
      console.error("Failed to update log history:", e);
    }
  };

  useEffect(() => {
    if (activeLogTab === "active" && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, activeLogTab]);

  useEffect(() => {
    setHistoryLogs(getPrunedHistory());
  }, []);

  // Load config on mount
  useEffect(() => {
    const init = async () => {
      addLog(`Initializing RapidDocs Agent (Tauri Mode: ${isTauri ? "Yes" : "No (Simulation)"})`, "info");
      
      // Load saved server URL & token from localStorage/Tauri
      const savedServer = (localStorage.getItem("pf_server_url") || "http://localhost:3000").trim().replace(/\/+$/, "");
      setServerUrl(savedServer);

      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const config: any = await invoke("load_config");
          if (config && config.token) {
            setToken(config.token);
            setIsLoggedIn(true);
            addLog("Restored authenticated session from config store", "success");
            fetchShopDetails(savedServer, config.token);
          }
          const printers: string[] = await invoke("get_printers");
          setAvailablePrinters(printers);
          addLog(`Discovered ${printers.length} local hardware printers`, "success");
          
          const list = await invoke<any[]>("get_archived_jobs");
          setArchivedJobs(list);
        } catch (e) {
          addLog(`Failed to invoke Tauri config load: ${e}`, "error");
        }
      } else {
        // Mock fallback
        const savedToken = localStorage.getItem("pf_token");
        if (savedToken) {
          setToken(savedToken);
          setIsLoggedIn(true);
          addLog("Restored simulation session", "success");
          fetchShopDetails(savedServer, savedToken);
        }
        const mockPrinters = [
          "HP LaserJet Pro M402 (B&W)",
          "Epson L3110 Series (Color)",
          "Canon LBP2900 B&W",
          "Microsoft Print to PDF",
        ];
        setAvailablePrinters(mockPrinters);
        addLog("Loaded mock printers for browser preview", "info");
        setArchivedJobs([]);
      }
    };
    init();
  }, []);

  // Sync archive whenever the archive tab is clicked
  useEffect(() => {
    if (activeQueueTab === "archive") {
      loadArchivedJobs();
    }
  }, [activeQueueTab]);

  // Fetch shop metadata
  const fetchShopDetails = async (url: string, activeToken: string) => {
    try {
      const response = await fetch(`${url}/api/agent/shop`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      const data = await response.json();
      if (response.ok && data.shop) {
        setShopName(data.shop.name);
        setBwPrinter(data.shop.bwPrinter || "");
        setBwDuplex(data.shop.bwDuplex || false);
        setColorPrinter(data.shop.colorPrinter || "");
        setColorDuplex(data.shop.colorDuplex || false);
        setBwRate(data.shop.bwRate.toString());
        setColorRate(data.shop.colorRate.toString());
        setIsLive(data.shop.isLive);
        addLog(`Connected to shop dashboard: ${data.shop.name}`, "success");

        // Dynamically add the synced printers to availablePrinters if they aren't already there
        setAvailablePrinters((prev) => {
          const next = [...prev];
          if (data.shop.bwPrinter && !next.includes(data.shop.bwPrinter)) {
            next.push(data.shop.bwPrinter);
          }
          if (data.shop.colorPrinter && !next.includes(data.shop.colorPrinter)) {
            next.push(data.shop.colorPrinter);
          }
          return next;
        });
      } else {
        addLog(data.error || "Failed to retrieve shop configuration", "error");
      }
    } catch (err) {
      addLog("Could not reach print cloud server", "error");
    }
  };

  // Handle Login submission
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
    addLog(`Attempting connection to ${cleanUrl}...`, "info");

    try {
      const response = await fetch(`${cleanUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      if (data.user.role !== "SHOP_OWNER") {
        throw new Error("Access Denied: Web-admin credentials cannot connect to Desktop Agent.");
      }

      const activeToken = data.token;
      setToken(activeToken);
      setIsLoggedIn(true);
      localStorage.setItem("pf_server_url", cleanUrl);
      localStorage.setItem("pf_token", activeToken);
      setServerUrl(cleanUrl);
      addLog("Authentication successful", "success");

      // Reload config & shop configuration
      await fetchShopDetails(cleanUrl, activeToken);

      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_config", { token: activeToken, settings: JSON.stringify({ email }) });
      }
    } catch (err: any) {
      addLog(err.message || "Failed to log in", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Sync Rates & Printers to database
  const handleSyncSettings = async () => {
    setIsSyncing(true);
    addLog("Synchronizing configurations with cloud database...", "info");
    try {
      const response = await fetch(`${serverUrl}/api/agent/shop`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bwRate: parseFloat(bwRate),
          colorRate: parseFloat(colorRate),
          bwPrinter,
          bwDuplex,
          colorPrinter,
          colorDuplex,
        }),
      });

      if (!response.ok) throw new Error("Sync failed");
      addLog("Rates & designated hardware mappings spooled successfully", "success");
    } catch (err: any) {
      addLog(err.message || "Rates sync failed", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Toggle Shop status (Go Live / Go Offline)
  const toggleLiveStatus = async () => {
    const nextState = !isLive;
    addLog(nextState ? "Connecting terminal online..." : "Going offline...", "info");
    try {
      const response = await fetch(`${serverUrl}/api/agent/shop`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isLive: nextState,
          status: nextState ? "ONLINE" : "OFFLINE",
        }),
      });

      if (!response.ok) throw new Error("Status toggle failed");
      setIsLive(nextState);
      addLog(nextState ? "Terminal is now LIVE and routing prints" : "Terminal offline", "warning");
    } catch (err: any) {
      addLog(err.message || "Failed to toggle status", "error");
    }
  };

  // Fetch job history from server
  const fetchJobHistory = async () => {
    if (!isLoggedIn) return;
    try {
      const response = await fetch(`${serverUrl}/api/agent/jobs?history=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.jobs) {
        setHistoryJobs(data.jobs);
      }
    } catch (err) {
      // Silent catch
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    if (activeQueueTab === "history") {
      fetchJobHistory();
      const historyPoll = setInterval(fetchJobHistory, 10000);
      return () => clearInterval(historyPoll);
    }
  }, [activeQueueTab, isLoggedIn]);

  // Job Polling & Spool loop
  useEffect(() => {
    if (!isLoggedIn) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${serverUrl}/api/agent/jobs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();

        if (response.ok && data.jobs) {
          const fetchedJobs: Job[] = data.jobs;
          setJobQueue(fetchedJobs);

          // Find jobs that need execution (PAID_PENDING) and aren't already processing
          const pendingJobs = fetchedJobs.filter(
            (job) => job.status === "PAID_PENDING" && !processingJobs.current.has(job.id)
          );

          for (const job of pendingJobs) {
            processPrintJob(job);
          }
        }
      } catch (err) {
        // Silent poll error logging once in a while
      }
    }, 4000);

    return () => clearInterval(pollInterval);
  }, [isLoggedIn, serverUrl, token, bwPrinter, colorPrinter]);

  // Execute job spool and print loop
  const processPrintJob = async (job: Job) => {
    processingJobs.current.add(job.id);
    addLog(`Received print job ${job.token} for document: ${job.document.originalName}`, "info");

    try {
      // 1. Update status on server to PENDING (spooling)
      await updateJobStatus(job.id, "PENDING");
      addLog(`Job ${job.token} queued locally.`, "info");

      // 2. Determine target printer
      const printer = job.isColor ? colorPrinter : bwPrinter;
      if (!printer) {
        addLog(`No printer designated for ${job.isColor ? "Color" : "B&W"} prints. Spool aborted.`, "error");
        await updateJobStatus(job.id, "FAILED", `No designated printer for ${job.isColor ? "Color" : "B&W"} output.`);
        processingJobs.current.delete(job.id);
        return;
      }

      // 3. Mark status on server to PRINTING
      await updateJobStatus(job.id, "PRINTING");

      if (isTauri) {
        // Native Tauri spool
        addLog(`Downloading and sending job ${job.token} to native Edge print automation...`, "info");
        const { invoke } = await import("@tauri-apps/api/core");
        const downloadUrl = `${serverUrl}/api/documents/${job.document.id}/download?token=${token}`;
        const result: string = await invoke("print_document", {
          url: downloadUrl,
          filename: job.document.originalName,
          printer: printer,
          copies: job.copies,
          isColor: job.isColor,
          duplex: job.isDuplex,
          pageSize: job.pageSize || "A4",
          orientation: job.orientation || "Portrait",
          price: job.price,
          jobId: job.id,
          jobToken: job.token,
          pages: job.pages || "",
          documentId: job.document.id,
        });
        addLog(`Edge Print Spooler: ${result}`, "info");
      } else {
        // Web simulation spool
        addLog(`[SIMULATION] Spooling ${job.copies} copies to printer "${printer}" (${job.isDuplex ? "Double-sided" : "Single-sided"})...`, "info");
        await new Promise((r) => setTimeout(r, 4000)); // print time
        await updateJobStatus(job.id, "COMPLETED");
        addLog(`Job ${job.token} printed successfully on "${printer}"!`, "success");
        setTodayEarnings((prev) => prev + job.price);
        setJobsCompletedCount((prev) => prev + 1);
        processingJobs.current.delete(job.id);
        fetchJobHistory();
      }
    } catch (err: any) {
      const errMsg = typeof err === "string" ? err : (err.message || "Print job aborted by spooler.");
      addLog(`Job ${job.token} failed: ${errMsg}`, "error");
      await updateJobStatus(job.id, "FAILED", errMsg);
      processingJobs.current.delete(job.id);
      fetchJobHistory();
    } finally {
      if (!isTauri) {
        processingJobs.current.delete(job.id);
        fetchJobHistory();
      }
    }
  };

  const retryPrint = async (job: any) => {
    if (!isTauri) {
      addLog(`[SIMULATION] Retrying print job ${job.token} manually`, "info");
      return;
    }
    try {
      addLog(`Re-initiating print job ${job.token} from local archive...`, "info");
      const printer = job.isColor ? colorPrinter : bwPrinter;
      if (!printer) {
        addLog(`No printer designated for ${job.isColor ? "Color" : "B&W"} prints.`, "error");
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const downloadId = job.documentId || job.id;
      const downloadUrl = `${serverUrl}/api/documents/${downloadId}/download?token=${token}`;
      
      processingJobs.current.add(job.id);
      
      const result: string = await invoke("print_document", {
        url: downloadUrl,
        filename: job.filename,
        printer: printer,
        copies: job.copies,
        isColor: job.isColor,
        duplex: job.isDuplex,
        pageSize: job.pageSize || "A4",
        orientation: job.orientation || "Portrait",
        price: job.price,
        jobId: job.id,
        jobToken: job.token,
        pages: job.pages || "",
        documentId: job.documentId || null,
      });
      addLog(`Manual retry response: ${result}`, "info");
    } catch (err: any) {
      const errMsg = typeof err === "string" ? err : (err.message || "Manual retry failed.");
      addLog(`Manual retry failed: ${errMsg}`, "error");
      processingJobs.current.delete(job.id);
    }
  };

  const openFile = async (filepath: string) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_archived_file", { filepath });
      addLog(`Opened archived file path: ${filepath}`, "info");
    } catch (err: any) {
      addLog(`Failed to open file: ${err.message || err}`, "error");
    }
  };

  const openFolder = async (filepath: string) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_archive_folder", { filepath });
      addLog(`Opened archive directory`, "info");
    } catch (err: any) {
      addLog(`Failed to open archive directory: ${err.message || err}`, "error");
    }
  };

  // Helper to POST status update back to the server
  const updateJobStatus = async (jobId: string, status: string, errorMessage?: string) => {
    try {
      const response = await fetch(`${serverUrl}/api/agent/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId, status, errorMessage }),
      });
      if (!response.ok) {
        addLog(`Failed to update job status on server to ${status}`, "error");
      } else {
        fetchJobHistory();
      }
    } catch (err) {
      addLog(`Failed to communicate job status update: ${status}`, "error");
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setToken("");
    localStorage.removeItem("pf_token");
    addLog("Session logged out", "info");
  };

  if (!isLoggedIn) {
    return (
      <div className="h-screen overflow-hidden flex items-center justify-center bg-slate-900 text-slate-100 p-6 font-sans">
        <div className="w-full max-w-md bg-slate-800/80 border border-slate-700/80 rounded-2xl p-8 shadow-2xl backdrop-blur-md">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-white px-5 py-2.5 rounded-2xl border border-slate-700 shadow-sm mb-4">
              <img src="/RapidDocs logo.png" alt="RapidDocs Logo" className="h-10 w-auto object-contain" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">RapidDocs Terminal Agent</h1>
            <p className="text-xs text-slate-400 mt-2 text-center">
              Connect this local printing machine terminal to the cloud server.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">
                Server URL
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <Server className="w-4 h-4" />
                </span>
                <input
                  type="url"
                  required
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm transition-all"
                  placeholder="http://localhost:3000"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">
                Operator Email
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <Mail className="w-4 h-4" />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm transition-all"
                  placeholder="operator@test.com"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">
                Security Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-medium text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/10 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                "Establish Cloud Link"
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-slate-950 text-slate-100 font-sans flex flex-col justify-between">
      {/* Top Banner for browser preview simulation */}
      {!isTauri && (
        <div className="bg-indigo-600/10 border-b border-indigo-500/20 px-4 py-2 text-center text-xs font-medium text-indigo-400 flex items-center justify-center gap-2">
          <Activity className="w-4 h-4 animate-pulse" />
          Running in Web Browser Preview Mode (Tauri system commands are simulated)
        </div>
      )}

      {/* App Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-700 shadow-sm flex items-center justify-center">
            <img src="/RapidDocs logo.png" alt="RapidDocs Logo" className="h-6 w-auto object-contain" />
          </div>
          <div>
            <h1 className="font-bold text-base text-white tracking-tight">RapidDocs Agent</h1>
            <p className="text-[10px] text-indigo-400 font-medium">
              Terminal: <span className="text-white">{shopName || "Active Operator Node"}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleLiveStatus}
            className={`h-9 px-4 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              isLive
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                : "bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700"
            }`}
          >
            {isLive ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {isLive ? "Online (Live)" : "Offline (Paused)"}
          </button>

          <button
            onClick={handleLogout}
            className="w-9 h-9 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg flex items-center justify-center transition-colors cursor-pointer"
            title="Disconnect Terminal"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        {/* Left Column: Config Panel */}
        <div className="lg:col-span-4 space-y-6 flex flex-col">
          {/* Printer Mappings */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 space-y-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-400" />
              Printer Mapping
            </h2>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-medium pl-1">
                  Black & White Printer
                </label>
                <select
                  value={bwPrinter}
                  onChange={(e) => setBwPrinter(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-200"
                >
                  <option value="">-- Select B&W Printer --</option>
                  {availablePrinters.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {bwPrinter && (
                  <label className="flex items-center gap-2 mt-1.5 px-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={bwDuplex}
                      onChange={(e) => setBwDuplex(e.target.checked)}
                      className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                    />
                    <span className="text-[10px] text-slate-400 font-medium">Supports Double-Sided (Duplex)</span>
                  </label>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-medium pl-1">
                  Color Printer
                </label>
                <select
                  value={colorPrinter}
                  onChange={(e) => setColorPrinter(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-200"
                >
                  <option value="">-- Select Color Printer --</option>
                  {availablePrinters.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {colorPrinter && (
                  <label className="flex items-center gap-2 mt-1.5 px-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={colorDuplex}
                      onChange={(e) => setColorDuplex(e.target.checked)}
                      className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                    />
                    <span className="text-[10px] text-slate-400 font-medium">Supports Double-Sided (Duplex)</span>
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Sync rates */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 space-y-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Coins className="w-4 h-4 text-indigo-400" />
              Rates Sync (per page)
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-medium pl-1">
                  B&W Rate (₹)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={bwRate}
                  onChange={(e) => setBwRate(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-medium pl-1">
                  Color Rate (₹)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={colorRate}
                  onChange={(e) => setColorRate(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
            </div>

            <button
              onClick={handleSyncSettings}
              disabled={isSyncing}
              className="w-full h-10 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 font-semibold text-xs rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              Save & Sync Rates
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between h-24">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Today's Revenue
              </span>
              <span className="text-xl font-bold text-emerald-400">
                ₹{todayEarnings.toFixed(2)}
              </span>
            </div>
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between h-24">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Jobs Printed
              </span>
              <span className="text-xl font-bold text-white">{jobsCompletedCount}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Print queue and logs console */}
        <div className="lg:col-span-8 grid grid-rows-2 gap-6 overflow-hidden">
          {/* Spool Queue */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4 border-b border-slate-900 pb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveQueueTab("active")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeQueueTab === "active"
                      ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Active Queue ({jobQueue.filter(j => ["PENDING", "PRINTING", "PAID_PENDING"].includes(j.status)).length})
                </button>
                <button
                  onClick={() => setActiveQueueTab("history")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeQueueTab === "history"
                      ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Print History
                </button>
                <button
                  onClick={() => setActiveQueueTab("archive")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeQueueTab === "archive"
                      ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Printer className="w-3.5 h-3.5" />
                  Local Job Archive ({archivedJobs.length})
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {activeQueueTab === "active" ? (
                jobQueue.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-8">
                    <Printer className="w-8 h-8 opacity-25 mb-2" />
                    <span className="text-xs">No active print jobs in queue</span>
                  </div>
                ) : (
                  jobQueue.map((job) => (
                    <div
                      key={job.id}
                      className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            job.isColor ? "bg-amber-500/10" : "bg-slate-700/20"
                          }`}
                        >
                          <FileText
                            className={`w-5 h-5 ${
                              job.isColor ? "text-amber-400" : "text-slate-400"
                            }`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-200">
                              {job.document.originalName}
                            </span>
                            <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-medium">
                              {job.token}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1">
                            {job.isColor ? "Color Output" : "Black & White"} • {job.copies} copies
                            • {job.document.pageCount || "?"} pages
                            {job.isDuplex && " • Double Sided"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-slate-300">
                          ₹{job.price.toFixed(2)}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            job.status === "COMPLETED"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : job.status === "PRINTING"
                              ? "bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse"
                              : job.status === "PENDING"
                              ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {job.status}
                        </span>
                      </div>
                    </div>
                  ))
                )
              ) : activeQueueTab === "history" ? (
                historyJobs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-8">
                    <Clock className="w-8 h-8 opacity-25 mb-2" />
                    <span className="text-xs">No completed print jobs in history</span>
                  </div>
                ) : (
                  historyJobs.map((job) => (
                    <div
                      key={job.id}
                      className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            job.isColor ? "bg-amber-500/5" : "bg-slate-700/10"
                          }`}
                        >
                          <FileText
                            className={`w-5 h-5 ${
                              job.isColor ? "text-amber-500/60" : "text-slate-500"
                            }`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-300">
                              {job.document.originalName}
                            </span>
                            <span className="text-[10px] bg-slate-800/80 px-2 py-0.5 rounded text-slate-500 font-medium">
                              {job.token}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">
                            {job.isColor ? "Color Output" : "Black & White"} • {job.copies} copies
                            • {job.document.pageCount || "?"} pages
                            {job.isDuplex && " • Double Sided"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-slate-400">
                          ₹{job.price.toFixed(2)}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            job.status === "COMPLETED"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-red-500/10 text-red-400 border border-red-500/20"
                          }`}
                        >
                          {job.status}
                        </span>
                      </div>
                    </div>
                  ))
                )
              ) : (
                archivedJobs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-8">
                    <Printer className="w-8 h-8 opacity-25 mb-2" />
                    <span className="text-xs">No archived print jobs found (Last 50 are stored here)</span>
                  </div>
                ) : (
                  archivedJobs.map((job) => (
                    <div
                      key={job.id}
                      className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            job.isColor ? "bg-amber-500/10" : "bg-slate-700/20"
                          }`}
                        >
                          <FileText
                            className={`w-5 h-5 ${
                              job.isColor ? "text-amber-400" : "text-slate-400"
                            }`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-200">
                              {job.filename}
                            </span>
                            <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-medium">
                              {job.token}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1">
                            {job.isColor ? "Color" : "B&W"} • {job.copies} copies
                            {job.isDuplex && " • Duplex"} • ₹{job.price.toFixed(2)}
                          </p>
                          <p className="text-[9px] text-slate-500 mt-0.5">
                            Archived: {formatHistoryTimestamp(new Date(parseInt(job.timestamp) * 1000).toISOString())}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded mr-2 ${
                            job.status === "SUCCESS"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : job.status === "PENDING"
                              ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse"
                              : "bg-red-500/10 text-red-400 border border-red-500/20"
                          }`}
                        >
                          {job.status}
                        </span>
                        
                        <button
                          onClick={() => openFile(job.filepath)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-750 text-[10px] font-medium rounded text-slate-300 transition-colors cursor-pointer"
                          title="Open archived PDF/image document"
                        >
                          Open File
                        </button>
                        <button
                          onClick={() => openFolder(job.filepath)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-750 text-[10px] font-medium rounded text-slate-300 transition-colors cursor-pointer"
                          title="Open local folder and select document"
                        >
                          Folder
                        </button>
                        <button
                          onClick={() => retryPrint(job)}
                          className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold rounded text-white transition-colors cursor-pointer"
                          title="Resend print command to printer"
                        >
                          Retry Print
                        </button>
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          {/* Diagnostic Console Log */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3 border-b border-slate-900 pb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveLogTab("active")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeLogTab === "active"
                      ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Active Logs
                </button>
                <button
                  onClick={() => {
                    setActiveLogTab("history");
                    setHistoryLogs(getPrunedHistory());
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeLogTab === "history"
                      ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  History
                </button>
              </div>

              {activeLogTab === "active" ? (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showDetailedLogs}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setShowDetailedLogs(next);
                        localStorage.setItem("pf_show_detailed_logs", String(next));
                      }}
                      className="sr-only peer"
                    />
                    <div className="relative w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white peer-checked:after:border-transparent"></div>
                    <span className="text-[10px] font-semibold text-slate-400 peer-checked:text-indigo-400 transition-colors">
                      Detailed Logs
                    </span>
                  </label>
                  <button
                    onClick={() => setLogs([])}
                    className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors uppercase font-bold tracking-wider cursor-pointer"
                  >
                    Clear Active
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showDetailedLogs}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setShowDetailedLogs(next);
                        localStorage.setItem("pf_show_detailed_logs", String(next));
                      }}
                      className="sr-only peer"
                    />
                    <div className="relative w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white peer-checked:after:border-transparent"></div>
                    <span className="text-[10px] font-semibold text-slate-400 peer-checked:text-indigo-400 transition-colors">
                      Detailed Logs
                    </span>
                  </label>
                  <button
                    onClick={() => {
                      localStorage.removeItem("pf_log_history");
                      setHistoryLogs([]);
                    }}
                    className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors uppercase font-bold tracking-wider cursor-pointer"
                  >
                    Clear History
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 bg-black/40 border border-slate-900 rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-y-auto space-y-1.5 scrollbar-thin">
              {activeLogTab === "active" ? (
                <>
                  {logs.length === 0 ? (
                    <div className="text-slate-500 text-center py-4">No active logs in this session</div>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className="flex gap-2">
                        <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                        <span
                          className={
                            log.type === "success"
                              ? "text-emerald-400"
                              : log.type === "warning"
                              ? "text-amber-400"
                              : log.type === "error"
                              ? "text-rose-400"
                              : "text-slate-300"
                          }
                        >
                          {getDisplayMessage(log.message)}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={consoleEndRef} />
                </>
              ) : (
                <>
                  {historyLogs.length === 0 ? (
                    <div className="text-slate-500 text-center py-4">No history logs found (pruned after 3 days)</div>
                  ) : (
                    historyLogs.map((log, index) => (
                      <div key={index} className="flex gap-2">
                        <span className="text-slate-600 shrink-0">[{formatHistoryTimestamp(log.timestamp)}]</span>
                        <span
                          className={
                            log.type === "success"
                              ? "text-emerald-400"
                              : log.type === "warning"
                              ? "text-amber-400"
                              : log.type === "error"
                              ? "text-rose-400"
                              : "text-slate-300"
                          }
                        >
                          {getDisplayMessage(log.message)}
                        </span>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer bar */}
      <footer className="h-10 border-t border-slate-900 px-6 flex items-center justify-between text-[10px] text-slate-500 bg-slate-950">
        <span>© 2026 RapidDocs Systems. All rights reserved.</span>
        <span>Version 0.1.0</span>
      </footer>
    </div>
  );
}
