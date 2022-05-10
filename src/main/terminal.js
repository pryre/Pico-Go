'use babel';
import * as vscode from 'vscode';
import Logger from '../helpers/logger.js';
import ApiWrapper from '../main/api-wrapper.js';
import { Socket } from 'net';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default class Term {

  constructor(board, settings) {
    this.port = 0;
    this.host = '127.0.0.1';
    this.termBuffer = '';
    this.terminalName = 'Pico Console';
    this.shellPrompt = '>>> ';
    this.board = board;
    this.logger = new Logger('Term');
    this.api = new ApiWrapper();
    this.onMessage = function() {};
    this.lastWrite = '';
    this.settings = settings;
    this.connectionAttempt = 1;
    this.active = true;
    this.terminal = null;
    this.createFailed = false;
    this.stream = new Socket();
    this.connected = false;
    this.isWindows = process.platform == 'win32';
    this.stopped = false;

    //dragging
    this.startY = null;
  }

  async terminal_closed(event) {
    if (!this.createFailed && event.name == this.terminalName) {
      await this._create();
    }
  }

  async _destroy_stream() {
    this.stream.removeAllListeners();

    if(this.stream)
      this.stream.end();
  }

  stop_capture_terminal_closes() {
    if(this.remove_onclose) {
      this.remove_onclose.dispose();
      this.remove_onclose = null;
    }
  }

  capture_terminal_closes() {
    this.stop_capture_terminal_closes();
    this.remove_onclose = vscode.window.onDidCloseTerminal(this.terminal_closed.bind(this));
  }

  async initialize(cb) {
    await this._create();
    await this._connect(cb);
  }

  show() {
    this.active = true;
    this.terminal.show();
  }

  hide() {
    this.active = false;
    this.terminal.hide();
  }

  async _connectReattempt(cb) {
    this.connectionAttempt += 1;
    this.connected = false;
    await sleep(200);
    this._connect(cb);
  }

  async disconnect() {
    this.stop_capture_terminal_closes();

    this._destroy_stream();

    if(this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

  }

  async _create() {
    this.createFailed = false;
    this.port = parseInt(Math.random() * 1000 + 1337);
    try {
      let termpath = this.api.getPackagePath() + 'terminalExec.py';
      let shellpath = this.settings.detectedPythonPath;

      let existingProcessId = this.settings.context ? this.settings.context.get('processId') : null;

      this.stop_capture_terminal_closes();
      for(let t of vscode.window.terminals) {
        let p = await t.processId;

        if (p == existingProcessId) {
          t.dispose();
        }
      }
      this.capture_terminal_closes();

      this.terminal = vscode.window.createTerminal({
        name: this.terminalName,
        shellPath: shellpath,
        shellArgs: [
          termpath,
          this.port.toString()
        ],
        isTransient: true
      });

      this.settings.context.update('processId', await this.terminal.processId);

      if (this.settings.open_on_start) {
        this.show();
      }
    }
    catch (e) {
      this.createFailed = true;
    }
  }

  async handle_stream_reconnect(cb, reason, error=null) {
    this.logger.warning(reason);
    if(error)
      this.logger.warning(error);

    if(!this.stopped && !this.too_many_reconnects()) {
      this.stopped = true;
      this._connectReattempt(cb);
    }
  }

  async handle_connected(cb) {
    this.stopped = false;
    this.connectionAttempt = 1;
    this.logger.info('Terminal connected');
    this.connected = true;
    cb();
  }

  too_many_reconnects() {
    return this.connectionAttempt > 20;
  }

  async _connect(cb) {
    if (this.too_many_reconnects()) {
      cb(new Error(
        'Unable to start the terminal. Restart VSC or file an issue on our github'
        ));
      return;
    }

    this._destroy_stream();

    this.connected = false;
    this.stream = new Socket();

    this.stream.on('connect', this.handle_connected.bind(this, cb));
    this.stream.on('timeout', this.handle_stream_reconnect.bind(this, cb, 'Timeout'));
    this.stream.on('error', this.handle_stream_reconnect.bind(this, cb, 'Error while connecting to term'));
    this.stream.on('close', this.handle_stream_reconnect.bind(this, cb, 'Term connection closed'));
    this.stream.on('end', this.handle_stream_reconnect.bind(this, cb, 'Term connection ended'));

    this.stream.on('data', this._userInput.bind(this));

    this.stream.connect(this.port, this.host);
  }

  setOnMessageListener(cb) {
    this.onMessage = cb;
  }

  writeln(mssg) {
    this.stream.write(mssg + '\r\n');
    this.lastWrite += mssg;
    if (this.lastWrite.length > 20) {
      this.lastWrite = this.lastWrite.substring(1);
    }
  }

  write(mssg) {
    this.stream.write(mssg);
    this.lastWrite += mssg;
    if (this.lastWrite.length > 20) {
      this.lastWrite = this.lastWrite.substring(1);
    }
  }

  writelnAndPrompt(mssg) {
    this.writeln(mssg + '\r\n');
    this.writePrompt();
  }

  writePrompt() {
    this.write(this.shellPrompt);
  }

  enter() {
    this.write('\r\n');
  }

  clear() {
    this.lastWrite = '';
  }

  _userInput(input) {
    this.onMessage(input);
  }
}