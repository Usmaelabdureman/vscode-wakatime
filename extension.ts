// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import fs = require('fs');
import os = require('os');
import path = require('path');
import child_process = require('child_process');

var AdmZip = require('adm-zip');
var ini = require('ini');
var request = require('request');
var rimraf = require('rimraf');


var logger:Logger;
var options:Options;


// this method is called when your extension is activated. activation is
// controlled by the activation events defined in package.json
export function activate(ctx: vscode.ExtensionContext) {
    options = new Options();
    logger = new Logger('info');
    options.getSetting('settings', 'debug', function(error, debug) {
        if (debug && debug.trim() === 'true')
            logger.setLevel('debug');

        // initialize WakaTime
        let wakatime = new WakaTime();

        ctx.subscriptions.push(vscode.commands.registerCommand('wakatime.apikey', function (args) {
            wakatime.promptForApiKey();
        }));

        ctx.subscriptions.push(vscode.commands.registerCommand('wakatime.proxy', function (args) {
            wakatime.promptForProxy();
        }));

        ctx.subscriptions.push(vscode.commands.registerCommand('wakatime.debug', function (args) {
            wakatime.promptForDebug();
        }));

        ctx.subscriptions.push(vscode.commands.registerCommand('wakatime.status_bar_icon', function (args) {
            wakatime.promptStatusBarIcon();
        }));

        ctx.subscriptions.push(vscode.commands.registerCommand('wakatime.dashboard', function (args) {
            wakatime.openDashboardWebsite();
        }));

        // add to a list of disposables which are disposed when this extension
        // is deactivated again.
        ctx.subscriptions.push(wakatime);

    });
}


export class WakaTime {

    private extension = vscode.extensions.getExtension("WakaTime.vscode-wakatime").packageJSON;
    private statusBar:vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    private disposable:vscode.Disposable;
    private lastFile:string;
    private lastHeartbeat:number = 0;
    private dependencies:Dependencies;
    private options:Options = new Options();

    constructor() {
        logger.debug('Initializing WakaTime v' + this.extension.version);
        this.statusBar.text = '$(clock) WakaTime Initializing...';
        this.statusBar.show();

        this._checkApiKey();

        this.dependencies = new Dependencies(this.options);
        this.dependencies.checkAndInstall(function() {
            this.statusBar.text = '$(clock) WakaTime Initialized';
            this.options.getSetting('settings', 'status_bar_icon', function(err, val) {
                if (val && val.trim() !== 'false')
                    this.statusBar.hide();
                else
                    this.statusBar.show();
            }.bind(this));
        }.bind(this));

        this._setupEventListeners();
    }

    public promptForApiKey(): void {
        this.options.getSetting('settings', 'api_key', function(err, defaultVal) {
            if (this.validateKey(defaultVal) != null)
                defaultVal = '';
            let promptOptions = {
                prompt: 'WakaTime API Key',
                placeHolder: 'Enter your api key from wakatime.com/settings',
                value: defaultVal,
                ignoreFocusOut: true,
                validateInput: this.validateKey.bind(this),
            };
            vscode.window.showInputBox(promptOptions).then(function(val) {
                if (this.validateKey(val) == null)
                    this.options.setSetting('settings', 'api_key', val);
            }.bind(this));
        }.bind(this));
    }

    private validateKey(key:string): string {
        const err = 'Invalid api key... check https://wakatime.com/settings for your key.';
        if (!key) return err;
        const re = new RegExp('^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$', 'i');
        if (!re.test(key))
            return err;
        return null;
    }

    public promptForProxy(): void {
        this.options.getSetting('settings', 'proxy', function(err, defaultVal) {
            if (!defaultVal)
                defaultVal = '';
            let promptOptions = {
                prompt: 'WakaTime Proxy',
                placeHolder: 'Proxy format is https://user:pass@host:port',
                value: defaultVal,
                ignoreFocusOut: true,
                validateInput: this.validateProxy.bind(this),
            };
            vscode.window.showInputBox(promptOptions).then(function(val) {
                if (val || val === '')
                    this.options.setSetting('settings', 'proxy', val);
            }.bind(this));
        }.bind(this));
    }

