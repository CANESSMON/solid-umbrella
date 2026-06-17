use std::process::Command;
use std::fs;
use tauri::Manager;

// Discover all local system printers via PowerShell on Windows or fallback on other platforms
#[tauri::command]
fn get_printers() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(&["-Command", "Get-Printer | Select-Object -ExpandProperty Name"])
            .output();
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            return stdout
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }
    // Fallback list for dev mode/non-windows
    vec![
        "HP LaserJet Pro M402 (B&W)".to_string(),
        "Epson L3110 Series (Color)".to_string(),
        "Microsoft Print to PDF".to_string(),
    ]
}



use tauri::Emitter;
use std::thread;
use std::time::Duration;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ArchivedJob {
    id: String,
    token: String,
    filename: String,
    filepath: String,
    #[serde(rename = "isColor")]
    is_color: bool,
    #[serde(rename = "isDuplex")]
    is_duplex: bool,
    copies: i32,
    #[serde(rename = "pageSize")]
    page_size: String,
    orientation: String,
    price: f64,
    timestamp: String,
    status: String,
    pages: String,
    #[serde(rename = "documentId", default)]
    document_id: Option<String>,
}

// Update the status of a job in the local JSON database
fn update_archive_job_status(handle: &tauri::AppHandle, token: &str, status: &str) -> Result<(), String> {
    let app_dir = handle.path().app_config_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("jobs_archive").join("jobs_archive.json");
    if db_path.exists() {
        let content = fs::read_to_string(&db_path).map_err(|e| e.to_string())?;
        let mut jobs: Vec<ArchivedJob> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        for job in &mut jobs {
            if job.token == token {
                job.status = status.to_string();
                break;
            }
        }
        let db_content = serde_json::to_string_pretty(&jobs).map_err(|e| e.to_string())?;
        fs::write(db_path, db_content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Executes print commands via Microsoft Edge kiosk automation, downloads to archive, and monitors print spooler queue
#[tauri::command]
fn print_document(
    handle: tauri::AppHandle,
    url: String,
    filename: String,
    printer: String,
    copies: i32,
    is_color: bool,
    duplex: bool,
    page_size: String,
    orientation: String,
    price: f64,
    job_id: String,
    job_token: String,
    pages: String,
    document_id: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // 1. Resolve local persistent archive path
        let app_dir = handle.path().app_config_dir().map_err(|e| e.to_string())?;
        let archive_dir = app_dir.join("jobs_archive");
        fs::create_dir_all(&archive_dir).map_err(|e| e.to_string())?;

        // Format unique filename for local storage (includes token in name so page title matches for monitoring)
        let safe_name = format!("{}_{}", job_token, filename.replace(" ", "_"));
        let filepath = archive_dir.join(&safe_name);
        let filepath_str = filepath.to_string_lossy().to_string();

        // 2. Download file using curl.exe if not already cached
        if !filepath.exists() {
            let download_output = Command::new("curl.exe")
                .args(&["-L", "-o", &filepath_str, &url])
                .output();
            
            if let Ok(out) = download_output {
                if !out.status.success() {
                    return Err(format!("Download failed: {}", String::from_utf8_lossy(&out.stderr)));
                }
            } else {
                return Err("Failed to execute curl download command".to_string());
            }
        }

        // 3. Register the print job in the local rolling archive JSON
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string();
        let new_job = ArchivedJob {
            id: job_id.clone(),
            token: job_token.clone(),
            filename: filename.clone(),
            filepath: filepath_str.clone(),
            is_color,
            is_duplex: duplex,
            copies,
            page_size: page_size.clone(),
            orientation: orientation.clone(),
            price,
            timestamp,
            status: "PENDING".to_string(),
            pages: pages.clone(),
            document_id: document_id.clone(),
        };

        let db_path = archive_dir.join("jobs_archive.json");
        let mut jobs: Vec<ArchivedJob> = if db_path.exists() {
            let content = fs::read_to_string(&db_path).map_err(|e| e.to_string())?;
            serde_json::from_str(&content).unwrap_or_else(|_| vec![])
        } else {
            vec![]
        };

        // Insert at the front (rolling archive)
        jobs.insert(0, new_job);

        // Keep last 50 jobs, prune older files
        if jobs.len() > 50 {
            let older_jobs = jobs.split_off(50);
            for old_job in older_jobs {
                let path = std::path::Path::new(&old_job.filepath);
                if path.exists() {
                    let _ = fs::remove_file(path);
                }
            }
        }

        let db_content = serde_json::to_string_pretty(&jobs).map_err(|e| e.to_string())?;
        fs::write(&db_path, db_content).map_err(|e| e.to_string())?;

        // 4. Spawn Playwright Automation & Queue Monitoring thread
        let handle_clone = handle.clone();
        let printer_clone = printer.clone();
        let job_id_clone = job_id.clone();
        let job_token_clone = job_token.clone();
        let filepath_str_clone = filepath_str.clone();
        let orientation_clone = orientation.clone();
        let pages_clone = pages.clone();

        thread::spawn(move || {
            let mut spool_success = false;
            let mut err_msg = "Unknown spool failure".to_string();

            // 1. Locate SumatraPDF
            let mut sumatra = None;
            if let Ok(output) = Command::new("where").arg("SumatraPDF").output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let path = first_line.trim();
                    if !path.is_empty() && std::path::Path::new(path).exists() {
                        sumatra = Some(path.to_string());
                    }
                }
            }
            if sumatra.is_none() {
                let common_paths = vec![
                    r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
                    r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
                ];
                for path in common_paths {
                    if std::path::Path::new(path).exists() {
                        sumatra = Some(path.to_string());
                        break;
                    }
                }
            }
            if sumatra.is_none() {
                if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                    let path = format!(r"{}\SumatraPDF\SumatraPDF.exe", local_app_data);
                    if std::path::Path::new(&path).exists() {
                        sumatra = Some(path);
                    }
                }
            }

            if let Some(sumatra_path) = sumatra {
                // 2. Determine file extension and handle conversion
                let filepath_path = std::path::Path::new(&filepath_str_clone);
                let ext = filepath_path.extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let mut final_print_path = filepath_str_clone.clone();
                let mut conversion_ok = true;

                if ext == "docx" || ext == "doc" {
                    // Search for LibreOffice
                    let mut libreoffice = None;
                    if let Ok(output) = Command::new("where").arg("soffice").output() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        if let Some(first_line) = stdout.lines().next() {
                            let path = first_line.trim();
                            if !path.is_empty() && std::path::Path::new(path).exists() {
                                libreoffice = Some(path.to_string());
                            }
                        }
                    }
                    if libreoffice.is_none() {
                        let common_paths = vec![
                            r"C:\Program Files\LibreOffice\program\soffice.exe",
                            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
                        ];
                        for path in common_paths {
                            if std::path::Path::new(path).exists() {
                                libreoffice = Some(path.to_string());
                                break;
                            }
                        }
                    }

                    if let Some(soffice_path) = libreoffice {
                        let app_dir = handle_clone.path().app_config_dir().unwrap_or_default();
                        let archive_dir = app_dir.join("jobs_archive");
                        let archive_dir_str = archive_dir.to_string_lossy().to_string();

                        let convert_output = Command::new(&soffice_path)
                            .args(&[
                                "--headless",
                                "--convert-to",
                                "pdf",
                                "--outdir",
                                &archive_dir_str,
                                &filepath_str_clone,
                            ])
                            .output();

                        match convert_output {
                            Ok(out) => {
                                if out.status.success() {
                                    let file_stem = filepath_path.file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("");
                                    let pdf_file = filepath_path.parent()
                                        .unwrap()
                                        .join(format!("{}.pdf", file_stem));

                                    if pdf_file.exists() {
                                        final_print_path = pdf_file.to_string_lossy().to_string();
                                    } else {
                                        conversion_ok = false;
                                        err_msg = "Converted PDF was not found in directory".to_string();
                                    }
                                } else {
                                    conversion_ok = false;
                                    err_msg = format!("LibreOffice conversion failed: {}", String::from_utf8_lossy(&out.stderr));
                                }
                            }
                            Err(e) => {
                                conversion_ok = false;
                                err_msg = format!("Failed to execute LibreOffice: {}", e);
                            }
                        }
                    } else {
                        conversion_ok = false;
                        err_msg = "LibreOffice is required to print Word files. Please install LibreOffice.".to_string();
                    }
                }

                if conversion_ok {
                    // 3. Build SumatraPDF print settings
                    let mut print_settings = Vec::new();
                    if copies > 1 {
                        print_settings.push(format!("{}x", copies));
                    }
                    if !pages_clone.is_empty() {
                        print_settings.push(pages_clone.clone());
                    }
                    if orientation_clone.to_lowercase() == "landscape" {
                        print_settings.push("landscape".to_string());
                    } else {
                        print_settings.push("portrait".to_string());
                    }
                    if duplex {
                        print_settings.push("duplexlong".to_string());
                    } else {
                        print_settings.push("simplex".to_string());
                    }
                    print_settings.push("fit".to_string());

                    let settings_str = print_settings.join(",");

                    // 4. Run SumatraPDF
                    let output = Command::new(&sumatra_path)
                        .args(&[
                            "-silent",
                            "-exit-when-done",
                            "-print-to", &printer_clone,
                            "-print-settings", &settings_str,
                            &final_print_path,
                        ])
                        .output();

                    match output {
                        Ok(out) => {
                            if out.status.success() {
                                spool_success = true;
                            } else {
                                err_msg = format!("SumatraPDF Print Failed: {}", String::from_utf8_lossy(&out.stderr));
                            }
                        }
                        Err(e) => {
                            err_msg = format!("Failed to execute SumatraPDF: {}", e);
                        }
                    }
                }
            } else {
                err_msg = "SumatraPDF is required for silent printing. Install it from https://www.sumatrapdfreader.org/".to_string();
            }

            if spool_success {
                // Emit printing event
                let _ = handle_clone.emit("print-status", serde_json::json!({
                    "jobId": job_id_clone,
                    "status": "PRINTING",
                    "message": "Document spooled successfully. Printing pages..."
                }));

                // Monitor active queue until completed or failed
                let mut completed = false;
                let mut error_occurred = false;
                let mut queue_err_msg = String::new();

                let mut last_message = String::new();

                for _ in 0..60 {
                    thread::sleep(Duration::from_secs(1));
                    
                    let monitor_script = format!(
                        r#"
                        $job = Get-PrintJob -PrinterName '{printer}' -ErrorAction SilentlyContinue | Where-Object {{ $_.DocumentName -like '*{job_token}*' }}
                        if ($null -eq $job) {{
                            "NOT_FOUND"
                        }} else {{
                            "$($job.JobStatus)|$($job.PagesPrinted)|$($job.TotalPages)"
                        }}
                        "#,
                        printer = printer_clone,
                        job_token = job_token_clone
                    );

                    let check_output = Command::new("powershell")
                        .args(&["-Command", &monitor_script])
                        .output();

                    if let Ok(out) = check_output {
                        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        if stdout.contains("NOT_FOUND") {
                            completed = true;
                            break;
                        } else {
                            let parts: Vec<&str> = stdout.split('|').collect();
                            if parts.len() >= 3 {
                                let status = parts[0];
                                let printed = parts[1];
                                let total = parts[2];
                                
                                let current_message = format!("Printing page {} of {} (Status: {})", printed, total, status);
                                if current_message != last_message {
                                    let _ = handle_clone.emit("print-status", serde_json::json!({
                                        "jobId": job_id_clone,
                                        "status": "PRINTING",
                                        "message": current_message.clone()
                                    }));
                                    last_message = current_message;
                                }

                                if status.contains("Error") || status.contains("Offline") || status.contains("PaperOut") {
                                    error_occurred = true;
                                    queue_err_msg = format!("Printer error status: {}", status);
                                    break;
                                }
                            }
                        }
                    }
                }

                if completed && !error_occurred {
                    let _ = update_archive_job_status(&handle_clone, &job_token_clone, "SUCCESS");
                    let _ = handle_clone.emit("print-status", serde_json::json!({
                        "jobId": job_id_clone,
                        "status": "COMPLETED",
                        "message": "Printed completed successfully."
                    }));
                } else {
                    let final_err = if error_occurred { queue_err_msg } else { "Printing timed out in spooler queue.".to_string() };
                    let _ = update_archive_job_status(&handle_clone, &job_token_clone, "FAILED");
                    let _ = handle_clone.emit("print-status", serde_json::json!({
                        "jobId": job_id_clone,
                        "status": "FAILED",
                        "message": final_err
                    }));
                }
            } else {
                let _ = update_archive_job_status(&handle_clone, &job_token_clone, "FAILED");
                let _ = handle_clone.emit("print-status", serde_json::json!({
                    "jobId": job_id_clone,
                    "status": "FAILED",
                    "message": err_msg
                }));
            }
        });

        Ok("Print spool initiated via SumatraPDF".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    Ok("Simulation: Print spool initiated".to_string())
}

