import * as vscode from 'vscode';
import { exec, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Helper function to strip ANSI codes and non-ascii from string
function stripAnsi(str: string): string {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

let outputChannel: vscode.OutputChannel;
let previewProcess: ChildProcess | null = null;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('R Pixi Venv');
    context.subscriptions.push(outputChannel);
    
    outputChannel.appendLine('Activating r-pixi-venv extension');

    const disposable = vscode.commands.registerCommand('r-pixi-venv.setup', () => {
        outputChannel.appendLine('Manual setup command triggered.');
        setupPixiEnvironment();
    });

    const installDisposable = vscode.commands.registerCommand('r-pixi-venv.installDependencies', () => {
        outputChannel.appendLine('Install dependencies command triggered.');
        installPixiDependencies();
    });

    const renderDisposable = vscode.commands.registerCommand('r-pixi-venv.renderQuarto', () => {
        outputChannel.appendLine('Render Quarto command triggered.');
        renderQuartoDocument();
    });

    const renderFormatDisposable = vscode.commands.registerCommand('r-pixi-venv.renderQuartoFormat', () => {
        outputChannel.appendLine('Render Quarto (Format) command triggered.');
        renderQuartoDocumentWithFormat();
    });

    const previewDisposable = vscode.commands.registerCommand('r-pixi-venv.previewQuarto', () => {
        outputChannel.appendLine('Preview Quarto command triggered.');
        previewQuartoDocument();
    });

    context.subscriptions.push(disposable, installDisposable, renderDisposable, renderFormatDisposable, previewDisposable);

    // Auto-setup if pixi.toml is found
    setupPixiEnvironment();
}

export function deactivate() {
    if (previewProcess) {
        previewProcess.kill('SIGINT');
        previewProcess = null;
    }
}

async function setupPixiEnvironment() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        outputChannel.appendLine('No workspace folders found.');
        return;
    }

    for (const folder of workspaceFolders) {
        const pixiTomlPath = path.join(folder.uri.fsPath, 'pixi.toml');
        const pyprojectTomlPath = path.join(folder.uri.fsPath, 'pyproject.toml');
        
        outputChannel.appendLine(`Checking for pixi.toml or pyproject.toml at: ${folder.uri.fsPath}`);
        
        if (fs.existsSync(pixiTomlPath) || fs.existsSync(pyprojectTomlPath)) {
            outputChannel.appendLine(`Found Pixi manifest in ${folder.name}`);
            try {
                const pixiInfo = await getPixiInfo(folder.uri.fsPath);
                if (pixiInfo && pixiInfo.environments_info && pixiInfo.environments_info.length > 0) {
                    const defaultEnv = pixiInfo.environments_info.find((e: any) => e.name === 'default') || pixiInfo.environments_info[0];
                    const prefix = defaultEnv.prefix;
                    
                    if (prefix) {
                        outputChannel.appendLine(`Detected Pixi environment prefix: ${prefix}`);
                        
                        // We need a script to properly load all of Pixi's environment variables
                        // (especially ones like QUARTO_SHARE_PATH and others exported in .pixi/envs/default/etc/conda/activate.d)
                        // before running the binary, otherwise Quarto or R might hang or fail.
                        const wrapperPaths = await createWrapperScripts(folder.uri.fsPath, defaultEnv.name, prefix);
                        
                        await configureWorkspaceSettings(folder, wrapperPaths.rPath, wrapperPaths.rTermPath, wrapperPaths.quartoPath);
                        vscode.window.showInformationMessage(`R and Quarto configured to use Pixi environment: ${defaultEnv.name}`);
                    } else {
                        outputChannel.appendLine(`Error: No prefix found for environment ${defaultEnv.name}`);
                    }
                } else {
                    outputChannel.appendLine('Warning: Valid pixi info obtained, but no environments found.');
                }
            } catch (error: any) {
                outputChannel.appendLine(`Failed to setup Pixi environment. Error: ${error.message || error}`);
                if (error.stderr) {
                    outputChannel.appendLine(`Stderr: ${error.stderr}`);
                }
                vscode.window.showErrorMessage('Failed to configure Pixi environment for R and Quarto. Check the "R Pixi Venv" output channel for details.');
            }
        } else {
            outputChannel.appendLine(`No pixi.toml found in ${folder.name}`);
        }
    }
}