    private validateProxy(proxy:string): string {
        const err = 'Invalid proxy. Valid formats are https://user:pass@host:port or socks5://user:pass@host:port or domain\\user:pass.';
        if (!proxy) return err;
        let re = new RegExp('^((https?|socks5)://)?([^:@]+(:([^:@])+)?@)?[\\w\\.-]+(:\\d+)?$', 'i');
        if (proxy.indexOf('\\') > -1)
            re = new RegExp('^.*\\\\.+$', 'i');
        if (!re.test(proxy))
            return err;
        return null;
    }

    public promptForDebug(): void {
        this.options.getSetting('settings', 'debug', function(err, defaultVal) {
            if (!defaultVal || defaultVal.trim() !== 'true')
                defaultVal = 'false';
            let items:string[] = ['true', 'false'];
            let promptOptions = {
                placeHolder: 'true or false (Currently ' + defaultVal + ')',
                value: defaultVal,
                ignoreFocusOut: true,
            };
            vscode.window.showQuickPick(items, promptOptions).then(function(newVal) {
                if (newVal == null)
                    return;
                this.options.setSetting('settings', 'debug', newVal);
                if (newVal === 'true') {
                    logger.setLevel('debug');
                    logger.debug('Debug enabled');
                } else {
                    logger.setLevel('info');
                }
            }.bind(this));
        }.bind(this));
    }

    public promptStatusBarIcon(): void {
        this.options.getSetting('settings', 'status_bar_icon', function(err, defaultVal) {
            if (!defaultVal || defaultVal.trim() !== 'false')
                defaultVal = 'true';
            let items:string[] = ['true', 'false'];
            let promptOptions = {
                placeHolder: 'true or false (Currently ' + defaultVal + ')',
                value: defaultVal,
                ignoreFocusOut: true,
            };
            vscode.window.showQuickPick(items, promptOptions).then(function(newVal) {
                if (newVal == null)
                    return;
                this.options.setSetting('settings', 'status_bar_icon', newVal);
                if (newVal === 'true') {
                    this.statusBar.show();
                    logger.debug('Status bar icon enabled');
                } else {
                    this.statusBar.hide();
                    logger.debug('Status bar icon disabled');
                }
            }.bind(this));
        }.bind(this));
    }

    public openDashboardWebsite(): void {
        var open = 'xdg-open';
        if (Dependencies.isWindows()) {
            open = 'start';
        } else if (os.type() == 'Darwin') {
            open = 'open';
        }
        let args = ['https://wakatime.com/'];
        let process = child_process.execFile(open, args, function(error, stdout, stderr) {
            if (error != null) {
                if (stderr && stderr.toString() != '')
                    logger.error(stderr);
                if (stdout && stdout.toString() != '')
                    logger.error(stdout);
                logger.error(error);
            }
        }.bind(this));
    }

    private _checkApiKey() {
        this.hasApiKey(function(hasApiKey) {
            if (!hasApiKey) this.promptForApiKey();
        }.bind(this));
    }

    private hasApiKey(callback) {
        this.options.getSetting('settings', 'api_key', function(error, apiKey) {
            callback(this.validateKey(apiKey) == null);
        }.bind(this));
    }

    private _setupEventListeners(): void {
        // subscribe to selection change and editor activation events
        let subscriptions: vscode.Disposable[] = [];
        vscode.window.onDidChangeTextEditorSelection(this._onChange, this, subscriptions);
        vscode.window.onDidChangeActiveTextEditor(this._onChange, this, subscriptions);
        vscode.workspace.onDidSaveTextDocument(this._onSave, this, subscriptions);

        // create a combined disposable from both event subscriptions
        this.disposable = vscode.Disposable.from(...subscriptions);
    }

    private _onChange() {
        this._onEvent(false);
    }