// Retrieves all archived jobs from the local JSON store
#[tauri::command]
fn get_archived_jobs(handle: tauri::AppHandle) -> Result<Vec<ArchivedJob>, String> {
    let app_dir = handle.path().app_config_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("jobs_archive").join("jobs_archive.json");
    if !db_path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&db_path).map_err(|e| e.to_string())?;
    let jobs: Vec<ArchivedJob> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(jobs)
}

// Opens the archived document file using system default program
#[tauri::command]
fn open_archived_file(filepath: String) -> Result<(), String> {
    let path = std::path::Path::new(&filepath);
    if !path.exists() {
        return Err("File does not exist in local archive folder.".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/c", "start", "", &filepath])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Opens the local archive folder in Windows Explorer and highlights the file
#[tauri::command]
fn open_archive_folder(handle: tauri::AppHandle, filepath: String) -> Result<(), String> {
    let path = std::path::Path::new(&filepath);
    if !path.exists() {
        let app_dir = handle.path().app_config_dir().map_err(|e| e.to_string())?;
        let archive_dir = app_dir.join("jobs_archive");
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer.exe")
                .arg(archive_dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,\"{}\"", filepath))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Persists local app configuration securely in user config folder
#[tauri::command]
fn save_config(handle: tauri::AppHandle, token: String, settings: String) -> Result<(), String> {
    let config_dir = handle.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let path = config_dir.join("config.json");
    let data = serde_json::json!({
        "token": token,
        "settings": settings
    });
    fs::write(
        path,
        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// Loads local app configuration
#[tauri::command]
fn load_config(handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let config_dir = handle.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = config_dir.join("config.json");
    if !path.exists() {
        return Ok(serde_json::json!({ "token": "", "settings": "" }));
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_printers,
            print_document,
            save_config,
            load_config,
            get_archived_jobs,
            open_archived_file,
            open_archive_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