async function renderQuartoDocumentWithFormat() {
    const formats = [
        { label: 'html', description: 'HTML Document' },
        { label: 'pdf', description: 'PDF Document (requires LaTeX or Typst)' },
        { label: 'docx', description: 'Word Document' },
        { label: 'typst', description: 'Typst Document (fast PDF generation)' },
        { label: 'revealjs', description: 'Reveal.js Presentation' },
        { label: 'pptx', description: 'PowerPoint Presentation' },
        { label: 'gfm', description: 'GitHub Flavored Markdown' }
    ];

    const selectedFormat = await vscode.window.showQuickPick(formats, {
        placeHolder: 'Select output format for Quarto render',
        title: 'Pixi: Render Quarto Document'
    });

    if (!selectedFormat) {
        return; // User cancelled
    }

    await renderQuartoDocument(selectedFormat.label);
}

async function renderQuartoDocument(format?: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found. Please open a Quarto (.qmd) file.');
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'quarto' && !document.fileName.endsWith('.qmd') && !document.fileName.endsWith('.rmd')) {
        vscode.window.showErrorMessage('The active file is not a Quarto or RMarkdown document.');
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('File is not part of a workspace.');
        return;
    }

    const isWindows = process.platform === 'win32';
    const wrapperExt = isWindows ? '.bat' : '.sh';
    const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
    const quartoWrapperPath = path.join(vscodeDir, `quarto-pixi-wrapper${wrapperExt}`);

    if (!fs.existsSync(quartoWrapperPath)) {
        vscode.window.showErrorMessage('Pixi wrapper for Quarto not found. Please run "Setup R and Quarto from Pixi" first.');
        return;
    }

    const formatDisplay = format ? ` to ${format}` : '';
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Rendering ${path.basename(document.fileName)}${formatDisplay} via Pixi...`,
        cancellable: false
    }, async (progress) => {
        return new Promise<void>((resolve, reject) => {
            const formatArg = format ? ` --to ${format}` : '';
            const command = `"${quartoWrapperPath}" render "${document.fileName}"${formatArg}`;
            outputChannel.appendLine(`Executing: ${command}`);
            outputChannel.show(true);

            const cwd = path.dirname(document.fileName);

            const cp = exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    outputChannel.appendLine(`Render error: ${error.message}`);
                    vscode.window.showErrorMessage(`Failed to render Quarto document${formatDisplay}. Check the "R Pixi Venv" output channel.`);
                    reject(error);
                } else {
                    vscode.window.showInformationMessage(`Quarto document rendered${formatDisplay} successfully!`);
                    resolve();
                }
            });

            if (cp.stdout) {
                cp.stdout.on('data', (data) => {
                    const str = data.toString();
                    outputChannel.append(stripAnsi(str));
                });
            }
            if (cp.stderr) {
                cp.stderr.on('data', (data) => {
                    const str = data.toString();
                    // Some quarto outputs have weird unicode characters like â”€
                    const cleanedStr = stripAnsi(str).replace(/[^\x00-\x7F]/g, " ");
                    outputChannel.append(cleanedStr);
                });
            }
        });
    });
}

async function previewQuartoDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found. Please open a Quarto (.qmd) file.');
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'quarto' && !document.fileName.endsWith('.qmd') && !document.fileName.endsWith('.rmd')) {
        vscode.window.showErrorMessage('The active file is not a Quarto or RMarkdown document.');
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('File is not part of a workspace.');
        return;
    }

    const isWindows = process.platform === 'win32';
    const wrapperExt = isWindows ? '.bat' : '.sh';
    const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
    const quartoWrapperPath = path.join(vscodeDir, `quarto-pixi-wrapper${wrapperExt}`);

    if (!fs.existsSync(quartoWrapperPath)) {
        vscode.window.showErrorMessage('Pixi wrapper for Quarto not found. Please run "Setup R and Quarto from Pixi" first.');
        return;
    }

    if (previewProcess) {
        outputChannel.appendLine('Killing existing preview process...');
        previewProcess.kill('SIGINT');
        previewProcess = null;
    }

    const args = ['preview', document.fileName, '--no-browser'];
    const cwd = path.dirname(document.fileName);

    outputChannel.appendLine(`Starting Preview: "${quartoWrapperPath}" ${args.join(' ')}`);
    outputChannel.show(true);

    previewProcess = spawn(`"${quartoWrapperPath}"`, args, {
        cwd,
        shell: true
    });

    let browserOpened = false;

    const handleOutput = (data: any) => {
        const str = data.toString();
        const cleanedStr = stripAnsi(str).replace(/[^\x00-\x7F]/g, " ");
        outputChannel.append(cleanedStr);

        // Look for the URL like http://localhost:xxxx
        if (!browserOpened) {
            const match = cleanedStr.match(/http:\/\/(localhost|127\.0\.0\.1):\d+/);
            if (match) {
                browserOpened = true;
                outputChannel.appendLine(`\n[Detected local server: ${match[0]}, opening inside VS Code...]\n`);
                // Use simpleBrowser.api.open which takes a URI and options
                vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(match[0]), {
                    viewColumn: vscode.ViewColumn.Beside,
                    preserveFocus: true
                });
            }
        }
    };

    if (previewProcess.stdout) {
        previewProcess.stdout.on('data', handleOutput);
    }
    if (previewProcess.stderr) {
        previewProcess.stderr.on('data', handleOutput);
    }

    previewProcess.on('close', (code) => {
        outputChannel.appendLine(`\n[Preview process exited with code ${code}]\n`);
        if (previewProcess) {
            previewProcess = null;
        }
    });

    previewProcess.on('error', (err) => {
        outputChannel.appendLine(`\n[Preview process error: ${err.message}]\n`);
    });
}

async function installPixiDependencies() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folders found.');
        return;
    }

    for (const folder of workspaceFolders) {
        const pixiTomlPath = path.join(folder.uri.fsPath, 'pixi.toml');
        const pyprojectTomlPath = path.join(folder.uri.fsPath, 'pyproject.toml');

        if (fs.existsSync(pixiTomlPath) || fs.existsSync(pyprojectTomlPath)) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing R and Quarto via Pixi in ${folder.name}...`,
                cancellable: false
            }, async (progress) => {
                return new Promise<void>((resolve, reject) => {
                    outputChannel.appendLine(`Executing 'pixi add r-base r-languageserver quarto -c conda-forge' in ${folder.uri.fsPath}`);
                    const cp = exec('pixi add r-base r-languageserver quarto -c conda-forge', { cwd: folder.uri.fsPath, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                        if (error) {
                            outputChannel.appendLine(`Install error: ${error.message}`);
                            outputChannel.appendLine(`Stderr: ${stderr}`);
                            vscode.window.showErrorMessage('Failed to install R and Quarto via Pixi. Check the "R Pixi Venv" output channel.');
                            reject(error);
                        } else {
                            outputChannel.appendLine(`Install output: ${stdout}`);
                            vscode.window.showInformationMessage('Successfully installed R and Quarto via Pixi.');
                            setupPixiEnvironment();
                            resolve();
                        }
                    });
                    
            if (cp.stdout) {
                cp.stdout.on('data', (data) => {
                    const str = data.toString();
                    outputChannel.append(stripAnsi(str));
                });
            }
            if (cp.stderr) {
                cp.stderr.on('data', (data) => {
                    const str = data.toString();
                    // Some quarto outputs have weird unicode characters like â”€
                    const cleanedStr = stripAnsi(str).replace(/[^\x00-\x7F]/g, " ");
                    outputChannel.append(cleanedStr);
                });
            }
                });
            });
        } else {
            vscode.window.showWarningMessage('No pixi.toml or pyproject.toml found in the workspace.');
        }
    }
}