    private _onSave() {
        this._onEvent(true);
    }

    private _onEvent(isWrite) {
        let editor = vscode.window.activeTextEditor;
        if (editor) {
            let doc = editor.document;
            if (doc) {
                let file = doc.fileName;
                if (file) {
                    let time = Date.now();
                    if (isWrite || this._enoughTimePassed(time) || this.lastFile !== file) {
                        this._sendHeartbeat(file, isWrite);
                        this.lastFile = file;
                        this.lastHeartbeat = time;
                    }
                }
            }
        }
    }

    private _sendHeartbeat(file, isWrite) {
        this.hasApiKey(function(hasApiKey) {
            if (hasApiKey) {
                this.dependencies.getPythonLocation(function(pythonBinary) {
                    if (pythonBinary) {

                        let core = this.dependencies.getCoreLocation();
                        let user_agent = 'vscode/' + vscode.version + ' vscode-wakatime/' + this.extension.version;
                        let args = [core, '--file', file, '--plugin', user_agent];
                        let project = this._getProjectName();
                        if (project)
                            args.push('--alternate-project', project);
                        if (isWrite)
                            args.push('--write');
                        if (Dependencies.isWindows())
                            args.push('--config', this.options.getConfigFile());

                        logger.debug('Sending heartbeat: ' + this.formatArguments(pythonBinary, args));

                        let process = child_process.execFile(pythonBinary, args, function(error, stdout, stderr) {
                            if (error != null) {
                                if (stderr && stderr.toString() != '')
                                    logger.error(stderr);
                                if (stdout && stdout.toString() != '')
                                    logger.error(stdout);
                                logger.error(error);
                            }
                        }.bind(this));
                        process.on('close', function(code, signal) {
                            if (code == 0) {
                                this.statusBar.text = '$(clock) WakaTime Active';
                                let today = new Date();
                                this.statusBar.tooltip = 'Last heartbeat sent at ' + this.formatDate(today);
                            } else if (code == 102) {
                                this.statusBar.text = '$(clock) WakaTime Offline, coding activity will sync when online.';
                                logger.warn('API Error (102); Check your ~/.wakatime.log file for more details.');
                            } else if (code == 103) {
                                this.statusBar.text = '$(clock) WakaTime Error';
                                let error_msg = 'Config Parsing Error (103); Check your ~/.wakatime.log file for more details.';
                                this.statusBar.tooltip = error_msg;
                                logger.error(error_msg);
                            } else if (code == 104) {
                                this.statusBar.text = '$(clock) WakaTime Error';
                                let error_msg = 'Invalid API Key (104); Make sure your API Key is correct!';
                                this.statusBar.tooltip = error_msg;
                                logger.error(error_msg);
                            } else {
                                this.statusBar.text = '$(clock) WakaTime Error';
                                let error_msg = 'Unknown Error (' + code + '); Check your ~/.wakatime.log file for more details.';
                                this.statusBar.tooltip = error_msg;
                                logger.error(error_msg);
                            }
                        }.bind(this));

                    }
                }.bind(this));
            } else {
                this.promptForApiKey();
            }
        }.bind(this));
    }

    private formatDate(date) {
        let months = [
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
        ];
        let ampm = 'AM';
        let hour = date.getHours();
        if (hour > 11) {
            ampm = 'PM';
            hour = hour - 12;
        }
        if (hour == 0) {
            hour = 12;
        }
        let minute = date.getMinutes();
        if (minute < 10) minute = '0' + minute;
        return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear() + ' ' + hour + ':' + minute + ' ' + ampm;
    }

    private _enoughTimePassed(time) {
        return this.lastHeartbeat + 120000 < time;
    }

    private _getProjectName() {
        if (vscode.workspace && vscode.workspace.rootPath)
            try {
                return vscode.workspace.rootPath.match(/([^\/^\\]*)[\/\\]*$/)[1];
            } catch (e) {}
        return null;
    }

    private obfuscateKey(key:string): string {
        let newKey = '';
        if (key) {
            newKey = key;
            if (key.length > 4)
                newKey = 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXX' + key.substring(key.length - 4);
        }
        return newKey;
    }

    private wrapArg(arg:string): string {
        if (arg.indexOf(' ') > -1)
            arg = '"' + arg + '"'
        return arg
    }

    private formatArguments(python:string, args:string[]):string {
        let clone = args.slice(0);
        clone.unshift(this.wrapArg(python));
        let newCmds = [];
        let lastCmd = '';
        for (let i = 0; i<clone.length; i++) {
            if (lastCmd == '--key')
                newCmds.push(this.wrapArg(this.obfuscateKey(clone[i])));
            else
                newCmds.push(this.wrapArg(clone[i]));
            lastCmd = clone[i];
        }
        return newCmds.join(' ');
    }

    public dispose() {
        this.statusBar.dispose();
        this.disposable.dispose();
    }
}


class Dependencies {

    private _cachedPythonLocation: string;
    private options: Options;

    constructor(options:Options) {
        this.options = options;
    }

    public checkAndInstall(callback) {
        this.isPythonInstalled(function(isInstalled) {
            if (!isInstalled) {
                this.installPython(function() {
                    this.checkAndInstallCore(callback);
                }.bind(this));
            } else {
                this.checkAndInstallCore(callback);
            }
        }.bind(this));
    }

    public checkAndInstallCore(callback) {
        if (!this.isCoreInstalled()) {
            this.installCore(callback);
        } else {
            this.isCoreLatest(function(isLatest) {
                if (!isLatest) {
                    this.installCore(callback);
                } else {
                    callback();
                }
            }.bind(this));
        }
    }

    public getPythonLocation(callback) {
        if (this._cachedPythonLocation)
            return callback(this._cachedPythonLocation);

        let locations = [
            __dirname + path.sep + 'python' + path.sep + 'pythonw',
            "pythonw",
            "python",
            "/usr/local/bin/python",
            "/usr/bin/python",
        ];
        for (var i=40; i>=26; i--) {
          locations.push('\\python' + i + '\\pythonw');
          locations.push('\\Python' + i + '\\pythonw');
        }

        let args = ['--version'];
        for (var i = 0; i < locations.length; i++) {
            try {
                let stdout = child_process.execFileSync(locations[i], args);
                this._cachedPythonLocation = locations[i];
                return callback(locations[i]);
            } catch (e) { }
        }

        callback(null);

    }

    public getCoreLocation() {
        let dir = __dirname + path.sep + 'wakatime-master' + path.sep + 'wakatime' + path.sep + 'cli.py';
        return dir;
    }

    private isCoreInstalled() {
        return fs.existsSync(this.getCoreLocation());
    }

    public static isWindows() {
        return os.type() === 'Windows_NT';
    }

    private isCoreLatest(callback) {
        this.getPythonLocation(function(pythonBinary) {
            if (pythonBinary) {

                let args = [this.getCoreLocation(), '--version'];
                child_process.execFile(pythonBinary, args, function(error, stdout, stderr) {
                    if (!(error != null)) {
                        let currentVersion = stderr.toString().trim();
                        logger.debug('Current wakatime-core version is ' + currentVersion);

                        logger.debug('Checking for updates to wakatime-core...');
                        this.getLatestCoreVersion(function(latestVersion) {
                            if (currentVersion === latestVersion) {
                                logger.debug('wakatime-core is up to date.');
                                if (callback)
                                    callback(true);
                            } else if (latestVersion) {
                                logger.debug('Found an updated wakatime-core v' + latestVersion);
                                if (callback)
                                    callback(false);
                            } else {
                                logger.debug('Unable to find latest wakatime-core version from GitHub.');
                                if (callback)
                                    callback(false);
                            }
                        });
                    } else {
                        if (callback)
                            callback(false);
                    }
                }.bind(this));
            } else {
                if (callback)
                    callback(false);
            }
        }.bind(this));
    }