async function createWrapperScripts(workspacePath: string, envName: string, prefix: string): Promise<{rPath: string, rTermPath: string, quartoPath: string}> {
    const isWindows = process.platform === 'win32';
    const vscodeDir = path.join(workspacePath, '.vscode');
    
    // Ensure .vscode directory exists
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }

    const wrapperExt = isWindows ? '.bat' : '.sh';
    const rWrapperPath = path.join(vscodeDir, `r-pixi-wrapper${wrapperExt}`);
    const rTermWrapperPath = path.join(vscodeDir, `rterm-pixi-wrapper${wrapperExt}`);
    const quartoWrapperPath = path.join(vscodeDir, `quarto-pixi-wrapper${wrapperExt}`);

    const pixiTomlPath = path.join(workspacePath, 'pixi.toml');

    let rScriptContent = '';
    let quartoScriptContent = '';

    if (isWindows) {
        // Windows batch script to run via pixi
        const baseContent = `@echo off\npixi run --manifest-path "${pixiTomlPath}" -e ${envName}`;
        rScriptContent = `${baseContent} R %*`;
        quartoScriptContent = `${baseContent} quarto %*`;
    } else {
        // Shell script to run via pixi
        const baseContent = `#!/bin/sh\nexec pixi run --manifest-path "${pixiTomlPath}" -e ${envName}`;
        rScriptContent = `${baseContent} R "$@"`;
        quartoScriptContent = `${baseContent} quarto "$@"`;
    }

    // Write the files
    fs.writeFileSync(rWrapperPath, rScriptContent);
    fs.writeFileSync(rTermWrapperPath, rScriptContent); // Typically the same for our wrapper
    fs.writeFileSync(quartoWrapperPath, quartoScriptContent);

    // Make executable on Unix-like systems
    if (!isWindows) {
        fs.chmodSync(rWrapperPath, 0o755);
        fs.chmodSync(rTermWrapperPath, 0o755);
        fs.chmodSync(quartoWrapperPath, 0o755);
    }

    outputChannel.appendLine(`Created wrapper scripts in ${vscodeDir}`);

    return {
        rPath: rWrapperPath,
        rTermPath: rTermWrapperPath,
        quartoPath: quartoWrapperPath
    };
}