    private getLatestCoreVersion(callback) {
        let url = 'https://raw.githubusercontent.com/wakatime/wakatime/master/wakatime/__about__.py';
        this.options.getSetting('settings', 'proxy', function(err, proxy) {
            let options = {url: url};
            if (proxy && proxy.trim()) options[proxy] = proxy.trim();
            request.get(options, function(error, response, body) {
                let version = null;
                if (!error && response.statusCode == 200) {
                    let lines = body.split('\n');
                    for (var i = 0; i < lines.length; i++) {
                        let re = /^__version_info__ = \('([0-9]+)', '([0-9]+)', '([0-9]+)'\)/g;
                        let match = re.exec(lines[i]);
                        if (match != null) {
                            version = match[1] + '.' + match[2] + '.' + match[3];
                            if (callback)
                              return callback(version);
                        }
                    }
                }
                if (callback)
                    return callback(version);
            });
        });
    }

    private installCore = function(callback) {
        logger.debug('Downloading wakatime-core...');
        let url = 'https://github.com/wakatime/wakatime/archive/master.zip';
        let zipFile = __dirname + path.sep + 'wakatime-master.zip';

        this.downloadFile(url, zipFile, function() {
            this.extractCore(zipFile, callback);
        }.bind(this));
    }

    private extractCore(zipFile, callback) {
        logger.debug('Extracting wakatime-core into "' + __dirname + '"...');
        this.removeCore(() => {
            this.unzip(zipFile, __dirname, callback);
            logger.debug('Finished extracting wakatime-core.');
        });
    }

    private removeCore(callback) {
        if (fs.existsSync(__dirname + path.sep + 'wakatime-master')) {
            try {
                rimraf(__dirname + path.sep + 'wakatime-master', function() {
                    if (callback != null) {
                        return callback();
                    }
                });
            } catch (e) {
                logger.warn(e);
            }
        } else {
            if (callback != null) {
                return callback();
            }
        }
    }

    private downloadFile(url, outputFile, callback) {
        this.options.getSetting('settings', 'proxy', function(err, proxy) {
            let options = {url: url};
            if (proxy && proxy.trim()) options[proxy] = proxy.trim();
            let r = request.get(options);
            let out = fs.createWriteStream(outputFile);
            r.pipe(out);
            return r.on('end', function() {
                return out.on('finish', function() {
                    if (callback != null) {
                        return callback();
                    }
                });
            });
        });
    }

    private unzip(file, outputDir, callback) {
        if (fs.existsSync(file)) {
            try {
                let zip = new AdmZip(file);
                zip.extractAllTo(outputDir, true);
            } catch (e) {
                return logger.error(e);
            } finally {
                fs.unlink(file);
                if (callback != null) {
                    return callback();
                }
            }
        }
    }

    private isPythonInstalled(callback) {
        this.getPythonLocation(function(pythonBinary) {
            callback(!!pythonBinary);
        }.bind(this));
    }

    private installPython(callback) {
        if (Dependencies.isWindows()) {
            let ver = '3.5.1';
            let arch = 'win32';
            if (os.arch().indexOf('x64') > -1) arch = 'amd64';
            let url = 'https://www.python.org/ftp/python/' + ver + '/python-' + ver + '-embed-' + arch + '.zip';

            logger.debug('Downloading python...');
            let zipFile = __dirname + path.sep + 'python.zip';
            this.downloadFile(url, zipFile, function() {

                logger.debug('Extracting python...');
                this.unzip(zipFile, __dirname + path.sep + 'python');
                logger.debug('Finished installing python.');

                callback();

            }.bind(this));
        } else {
            logger.error('WakaTime depends on Python. Install it from https://python.org/downloads then restart VSCode.');
            // window.alert('WakaTime depends on Python. Install it from https://python.org/downloads then restart VSCode.');
        }
    }
}


class Options {

    private _configFile = path.join(this.getUserHomeDir(), '.wakatime.cfg');

    public getSetting(section:string, key:string, callback?) {
        String.prototype.startsWith = function(s) { return this.slice(0, s.length) === s; };
        String.prototype.endsWith = function(s) { return (s === '') || (this.slice(-s.length) === s); };

        fs.readFile(this.getConfigFile(), 'utf-8', function(err, content) {
            if (err) {
                if (callback) callback(new Error('could not read ~/.wakatime.cfg'), null);
            } else {
                let currentSection = '';
                let lines = content.split('\n');
                for (var i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    if (line.trim().startsWith('[') && line.trim().endsWith(']')) {
                        currentSection = line.trim().substring(1, line.trim().length - 1).toLowerCase();
                    } else if (currentSection === section) {
                      let parts = line.split('=');
                      let currentKey = parts[0].trim();
                      if (currentKey === key && parts.length > 1) {
                          if (callback) callback(null, parts[1].trim());
                          return;
                      }
                    }
                }

                if (callback) callback(null, null);
            }
        });
    }

    public setSetting(section:string, key:string, val:string, callback?) {
        String.prototype.startsWith = function(s) { return this.slice(0, s.length) === s; };
        String.prototype.endsWith = function(s) { return (s === '') || (this.slice(-s.length) === s); };

        fs.readFile(this.getConfigFile(), 'utf-8', function(err, content) {

            // ignore errors because config file might not exist yet
            if (err)
                content = '';

            let contents = [];
            let currentSection = '';

            let found = false;
            let lines = content.split('\n');
            for (var i = 0; i < lines.length; i++) {
                let line = lines[i];
                if (line.trim().startsWith('[') && line.trim().endsWith(']')) {
                    if ((currentSection === section) && !found) {
                        contents.push(key + ' = ' + val);
                        found = true;
                    }
                    currentSection = line.trim().substring(1, line.trim().length - 1).toLowerCase();
                    contents.push(line);
                } else if (currentSection === section) {
                    let parts = line.split('=');
                    let currentKey = parts[0].trim();
                    if (currentKey === key) {
                        if (!found) {
                            contents.push(key + ' = ' + val);
                            found = true;
                        }
                    } else {
                        contents.push(line);
                    }
                } else {
                    contents.push(line);
                }
            }

            if (!found) {
                if (currentSection !== section) {
                    contents.push('[' + section + ']');
                }
                contents.push(key + ' = ' + val);
            }

            fs.writeFile(this.getConfigFile(), contents.join('\n'), function(err2) {
                if (err) {
                    if (callback) callback(new Error('could not write to ~/.wakatime.cfg'));
                } else {
                    if (callback) callback(null);
                }
            });
        }.bind(this));
    }

    public getConfigFile() {
        return this._configFile;
    }

    public getUserHomeDir() {
        return process.env[Dependencies.isWindows() ? 'USERPROFILE' : 'HOME'] || '';
    }
}


class Logger {

    private _level: string;
    private levels = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    };

    constructor(level:string) {
        this.setLevel(level)
    }

    public setLevel(level:string) {
        if (level in this.levels) {
            this._level = level
        } else {
            throw new TypeError('Invalid level: ' + level)
        }
    }

    public log(level:string, msg:string) {
        if (!(level in this.levels))
            throw new TypeError('Invalid level: ' + level)

        const current:number = this.levels[level]
        const cutoff:number = this.levels[this._level]

        if (current >= cutoff) {
            msg = '[WakaTime] [' + level.toUpperCase() + '] ' + msg
            if (level == 'debug') console.log(msg)
            if (level == 'info') console.info(msg)
            if (level == 'warn') console.warn(msg)
            if (level == 'error') console.error(msg)
        }
    }

    public debug(msg:string) {
        this.log('debug', msg)
    }

    public info(msg:string) {
        this.log('info', msg)
    }

    public warn(msg:string) {
        this.log('warn', msg)
    }

    public error(msg:string) {
        this.log('error', msg)
    }
}