function getPixiInfo(workspacePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
        outputChannel.appendLine(`Executing 'pixi info --json' in ${workspacePath}`);
        exec('pixi info --json', { cwd: workspacePath }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`Command execution error: ${error.message}`);
                reject({ ...error, stderr });
                return;
            }
            try {
                const info = JSON.parse(stdout);
                resolve(info);
            } catch (parseError) {
                outputChannel.appendLine(`Failed to parse pixi info JSON. Stdout: ${stdout}`);
                reject(parseError);
            }
        });
    });
}

async function configureWorkspaceSettings(folder: vscode.WorkspaceFolder, rPath: string, rTermPath: string, quartoPath: string) {
    const isWindows = process.platform === 'win32';
    outputChannel.appendLine(`Configuring settings for platform: ${process.platform}`);
    
    outputChannel.appendLine(`Calculated R Path: ${rPath}`);
    outputChannel.appendLine(`Calculated Quarto Path: ${quartoPath}`);

    const rConfig = vscode.workspace.getConfiguration('r', folder.uri);
    const quartoConfig = vscode.workspace.getConfiguration('quarto', folder.uri);
    
    // Configure R paths
    try {
        if (isWindows) {
            await rConfig.update('rpath.windows', rPath, vscode.ConfigurationTarget.Workspace);
            await rConfig.update('rterm.windows', rTermPath, vscode.ConfigurationTarget.Workspace);
            outputChannel.appendLine('Updated Windows R paths.');
        } else if (process.platform === 'darwin') {
            await rConfig.update('rpath.mac', rPath, vscode.ConfigurationTarget.Workspace);
            await rConfig.update('rterm.mac', rTermPath, vscode.ConfigurationTarget.Workspace);
            outputChannel.appendLine('Updated macOS R paths.');
        } else {
            await rConfig.update('rpath.linux', rPath, vscode.ConfigurationTarget.Workspace);
            await rConfig.update('rterm.linux', rTermPath, vscode.ConfigurationTarget.Workspace);
            outputChannel.appendLine('Updated Linux R paths.');
        }

        // Configure Quarto path
        await quartoConfig.update('path', quartoPath, vscode.ConfigurationTarget.Workspace);
        outputChannel.appendLine('Updated Quarto path.');
        outputChannel.appendLine('Successfully applied settings to .vscode/settings.json.');
    } catch (err: any) {
        outputChannel.appendLine(`Error updating workspace configuration: ${err.message}`);
    }
}
