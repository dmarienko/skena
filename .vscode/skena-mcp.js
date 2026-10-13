#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob)
      BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
      kListener: Symbol("kListener"),
      kStatusCode: Symbol("status-code"),
      kWebSocket: Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0)
        return EMPTY_BUFFER;
      if (list.length === 1)
        return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data))
        return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48)
            _mask(source, mask, output, offset, length);
          else
            bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32)
            _unmask(buffer, mask);
          else
            bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = Symbol("kDone");
    var kRun = Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency)
          return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = Symbol("permessage-deflate");
    var kTotalLength = Symbol("total-length");
    var kCallback = Symbol("callback");
    var kBuffers = Symbol("buffers");
    var kError = Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num2 = +value;
                if (!Number.isInteger(num2) || num2 < 8 || num2 > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num2;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num2 = +value;
              if (!Number.isInteger(num2) || num2 < 8 || num2 > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num2;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err2, result) => {
            done();
            callback(err2, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err2, result) => {
            done();
            callback(err2, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin)
          this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err2 = this._inflate[kError];
          if (err2) {
            this._inflate.close();
            this._inflate = null;
            callback(err2);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err2) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err2[kStatusCode] = 1007;
      this[kCallback](err2);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO)
          return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length)
          return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored)
          cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented)
          this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126)
          this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127)
          this._state = GET_PAYLOAD_LENGTH_64;
        else
          this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num2 = buf.readUInt32BE(0);
        if (num2 > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num2 * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked)
          this._state = GET_MASK;
        else
          this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err2, buf) => {
          if (err2)
            return cb(err2);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO)
            this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err2 = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err2, this.createError);
        err2.code = errorCode;
        err2[kStatusCode] = statusCode;
        return err2;
      }
    };
    module2.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var {
      types: { isUint8Array }
    } = require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1)
          target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask)
          return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking)
          return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin)
          this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err2 = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err2, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err2) => {
          process.nextTick(onError, this, err2, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err2 = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err2, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err2, cb) {
      if (typeof cb === "function")
        cb(err2);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function")
          callback(err2);
      }
    }
    function onError(sender, err2, cb) {
      callCallbacks(sender, err2, cb);
      sender.onerror(err2);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = Symbol("kCode");
    var kData = Symbol("kData");
    var kError = Symbol("kError");
    var kMessage = Symbol("kMessage");
    var kReason = Symbol("kReason");
    var kTarget = Symbol("kTarget");
    var kType = Symbol("kType");
    var kWasClean = Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0)
        dest[name] = [elem];
      else
        dest[name].push(elem);
    }
    function parse3(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1)
              end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1)
              end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1)
              end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1)
              end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1)
              start = i;
            else if (!mustUnescape)
              mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1)
                start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1)
              end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1)
              end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1)
        end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format2(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations))
          configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values))
                values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format: format2, parse: parse3 };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http3 = require("http");
    var net = require("net");
    var tls = require("tls");
    var { randomBytes: randomBytes2, createHash } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL: URL2 } = require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format: format2, parse: parse3 } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type))
          return;
        this._binaryType = type;
        if (this._receiver)
          this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket)
          return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout)
          socket.setTimeout(0);
        if (socket.setNoDelay)
          socket.setNoDelay();
        if (head.length > 0)
          socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED)
          return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err2) => {
          if (err2)
            return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number")
          data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0)
          mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number")
          data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0)
          mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain)
          this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number")
          data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED)
          return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute])
              return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function")
            return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err2 = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err2;
        } else {
          emitErrorAndClose(websocket, err2);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes2(16).toString("base64");
      const request3 = isSecure ? https.request : http3.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format2({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost)
              delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request3(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request3(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err2) => {
        if (req === null || req[kAborted])
          return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err2);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err2 = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err2);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING)
          return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt)
          websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse3(secWebSocketExtensions);
          } catch (err2) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err2) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err2) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err2);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err2 = new Error(message);
      Error.captureStackTrace(err2, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err2);
      } else {
        stream.destroy(err2);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket)
          websocket._sender._bufferedBytes += length;
        else
          websocket._bufferedAmount += length;
      }
      if (cb) {
        const err2 = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err2);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0)
        return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005)
        websocket.close();
      else
        websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused)
        websocket._socket.resume();
    }
    function receiverOnError(err2) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err2[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err2);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong)
        websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err2) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED)
        return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err2);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err2) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err2);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data))
          ws.pause();
      });
      ws.once("error", function error(err2) {
        if (duplex.destroyed)
          return;
        terminateOnDestroy = false;
        duplex.destroy(err2);
      });
      ws.once("close", function close() {
        if (duplex.destroyed)
          return;
        duplex.push(null);
      });
      duplex._destroy = function(err2, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err2);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err3) {
          called = true;
          callback(err3);
        });
        ws.once("close", function close() {
          if (!called)
            callback(err2);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy)
          ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open3() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null)
          return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted)
            duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused)
          ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open3() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse3(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1)
            end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse: parse3 };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http3 = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http3.createServer((req, res) => {
            const body = http3.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true)
          options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server)
          return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb)
          this.once("close", cb);
        if (this._state === CLOSING)
          return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path)
            return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err2) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err2) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info))
            return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable)
          return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING)
          return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map))
        server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http3.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http3.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err2 = new Error(message);
        Error.captureStackTrace(err2, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err2, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// src/extension/mcp/server.ts
var fs5 = __toESM(require("fs/promises"));
var path7 = __toESM(require("path"));
var os4 = __toESM(require("os"));
var readline = __toESM(require("readline"));
var crypto = __toESM(require("crypto"));

// src/shared/kernelPalette.ts
var KERNEL_PALETTE = [
  "#4cc8a0",
  // - teal
  "#d9a23f",
  // - amber
  "#7aa2f7",
  // - blue
  "#e5707a",
  // - red
  "#bb9af7",
  // - violet
  "#9ece6a"
  // - green
];
function nextKernelColorIndex(existingKernelCount) {
  return existingKernelCount % KERNEL_PALETTE.length;
}

// src/shared/nodeLabels.ts
function nodeLabelPrefix(node) {
  switch (node.type) {
    case "text":
      return "N";
    case "link":
      return "L";
    case "cell":
      return "C";
    case "kernel":
      return "K";
    case "code":
      return "E";
    case "chat":
      return "A";
    case "portal":
      return "R";
    case "noderef":
      return "D";
    case "knowledge":
      return "W";
    case "file": {
      const f = node.file.toLowerCase();
      if (f.endsWith(".ipynb"))
        return "J";
      if (f.endsWith(".md"))
        return "M";
      if (f.endsWith(".py"))
        return "P";
      if (f.endsWith(".yaml") || f.endsWith(".yml"))
        return "Y";
      if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(f))
        return "I";
      return "F";
    }
    default:
      return "X";
  }
}
function usedLabels(nodes) {
  const s = /* @__PURE__ */ new Set();
  for (const n of nodes)
    if (n.nodeLabel)
      s.add(n.nodeLabel);
  return s;
}
function nextLabel(prefix, used) {
  let i = 1;
  while (used.has(`${prefix}${i}`))
    i++;
  return `${prefix}${i}`;
}
function ensureLabels(nodes) {
  const needsLabel = nodes.some((n) => !n.nodeLabel && n.type !== "group");
  if (!needsLabel)
    return nodes;
  const used = usedLabels(nodes);
  return nodes.map((n) => {
    if (n.nodeLabel || n.type === "group")
      return n;
    const label = nextLabel(nodeLabelPrefix(n), used);
    used.add(label);
    return { ...n, nodeLabel: label };
  });
}
function assignLabel(node, existingNodes) {
  if (node.nodeLabel)
    return node;
  const used = usedLabels(existingNodes);
  const label = nextLabel(nodeLabelPrefix(node), used);
  return { ...node, nodeLabel: label };
}

// src/shared/constants.ts
var GRID = 100;
var NODE_SIZE = {
  text: { w: 700, h: 300 },
  code: { w: 700, h: 100 },
  // - an empty cell: one grid row, what codeCellHeight gives it
  link: { w: 300, h: 100 },
  portal: { w: 200, h: 200 },
  kernel: { w: 140, h: 160 },
  file: { w: 700, h: 700 },
  knowledge: { w: 700, h: 300 }
};
var SECTION_MIN_H = 2 * NODE_SIZE.text.h + 2 * GRID;
var SECTION_FOLDED_H = GRID;
var DEFAULT_NODE_WIDTH = NODE_SIZE.text.w;
var DEFAULT_NODE_HEIGHT = NODE_SIZE.text.h;
var MAX_FILE_FULL_BYTES = 2 * 1024 * 1024;
var MAX_FILE_PREVIEW_BYTES = 200 * 1024;
var MAX_NOTEBOOK_BYTES = 10 * 1024 * 1024;
var CODE_MIN_H = NODE_SIZE.code.h;
var CODE_MAX_H = 900;
var CODE_H_STEP = 50;
var OUTPUT_MIN_W = 600;
var OUTPUT_MAX_W = 1400;
var OUTPUT_MAX_H = 900;
var OUTPUT_DEFAULT_H = 300;
var CODE_LINE_H_ESTIMATE = 18;
var CODE_CHROME_ESTIMATE = 39;

// src/shared/grid.ts
function snapGrid(v) {
  return Math.round(v / GRID) * GRID;
}

// src/shared/bounds.ts
function clampToOrigin(x, y) {
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

// src/shared/sectionLanes.ts
var LANE_BOTTOM_PAD = GRID;
function isGroup(n) {
  return n.type === "group";
}
function sortLanes(lanes) {
  return [...lanes].sort((a, b) => a.y - b.y);
}
function laneIndexForY(lanes, y) {
  let idx = 0;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i].y <= y)
      idx = i;
  }
  return idx;
}
function pinnedLaneIndex(sorted) {
  const m = /* @__PURE__ */ new Map();
  sorted.forEach((l, i) => {
    for (const id of l.folded ?? [])
      m.set(id, i);
  });
  return m;
}
function laneIndexForNode(sorted, node, pinned) {
  return pinned.get(node.id) ?? laneIndexForY(sorted, node.y);
}
function deriveLanes(nodes, lanes) {
  if (lanes.length === 0)
    return [];
  const sorted = sortLanes(lanes);
  const pinned = pinnedLaneIndex(sorted);
  const members = sorted.map(() => []);
  const visible = sorted.map(() => []);
  const maxY = sorted.map(() => -Infinity);
  for (const n of nodes) {
    if (isGroup(n))
      continue;
    const i = laneIndexForNode(sorted, n, pinned);
    members[i].push(n.id);
    if (pinned.has(n.id))
      continue;
    visible[i].push(n);
    if (n.y + n.height > maxY[i])
      maxY[i] = n.y + n.height;
  }
  return sorted.map((l, i) => {
    const next = sorted[i + 1];
    const has = maxY[i] > -Infinity;
    const bottom = next ? next.y : l.folded ? l.y + sectionTargetHeight(l, visible[i]) : (has ? maxY[i] : l.y) + LANE_BOTTOM_PAD;
    return { ...l, label: `S${i + 1}`, index: i, memberIds: members[i], top: l.y, bottom };
  });
}
function visibleContentBottom(l, members) {
  let bottom = l.y;
  for (const n of members)
    if (n.y + n.height > bottom)
      bottom = n.y + n.height;
  return bottom;
}
function sectionTargetHeight(l, members) {
  const content = visibleContentBottom(l, members) + GRID - l.y;
  const raw = Math.max(l.folded ? SECTION_FOLDED_H : SECTION_MIN_H, content);
  return Math.ceil(raw / GRID) * GRID;
}
function fitLanes(lanes, all, own) {
  const nodes = all.filter((n) => !isGroup(n));
  const empty = { laneShifts: {}, nodeShifts: {} };
  const sorted = sortLanes(lanes);
  if (sorted.length === 0)
    return empty;
  const park = sorted[0].y !== 0 ? -sorted[0].y : 0;
  if (sorted.length < 2)
    return park ? { laneShifts: { [sorted[0].id]: park }, nodeShifts: {} } : empty;
  const hidden = pinnedLaneIndex(sorted);
  const owner = new Map([...hidden, ...own ?? []]);
  const visible = sorted.map(() => []);
  const laneOf = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    const i = laneIndexForNode(sorted, n, owner);
    laneOf.set(n.id, i);
    if (!hidden.has(n.id))
      visible[i].push(n);
  }
  const belowShifts = {};
  let acc = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const l = i === 0 ? { ...sorted[0], y: 0 } : sorted[i];
    const range = sorted[i + 1].y - l.y;
    acc += sectionTargetHeight(l, visible[i]) - range;
    if (acc !== 0)
      belowShifts[sorted[i + 1].id] = acc;
  }
  if (park === 0 && Object.keys(belowShifts).length === 0)
    return empty;
  const nodeShifts = {};
  for (const n of nodes) {
    const s = belowShifts[sorted[laneOf.get(n.id)].id];
    if (s)
      nodeShifts[n.id] = s;
  }
  return { laneShifts: park ? { [sorted[0].id]: park, ...belowShifts } : belowShifts, nodeShifts };
}
function unfoldLane(lanes, nodes, id) {
  const sorted = sortLanes(lanes);
  const i = sorted.findIndex((l) => l.id === id);
  if (i < 0 || !sorted[i].folded)
    return { laneShifts: {}, nodeShifts: {}, lanes };
  const own = new Map(sorted[i].folded.map((m) => [m, i]));
  const released = sorted.map((l, k) => {
    if (k !== i)
      return l;
    const { folded: _open, ...rest } = l;
    return rest;
  });
  const f = fitLanes(released, nodes, own);
  return { ...f, lanes: released.map((l) => f.laneShifts[l.id] ? { ...l, y: l.y + f.laneShifts[l.id] } : l) };
}
function applyLaneFit(canvas, now, own) {
  const lanes = canvas.metadata?.sections ?? [];
  if (lanes.length === 0) {
    if (canvas.nodes.every(isGroup))
      return canvas;
    return { ...canvas, metadata: { ...canvas.metadata, sections: [{ id: `sec-${now.toString(36)}`, y: 0, createdAt: now }] } };
  }
  const f = fitLanes(lanes, canvas.nodes, own);
  if (Object.keys(f.laneShifts).length === 0)
    return canvas;
  return {
    ...canvas,
    nodes: canvas.nodes.map((n) => f.nodeShifts[n.id] ? { ...n, y: n.y + f.nodeShifts[n.id] } : n),
    metadata: { ...canvas.metadata, sections: sortLanes(lanes).map((l) => f.laneShifts[l.id] ? { ...l, y: l.y + f.laneShifts[l.id] } : l) }
  };
}
function pruneFoldedIds(lanes, removed) {
  let changed = false;
  const next = lanes.map((l) => {
    if (!l.folded)
      return l;
    const kept = l.folded.filter((id) => !removed.has(id));
    if (kept.length === l.folded.length)
      return l;
    changed = true;
    return { ...l, folded: kept };
  });
  return changed ? next : lanes;
}
function sectionByRef(lanes, ref) {
  const r = ref.trim();
  const sorted = sortLanes(lanes);
  const byId3 = sorted.find((l) => l.id === r);
  if (byId3)
    return byId3;
  const m = /^s(\d+)$/i.exec(r);
  return m ? sorted[Number(m[1]) - 1] ?? null : null;
}
function insertLaneAt(lanes, y, now, id = `sec-${now.toString(36)}`) {
  const at = snapGrid(y);
  if (y < 0 || lanes.some((l) => l.y === at))
    return lanes;
  let unique = id;
  for (let n = 2; lanes.some((l) => l.id === unique); n++)
    unique = `${id}-${n}`;
  return sortLanes([...lanes, { id: unique, y: at, createdAt: now }]);
}
function foldLane(lanes, nodes, id) {
  const target = deriveLanes(nodes, lanes).find((l) => l.id === id);
  if (!target || target.folded)
    return lanes;
  return lanes.map((l) => l.id === id ? { ...l, folded: target.memberIds } : l);
}
function pinOutputToLane(lanes, codeId, outId) {
  const i = lanes.findIndex((l) => l.folded?.includes(codeId));
  if (i < 0 || lanes[i].folded?.includes(outId))
    return lanes;
  return lanes.map((l, k) => k === i ? { ...l, folded: [...l.folded ?? [], outId] } : l);
}
function laneTopForNode(lanes, node) {
  if (lanes.length === 0)
    return -Infinity;
  const sorted = sortLanes(lanes);
  const pinned = pinnedLaneIndex(sorted);
  return sorted[laneIndexForNode(sorted, node, pinned)].y;
}
function outputCellGeom(lanes, cell, gap = 140) {
  const w = 480, h = 320;
  const y = Math.max(laneTopForNode(lanes, cell), Math.round(cell.y + (cell.height - h) / 2));
  return { x: Math.round(cell.x + cell.width + gap), y, width: w, height: h };
}
function parkFirstLaneAtOrigin(lanes) {
  const sorted = sortLanes(lanes);
  if (sorted.length === 0 || sorted[0].y === 0)
    return lanes;
  return sorted.map((l, i) => i === 0 ? { ...l, y: 0 } : l);
}
function memberCodeCellsInRunOrder(nodes, lanes, sectionId) {
  const lane = deriveLanes(nodes, lanes).find((l) => l.id === sectionId);
  if (!lane)
    return [];
  const members = new Set(lane.memberIds);
  return nodes.filter((n) => n.type === "code" && members.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.id);
}

// src/shared/kernelBinding.ts
function resolveBoundKernel(codeNodeId, edges, isKernel) {
  const seen = /* @__PURE__ */ new Set([codeNodeId]);
  const queue = [codeNodeId];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || seen.has(nb))
        continue;
      if (isKernel(nb))
        return nb;
      seen.add(nb);
      queue.push(nb);
    }
  }
  return null;
}
function resolveUpstreamChain(targetId, edges, isKernel, isCodeCell) {
  const kernelId = resolveBoundKernel(targetId, edges, isKernel);
  if (kernelId === null)
    return [];
  const dist = /* @__PURE__ */ new Map([[kernelId, 0]]);
  const q = [kernelId];
  while (q.length) {
    const cur = q.shift();
    const d = dist.get(cur) ?? 0;
    for (const e of edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || dist.has(nb))
        continue;
      dist.set(nb, d + 1);
      q.push(nb);
    }
  }
  const ancestors = /* @__PURE__ */ new Set();
  const walk = [targetId];
  const walked = /* @__PURE__ */ new Set([targetId]);
  while (walk.length) {
    const cur = walk.shift();
    const d = dist.get(cur);
    if (d === void 0)
      continue;
    for (const e of edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || walked.has(nb))
        continue;
      const nd = dist.get(nb);
      if (nd === void 0 || nd >= d)
        continue;
      walked.add(nb);
      if (isCodeCell(nb)) {
        ancestors.add(nb);
        walk.push(nb);
      }
    }
  }
  return [...ancestors].sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
}
function cellKernelView(c) {
  return { nodes: c.nodes, edges: c.edges, sections: c.metadata?.sections, kernels: c.metadata?.kernels };
}
function makeSectionKernelResolver(c) {
  const recordIds = new Set((c.kernels ?? []).map((k) => k.id));
  const kernelNodeIds = new Set(c.nodes.filter((n) => n.type === "kernel").map((n) => n.id));
  const sorted = sortLanes(c.sections ?? []);
  const pinned = pinnedLaneIndex(sorted);
  return (node) => {
    if (sorted.length === 0)
      return null;
    const lane = sorted[laneIndexForNode(sorted, node, pinned)];
    return lane.kernelId && (recordIds.has(lane.kernelId) || kernelNodeIds.has(lane.kernelId)) ? lane.kernelId : null;
  };
}
function makeCellKernelResolver(c) {
  const byId3 = new Map(c.nodes.map((n) => [n.id, n]));
  const memo = /* @__PURE__ */ new Map();
  const isKernel = (id) => byId3.get(id)?.type === "kernel";
  const sectionKernel = makeSectionKernelResolver(c);
  return (cellId) => {
    const hit = memo.get(cellId);
    if (hit !== void 0)
      return hit;
    const viaEdge = resolveBoundKernel(cellId, c.edges, isKernel);
    const cell = byId3.get(cellId);
    const out = viaEdge ?? (cell ? sectionKernel(cell) : null);
    memo.set(cellId, out);
    return out;
  };
}
function resolveCellKernel(cellId, c) {
  return makeCellKernelResolver(c)(cellId);
}
function resolveKernelCellsInCanvas(kernelId, c) {
  const resolve7 = makeCellKernelResolver(c);
  return c.nodes.filter((n) => n.type === "code" && resolve7(n.id) === kernelId).map((n) => n.id);
}
function kernelById(c, id) {
  const rec = c.metadata?.kernels?.find((k) => k.id === id);
  if (rec)
    return rec;
  const node = c.nodes.find((n) => n.id === id && n.type === "kernel");
  return node ? node : null;
}
function upstreamCellsForRun(targetId, c) {
  const byId3 = new Map(c.nodes.map((n) => [n.id, n]));
  const isKernel = (id) => byId3.get(id)?.type === "kernel";
  const isCode = (id) => byId3.get(id)?.type === "code";
  if (resolveBoundKernel(targetId, c.edges, isKernel))
    return resolveUpstreamChain(targetId, c.edges, isKernel, isCode);
  const resolve7 = makeCellKernelResolver(c);
  const kernel = resolve7(targetId);
  if (!kernel)
    return [];
  const seen = /* @__PURE__ */ new Set([targetId]);
  const queue = [targetId];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of c.edges) {
      const nb = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (nb === null || seen.has(nb) || !isCode(nb))
        continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  const pos = (id) => {
    const n = byId3.get(id);
    return { y: n?.y ?? 0, x: n?.x ?? 0 };
  };
  const t = pos(targetId);
  const laneKernel = makeSectionKernelResolver(c);
  return [...seen].filter((id) => id !== targetId).filter((id) => {
    const p = pos(id);
    return p.y < t.y || p.y === t.y && p.x < t.x;
  }).filter((id) => laneKernel(byId3.get(id)) === kernel).sort((a, b) => {
    const pa = pos(a), pb = pos(b);
    return pa.y - pb.y || pa.x - pb.x;
  });
}

// src/shared/layoutEngine.ts
var byId = (nodes) => new Map(nodes.map((n) => [n.id, n]));
var gridUp = (v) => Math.ceil(v / GRID) * GRID;
function codeCellHeight(neededPx) {
  const raw = Math.ceil(Math.max(0, neededPx) / CODE_H_STEP) * CODE_H_STEP;
  return Math.min(CODE_MAX_H, Math.max(CODE_MIN_H, raw));
}
function estimateCodeNeedPx(code) {
  const lines = code.split("\n").length;
  return lines * CODE_LINE_H_ESTIMATE + CODE_CHROME_ESTIMATE;
}
function outputOwners(nodes) {
  const owners = /* @__PURE__ */ new Map();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes)
    if (n.type === "code" && n.outputNodeId && ids.has(n.outputNodeId))
      owners.set(n.outputNodeId, n.id);
  return owners;
}
var isMember = (n, owners) => !owners.has(n.id) && n.type !== "kernel";
function ridersOf(nodes, edges) {
  const map = byId(nodes);
  const owners = outputOwners(nodes);
  const best = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (e.keepRow !== true)
      continue;
    if ((e.fromSide ?? "right") !== "right" || (e.toSide ?? "left") !== "left")
      continue;
    const from = map.get(e.fromNode);
    const to = map.get(e.toNode);
    if (!from || !to || !isMember(to, owners) || from.type === "kernel")
      continue;
    const source = map.get(owners.get(from.id) ?? "") ?? from;
    if (snapGrid(from.x) >= snapGrid(to.x) || snapGrid(source.x) >= snapGrid(to.x))
      continue;
    const held = best.get(to.id);
    if (!held || snapGrid(source.x) < snapGrid(held.x) || snapGrid(source.x) === snapGrid(held.x) && source.id < held.id)
      best.set(to.id, source);
  }
  return new Map([...best].map(([target, source]) => [target, source.id]));
}
function hangingBelow(input, edges, draggedFrom) {
  const nodes = draggedFrom ? input.map((n) => {
    const was = draggedFrom.get(n.id);
    return was ? { ...n, x: was.x, y: was.y } : n;
  }) : input;
  const map = byId(nodes);
  const now = byId(input);
  const owners = outputOwners(nodes);
  const riders = ridersOf(input, edges);
  const out = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (e.fromSide !== "bottom" || e.toSide !== "top")
      continue;
    const from = map.get(e.fromNode);
    const to = map.get(e.toNode);
    if (!from || !to || !isMember(to, owners) || from.type === "kernel")
      continue;
    if (snapGrid(from.x) === snapGrid(to.x) || to.y < from.y + from.h)
      continue;
    if (from.x >= to.x + to.w || to.x >= from.x + from.w)
      continue;
    const at = now.get(to.id);
    const under = input.filter((n) => isMember(n, owners) && snapGrid(n.x) === snapGrid(at.x) && n.y >= at.y);
    if (under.some((n) => sourceOf(n.id, from.id, riders)))
      continue;
    const list = out.get(from.id) ?? [];
    if (!list.includes(to.id))
      list.push(to.id);
    out.set(from.id, list);
  }
  return out;
}
function holdsInPlace(nodes, edges, tested) {
  const probe = edges.map((e) => tested.has(e.id) ? { ...e, keepRow: true } : e);
  const riders = ridersOf(nodes, probe);
  const hanging = hangingBelow(nodes, probe);
  const without = edges.map((e) => tested.has(e.id) ? { ...e, keepRow: false } : e);
  const stored = ridersOf(nodes, without);
  const storedHanging = hangingBelow(nodes, without);
  const map = byId(nodes);
  const yIn = (p, n) => p[n.id]?.y ?? n.y;
  const bases = /* @__PURE__ */ new Map();
  const stays = /* @__PURE__ */ new Map();
  const out = /* @__PURE__ */ new Set();
  for (const e of probe) {
    if (!tested.has(e.id))
      continue;
    const source = ridersOf(nodes, [e]).get(e.toNode);
    if (source === void 0 || riders.get(e.toNode) !== source)
      continue;
    let ok2 = stays.get(e.toNode);
    if (ok2 === void 0) {
      const t = map.get(e.toNode);
      const p = layoutSection(nodes, { columnX: t.x, riders, hanging });
      ok2 = yIn(p, t) === t.y;
      const x = snapGrid(t.x);
      const mates = [...stored.keys()].map((id) => map.get(id)).filter((n) => n.id !== t.id && snapGrid(n.x) === x);
      if (ok2 && mates.length > 0) {
        const base = bases.get(x) ?? layoutSection(nodes, { columnX: x, riders: stored, hanging: storedHanging });
        bases.set(x, base);
        ok2 = mates.every((n) => yIn(p, n) === yIn(base, n));
      }
      stays.set(e.toNode, ok2);
    }
    if (ok2)
      out.add(e.id);
  }
  return out;
}
function keepRowOf(nodes, edges, edge) {
  return holdsInPlace(nodes, [...edges.filter((e) => e.id !== edge.id), edge], /* @__PURE__ */ new Set([edge.id])).has(edge.id);
}
function markKeepRowOnLoad(nodes, sections, edges) {
  const tested = new Set(edges.filter((e) => e.keepRow === void 0).map((e) => e.id));
  if (tested.size === 0)
    return edges;
  const groups = sections.length ? deriveLanes(nodes, sections).map((l) => new Set(l.memberIds)) : [new Set(nodes.map((n) => n.id))];
  const keep = /* @__PURE__ */ new Set();
  for (const ids of groups) {
    for (const id of holdsInPlace(toEngineNodes(nodes.filter((n) => ids.has(n.id))), edges, tested))
      keep.add(id);
  }
  return keep.size ? edges.map((e) => keep.has(e.id) ? { ...e, keepRow: true } : e) : edges;
}
function deriveColumns(nodes, movers = /* @__PURE__ */ new Set()) {
  const owners = outputOwners(nodes);
  const groups = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    if (!isMember(n, owners))
      continue;
    const x = snapGrid(n.x);
    const g = groups.get(x);
    if (g)
      g.push(n);
    else
      groups.set(x, [n]);
  }
  const columns = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([x, cells]) => {
    cells.sort((a, b) => a.y - b.y || Number(movers.has(b.id)) - Number(movers.has(a.id)) || a.id.localeCompare(b.id));
    return { x, cells };
  });
  return columns.map((c, i) => {
    const nextX = columns[i + 1]?.x;
    const inside2 = nextX === void 0 ? c.cells : c.cells.filter((m) => c.x + m.w + GRID <= nextX);
    const widths = (inside2.length > 0 ? inside2 : c.cells).map((m) => m.w);
    return { x: c.x, width: Math.max(...widths), cellIds: c.cells.map((m) => m.id) };
  });
}
function derivePairs(nodes, columns) {
  const map = byId(nodes);
  return columns.map((column) => {
    let outputW = OUTPUT_MIN_W;
    let parked = 0;
    let hasCode = false;
    let hasOutput = false;
    let codeW = 0;
    for (const id of column.cellIds) {
      const cell = map.get(id);
      if (cell?.type === "code") {
        hasCode = true;
        codeW = Math.max(codeW, cell.w);
      }
      const out = map.get(cell?.outputNodeId ?? "");
      if (out) {
        hasOutput = true;
        outputW = Math.max(outputW, out.w);
        parked = Math.max(parked, out.x + out.w);
      }
    }
    const outputX = column.x + Math.max(column.width, codeW) + GRID;
    const right = hasCode ? Math.max(outputX + outputW, parked) : column.x + column.width;
    return { column, outputX, outputW, right, hasOutput };
  });
}
function rowBottom(cell, map) {
  const out = map.get(cell.outputNodeId ?? "");
  return cell.y + Math.max(cell.h, out && out.y <= cell.y ? out.h : 0);
}
function overlaps(a, b) {
  const sepX = a.x + a.w + GRID <= b.x || b.x + b.w + GRID <= a.x;
  const sepY = a.y + a.h + GRID <= b.y || b.y + b.h + GRID <= a.y;
  return !(sepX || sepY);
}
function obstaclesOf(pair, nodes, owners) {
  const members = new Set(pair.column.cellIds);
  return nodes.filter((n) => !members.has(n.id) && n.type !== "kernel" && !members.has(owners.get(n.id) ?? ""));
}
function rowStart(start, x, member, obstacles, near) {
  let y = start;
  for (const o of obstacles) {
    const both = near?.has(o.id) ?? false;
    if (o.x + o.w + (o.x < x || both ? GRID : 0) <= x || x + member.w + (both ? GRID : 0) <= o.x)
      continue;
    if (o.y + o.h + GRID <= y || y + member.h + GRID <= o.y)
      continue;
    y = o.y + o.h + GRID;
  }
  return y;
}
function spansNext(node, nodes, owners) {
  const x = snapGrid(node.x);
  const next = Math.min(...nodes.filter((n) => isMember(n, owners) && snapGrid(n.x) > x).map((n) => snapGrid(n.x)));
  return x + node.w + GRID > next;
}
function heldElsewhere(node, riders, map) {
  const source = map.get(riders.get(node.id) ?? "");
  return source !== void 0 && snapGrid(source.x) !== snapGrid(node.x);
}
function keepsRowAgainst(node, cellId, riders, map) {
  const source = map.get(riders.get(node.id) ?? "");
  return source !== void 0 && snapGrid(source.x) !== snapGrid(node.x) && !sourceOf(cellId, node.id, riders);
}
function packColumn(pair, nodes, map, riders, owners, out, toSlot = () => true, sets = { held: /* @__PURE__ */ new Set(), noBump: /* @__PURE__ */ new Set(), placed: /* @__PURE__ */ new Set() }) {
  const { held, noBump, placed } = sets;
  const x = pair.column.x;
  const outX = (cell, o, wasY) => toSlot(cell.id, o, wasY) ? pair.outputX : Math.max(o.x, pair.outputX);
  const place = (cell, y, oy = y) => {
    const wasY = cell.y;
    if (x !== cell.x || y !== cell.y) {
      if (out)
        out[cell.id] = { x, y };
      cell.x = x;
      cell.y = y;
    }
    const o = map.get(cell.outputNodeId ?? "");
    const ox = o ? outX(cell, o, wasY) : 0;
    if (o && (o.x !== ox || o.y !== oy)) {
      if (out)
        out[o.id] = { x: ox, y: oy };
      o.x = ox;
      o.y = oy;
    }
  };
  const members = pair.column.cellIds.map((id) => map.get(id));
  const own = new Set(pair.column.cellIds);
  const rowOf = (cell) => {
    const s = riders.get(cell.id);
    return s !== void 0 && !own.has(s) ? map.get(s)?.y : void 0;
  };
  const byRow = (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
  const around = obstaclesOf(pair, nodes, owners);
  const blocking = around.filter((n) => owners.has(n.id) || held.has(n.id)).sort(byRow);
  const movedOuts = sets.movedOutputs ?? /* @__PURE__ */ new Set();
  const blocks = (node) => (o) => !(movedOuts.has(o.id) && keepsRowAgainst(node, owners.get(o.id) ?? "", riders, map));
  const belowHeld = (cell, y, list) => {
    const o = map.get(cell.outputNodeId ?? "");
    if (!o || !movedOuts.has(o.id))
      return y;
    const ox = toSlot(cell.id, o, cell.y) ? pair.outputX : Math.max(o.x, pair.outputX);
    const keep = around.filter((n) => held.has(n.id) && keepsRowAgainst(n, cell.id, riders, map)).sort(byRow);
    const start = y;
    for (let guard = 0; guard < 16; guard++) {
      const above2 = y > start ? around.filter((n) => !noBump.has(n.id) && n.y < y) : [];
      const near = /* @__PURE__ */ new Set([...noBump, ...keep.map((n) => n.id), ...above2.map((n) => n.id)]);
      const oy = rowStart(y, ox, o, [...keep, ...above2].sort(byRow), near);
      const my = rowStart(oy, x, cell, [...list, ...above2].sort(byRow), near);
      if (my === y)
        break;
      y = my;
    }
    if (y > start) {
      for (const n of keep)
        if (n.y < y && n.x < ox + o.w + GRID && ox < n.x + n.w + GRID)
          sets.wentUnder?.add(n.id);
    }
    return y;
  };
  const startY = (n) => sets.startY?.get(n.id) ?? n.y;
  const above = (m, r) => startY(m) < startY(r) || startY(m) === startY(r) && sets.dropped?.has(m.id) === true;
  const boxY = /* @__PURE__ */ new Map();
  const packOnce = (under2) => {
    const anchored = members.map((cell, order) => ({ cell, order, at: under2.has(cell.id) ? void 0 : rowOf(cell) })).filter((a) => a.at !== void 0).sort((a, b) => a.at - b.at || a.order - b.order);
    const anchoredIds = new Set(anchored.map((a) => a.cell.id));
    const outputRow = (cell, y) => {
      const o = map.get(cell.outputNodeId ?? "");
      if (!o || sets.reflow)
        return y;
      const over = members.filter((m) => !anchoredIds.has(m.id) && above(m, cell) && m.y < y).map((m) => map.get(m.outputNodeId ?? "")).filter((n) => n !== void 0).sort(byRow);
      return rowStart(y, outX(cell, o, cell.y), o, over, noBump);
    };
    let prevRider = null;
    for (const a of anchored) {
      const source = map.get(riders.get(a.cell.id));
      const inWay = (blocking.includes(source) ? blocking : [...blocking, source].sort(byRow)).filter(blocks(a.cell));
      const y = belowHeld(a.cell, rowStart(prevRider === null ? a.at : Math.max(a.at, prevRider + GRID), x, a.cell, inWay, noBump), inWay);
      place(a.cell, y, outputRow(a.cell, y));
      placed.add(a.cell.id);
      prevRider = rowBottom(a.cell, map);
    }
    const taken = new Set(anchored.map((a) => a.cell.id));
    const fixed = anchored.flatMap((a) => [sets.reflow ? a.cell : { ...a.cell, h: rowBottom(a.cell, map) - a.cell.y }, map.get(a.cell.outputNodeId ?? "")].filter((n) => n !== void 0));
    const obstacles = [...around, ...fixed].sort(byRow);
    const otherRiders = around.filter((n) => riders.has(n.id) && held.has(n.id));
    const others = new Set(otherRiders.map((n) => n.id));
    const riderRows = [...fixed, ...otherRiders.filter((n) => placed.has(n.id))].sort(byRow);
    const headRows = [...fixed, ...around.filter((n) => noBump.has(n.id) && (!others.has(n.id) || placed.has(n.id)))].sort(byRow);
    let prevBottom = null;
    for (const cell of members) {
      if (taken.has(cell.id))
        continue;
      if (under2.has(cell.id)) {
        const source = map.get(riders.get(cell.id));
        const inWay = [.../* @__PURE__ */ new Set([...blocking, source, ...fixed])].sort(byRow).filter(blocks(cell));
        const start = prevBottom === null ? rowOf(cell) : Math.max(rowOf(cell), prevBottom + GRID);
        place(cell, belowHeld(cell, rowStart(start, x, cell, inWay, noBump), inWay));
        placed.add(cell.id);
        prevBottom = rowBottom(cell, map);
        continue;
      }
      const isHeld = held.has(cell.id);
      const below = /* @__PURE__ */ new Set();
      for (const id of sets.hanging?.get(cell.id) ?? []) {
        const t = map.get(id);
        if (t && !others.has(id)) {
          for (const n of bumpGroup(t, nodes, owners, map, true))
            if (!others.has(n.id))
              below.add(n.id);
        }
      }
      const keep = (o) => riders.get(o.id) !== cell.id && !below.has(o.id) && !(isHeld && others.has(o.id));
      const list = (prevBottom === null && !sets.reflow ? headRows : obstacles).filter(keep);
      const floor = sets.reflow ? -Infinity : Math.max(...anchored.filter((a) => !above(cell, a.cell)).map((a) => rowBottom(a.cell, map) + GRID));
      let y = prevBottom === null ? rowStart(Math.max(snapGrid(sets.headY?.get(cell.id) ?? cell.y), floor), x, cell, list, noBump) : rowStart(Math.max(prevBottom + GRID, floor), x, cell, list, noBump);
      const out2 = map.get(cell.outputNodeId ?? "");
      const theirs = new Set(anchored.filter((a) => above(cell, a.cell)).map((a) => a.cell.outputNodeId ?? ""));
      const outRows = sets.reflow ? list : fixed.filter(keep).filter((n) => !theirs.has(n.id));
      boxY.set(cell.id, y);
      if (out2 && outRows.length > 0) {
        const ox = outX(cell, out2, cell.y);
        for (let guard = 0; guard < 16; guard++) {
          const oy = rowStart(y, ox, out2, outRows, noBump);
          const my = rowStart(oy, x, cell, list, noBump);
          if (my === y)
            break;
          y = my;
        }
      }
      place(cell, belowHeld(cell, y, list));
      prevBottom = rowBottom(cell, map);
    }
  };
  const sourceMoved = (r) => {
    const s = riders.get(r.id);
    return sets.movers?.has(s) === true || map.get(s).y !== sets.startY?.get(s);
  };
  const under = /* @__PURE__ */ new Set();
  const saved = [...members, ...members.map((m) => map.get(m.outputNodeId ?? "")).filter((n) => n !== void 0)];
  for (let guard = 0; ; guard++) {
    const at = saved.map((n) => ({ n, x: n.x, y: n.y, p: out?.[n.id] }));
    const wasPlaced = new Set(placed), wasUnder = new Set(sets.wentUnder ?? []);
    packOnce(under);
    if (sets.reflow || guard >= members.length)
      return;
    const passed = members.filter((r, i) => !under.has(r.id) && rowOf(r) !== void 0 && members.slice(0, i).some((m) => rowOf(m) === void 0 && m.y > r.y && above(m, r) && ((boxY.get(m.id) ?? m.y) < r.y || !sets.movers?.has(r.id) && !sourceMoved(r))));
    if (passed.length === 0)
      return;
    for (const r of passed)
      under.add(r.id);
    for (const b of at) {
      b.n.x = b.x;
      b.n.y = b.y;
      if (out) {
        if (b.p)
          out[b.n.id] = b.p;
        else
          delete out[b.n.id];
      }
    }
    placed.clear();
    for (const id of wasPlaced)
      placed.add(id);
    if (sets.wentUnder) {
      sets.wentUnder.clear();
      for (const id of wasUnder)
        sets.wentUnder.add(id);
    }
  }
}
function bumpGroup(node, nodes, owners, map, downward) {
  const anchor = map.get(owners.get(node.id) ?? "") ?? node;
  if (anchor.type === "kernel")
    return [anchor];
  const x = snapGrid(anchor.x);
  const column = nodes.filter((n) => isMember(n, owners) && snapGrid(n.x) === x);
  const taken = downward ? column.filter((n) => n.y >= anchor.y) : column;
  const group = [...taken];
  for (const c of taken) {
    const o = map.get(c.outputNodeId ?? "");
    if (o)
      group.push(o);
  }
  return group;
}
function sourceOf(id, of, riders) {
  const seen = /* @__PURE__ */ new Set();
  for (let up = riders.get(of); up !== void 0 && !seen.has(up); up = riders.get(up)) {
    if (up === id)
      return true;
    seen.add(up);
  }
  return false;
}
function withRiders(moving, nodes, owners, riders, hanging, map, pinned, bumper) {
  const out = [...moving];
  const seen = new Set(out.map((n) => n.id));
  for (let i = 0; i < out.length; i++) {
    for (const [target, source] of riders) {
      if (source !== out[i].id || seen.has(target))
        continue;
      const rider = map.get(target);
      if (!rider || target === bumper.id)
        continue;
      if (!pinned.has(target) && sourceOf(target, bumper.id, riders))
        continue;
      seen.add(target);
      out.push(rider);
      const o = map.get(rider.outputNodeId ?? "");
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
      }
    }
    for (const target of hanging.get(out[i].id) ?? []) {
      const t = map.get(target);
      if (!t || seen.has(target) || pinned.has(target) || target === bumper.id)
        continue;
      for (const n of bumpGroup(t, nodes, owners, map, true)) {
        if (seen.has(n.id) || pinned.has(n.id) || n.id === bumper.id)
          continue;
        seen.add(n.id);
        out.push(n);
      }
    }
  }
  return out;
}
function nextBump(nodes, owners, pinned, active) {
  const moved = nodes.filter((n) => active.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
  const rest = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const mover of moved) {
    for (const other of rest) {
      if (other.id === mover.id || owners.get(other.id) === mover.id || owners.get(mover.id) === other.id)
        continue;
      if (!overlaps(mover, other))
        continue;
      if (!pinned.has(other.id))
        return { mover, other };
      if (!pinned.has(mover.id))
        return { mover: other, other: mover };
    }
  }
  return null;
}
function resolveBumps(nodes, owners, riders, pinned, placed, keepPlace, active, movedOutputs, hanging, opts = {}) {
  const map = byId(nodes);
  const before = nodes.map((n) => ({ node: n, x: n.x, y: n.y }));
  for (let guard = opts.maxSteps ?? nodes.length * 4 + 32; guard > 0; guard--) {
    const hit = nextBump(nodes, owners, pinned, active);
    if (!hit)
      return;
    const { mover, other } = hit;
    const column = bumpGroup(other, nodes, owners, map, false);
    const makesRoom = movedOutputs.has(mover.id) && isMember(other, owners) && !heldElsewhere(other, riders, map) && snapGrid(other.x) >= snapGrid(mover.x) && !spansNext(other, nodes, owners);
    const dx = other.x < mover.x && !makesRoom || owners.has(other.id) || column.some((n) => pinned.has(n.id) || n.id === mover.id) ? 0 : gridUp(mover.x + mover.w + GRID - other.x);
    const dy = mover.y + mover.h + GRID - other.y;
    const drop = other.y + other.h + GRID - mover.y;
    const yields = other.y < mover.y && (placed.has(mover.id) || pinned.has(mover.id) && !keepPlace.has(mover.id));
    const sideways = dx !== 0 && (makesRoom || (yields ? dx <= drop : other.y < mover.y || dx <= dy));
    const held = /* @__PURE__ */ new Set([mover.id, owners.get(mover.id) ?? mover.outputNodeId ?? ""]);
    if (sideways)
      for (const n of column) {
        n.x += dx;
        active.add(n.id);
      }
    else if (yields)
      for (const n of withRiders(bumpGroup(mover, nodes, owners, map, true), nodes, owners, riders, /* @__PURE__ */ new Map(), map, pinned, other)) {
        n.y += drop;
        active.add(n.id);
      }
    else {
      const group = bumpGroup(other, nodes, owners, map, true).filter((n) => !pinned.has(n.id) && !held.has(n.id));
      for (const n of withRiders(group, nodes, owners, riders, hanging, map, pinned, mover).filter((n2) => !held.has(n2.id))) {
        n.y += dy;
        active.add(n.id);
      }
    }
  }
  if (!nextBump(nodes, owners, pinned, active))
    return;
  for (const b of before) {
    b.node.x = b.x;
    b.node.y = b.y;
  }
  if (opts.report)
    opts.report.capped = true;
}
function clone(nodes) {
  return nodes.map((n) => ({ ...n }));
}
function diff(before, after) {
  const b = byId(before);
  const res = {};
  for (const n of after) {
    const o = b.get(n.id);
    if (o.x !== n.x || o.y !== n.y)
      res[n.id] = { x: n.x, y: n.y };
  }
  return res;
}
function layoutSection(input, opts = {}) {
  return layoutCall(input, opts, true);
}
function layoutCall(input, opts, recheck) {
  const nodes = clone(input);
  const map = byId(nodes);
  const movers = new Set(opts.moverIds ?? []);
  const resized = new Set(opts.resized ?? []);
  const owners = outputOwners(nodes);
  const riders = opts.riders ?? /* @__PURE__ */ new Map();
  const hanging = opts.hanging ?? /* @__PURE__ */ new Map();
  const pairs = derivePairs(nodes, deriveColumns(nodes, movers));
  const touched = /* @__PURE__ */ new Set();
  const pinned = new Set(movers);
  for (const id of movers) {
    const n = map.get(id);
    if (!n)
      continue;
    const memberId = owners.get(id) ?? id;
    touched.add(snapGrid(map.get(memberId).x));
    pinned.add(memberId);
    if (n.outputNodeId)
      pinned.add(n.outputNodeId);
  }
  if (opts.columnX !== void 0)
    touched.add(snapGrid(opts.columnX));
  const placed = new Set(pinned);
  for (let more = true; more; ) {
    more = false;
    for (const [target, source] of riders) {
      const r = map.get(target), s = map.get(source);
      if (!r || !s || touched.has(snapGrid(r.x)) || !touched.has(snapGrid(s.x)))
        continue;
      touched.add(snapGrid(r.x));
      more = true;
    }
  }
  for (const target of riders.keys()) {
    const t = map.get(target);
    if (t && touched.has(snapGrid(t.x)))
      pinned.add(target);
  }
  const held = new Set(pinned);
  const noBump = new Set(held);
  for (const pair of pairs)
    if (touched.has(pair.column.x))
      for (const id of pair.column.cellIds) {
        noBump.add(id);
        const outId = map.get(id).outputNodeId;
        if (outId)
          noBump.add(outId);
      }
  const wentUnder = /* @__PURE__ */ new Set();
  const sets = { held, noBump, placed: /* @__PURE__ */ new Set(), movedOutputs: new Set([...movers].filter((id) => owners.has(id) && !resized.has(id))), wentUnder, hanging, movers, dropped: new Set([...movers].filter((id) => opts.draggedFrom?.has(id))), startY: new Map(input.map((n) => [n.id, n.y])) };
  const packed = new Set(pairs.filter((p) => touched.has(p.column.x)));
  const makeRoom = (pair, moved) => {
    const members = pair.column.cellIds.map((id) => map.get(id));
    if (members.some((n) => placed.has(n.id) || wentUnder.has(n.id)))
      return;
    for (const id of sets.movedOutputs) {
      const o = map.get(id);
      if (snapGrid(o.x) > pair.column.x || !members.some((m) => !heldElsewhere(m, riders, map) && !spansNext(m, nodes, owners) && overlaps(o, m)))
        continue;
      const dx = gridUp(o.x + o.w + GRID - pair.column.x);
      for (const m of members)
        for (const n of [m, map.get(m.outputNodeId ?? "")])
          if (n) {
            n.x += dx;
            moved[n.id] = { x: n.x, y: n.y };
          }
      pair.column.x += dx;
      pair.outputX += dx;
      pair.right += dx;
    }
  };
  const packRounds = () => {
    const all = {};
    const headY = new Map(nodes.map((n) => [n.id, n.y]));
    for (let round = 0; round < 16; round++) {
      sets.headY = round < 8 ? headY : void 0;
      const moved = {};
      pairs.sort((a, b) => a.column.x - b.column.x);
      for (const pair of pairs)
        if (packed.has(pair)) {
          makeRoom(pair, moved);
          packColumn(pair, nodes, map, riders, owners, moved, (id, o, wasY) => movers.has(id) && o.y !== wasY, sets);
          for (const id of pair.column.cellIds) {
            pinned.add(id);
            const outId = map.get(id).outputNodeId;
            if (outId)
              pinned.add(outId);
          }
        }
      if (Object.keys(moved).length === 0)
        break;
      Object.assign(all, moved);
    }
    return all;
  };
  const positions = () => nodes.map((n) => `${n.x},${n.y}`).join(";");
  const rereadSlots = () => {
    const now = derivePairs(nodes, deriveColumns(nodes, movers));
    let changed = false;
    for (const p of packed) {
      const q = now.find((c) => c.column.x === p.column.x);
      if (!q || q.outputX === p.outputX)
        continue;
      if (q.column.cellIds.length !== p.column.cellIds.length || q.column.cellIds.some((id) => !p.column.cellIds.includes(id)))
        continue;
      p.column.width = q.column.width;
      p.outputX = q.outputX;
      p.outputW = q.outputW;
      p.right = q.right;
      changed = true;
    }
    return changed;
  };
  let first = null;
  let settled = false;
  const follow = (was, moved) => {
    const queue = [...hanging.keys()].map((id) => map.get(id)).filter((n) => n !== void 0 && n.y > (was.get(n.id) ?? n.y)).map((n) => ({ n, d: n.y - was.get(n.id) })).sort((a, b) => b.d - a.d);
    const followed = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const { n, d } = queue.shift();
      for (const id of hanging.get(n.id) ?? []) {
        const t = map.get(id);
        if (!t || pinned.has(id) || followed.has(id))
          continue;
        for (const m of bumpGroup(t, nodes, owners, map, true)) {
          if (pinned.has(m.id) || followed.has(m.id))
            continue;
          followed.add(m.id);
          m.y += d;
          moved[m.id] = { x: m.x, y: m.y };
          if (hanging.has(m.id))
            queue.push({ n: m, d });
        }
      }
    }
  };
  for (let pass = 0; pass < 4 && !settled; pass++) {
    const was = new Map(nodes.map((n) => [n.id, (pass === 0 ? opts.draggedFrom?.get(n.id)?.y : void 0) ?? n.y]));
    const moved = packRounds();
    const at = positions();
    follow(was, moved);
    if (pass > 0 && Object.keys(moved).length === 0) {
      settled = true;
      break;
    }
    const report = {};
    resolveBumps(nodes, owners, riders, pinned, placed, held, /* @__PURE__ */ new Set([...movers, ...Object.keys(moved)]), sets.movedOutputs, hanging, { report, maxSteps: opts.maxSteps });
    if (report.capped) {
      if (opts.report)
        opts.report.capped = true;
      if (pass === 0)
        settled = true;
      break;
    }
    if (pass === 0)
      first = nodes.map((n) => ({ node: n, x: n.x, y: n.y }));
    const reread = rereadSlots();
    if (positions() === at && !reread)
      settled = true;
  }
  if (!settled && first) {
    const again = recheck ? layoutCall(nodes.map((n) => ({ ...n })), { ...opts, draggedFrom: void 0, report: void 0 }, false) : { unsettled: { x: 0, y: 0 } };
    if (Object.keys(again).length > 0) {
      for (const f of first) {
        f.node.x = f.x;
        f.node.y = f.y;
      }
      if (opts.report)
        opts.report.capped = true;
    }
  }
  return diff(input, nodes);
}
function reflowSection(input, opts = {}) {
  const nodes = clone(input);
  const map = byId(nodes);
  const owners = outputOwners(nodes);
  const sweep = (a, b) => snapGrid(a.x) - snapGrid(b.x) || a.y - b.y || a.id.localeCompare(b.id);
  const xs = [];
  const reaches = (cx, sx) => {
    if (sx < cx)
      return cx - sx <= GRID;
    const ms = nodes.filter((m) => isMember(m, owners) && snapGrid(m.x) === cx);
    return ms.length > 0 && ms.every((m) => cx + m.w + GRID > sx);
  };
  const adopt = (n) => {
    const sx = snapGrid(n.x);
    const near = xs.filter((x) => reaches(x, sx)).sort((a, b) => Math.abs(a - sx) - Math.abs(b - sx))[0];
    if (near === void 0)
      xs.push(sx);
    n.x = near ?? sx;
  };
  for (const n of nodes.filter((n2) => n2.type === "code").sort(sweep))
    adopt(n);
  for (const n of nodes.filter((n2) => isMember(n2, owners) && n2.type !== "code").sort(sweep))
    adopt(n);
  const riders = opts.riders ?? /* @__PURE__ */ new Map();
  const noBump = new Set(nodes.map((n) => n.id));
  const headY = new Map(nodes.map((n) => [n.id, n.y]));
  const packAll = () => {
    const held = new Set([...riders].filter(([t, s]) => map.has(t) && map.has(s) && snapGrid(map.get(t).x) !== snapGrid(map.get(s).x)).map(([t]) => t));
    const sets = { held, noBump, placed: /* @__PURE__ */ new Set(), reflow: true };
    for (let round = 0; round < 16; round++) {
      sets.headY = round < 8 ? headY : void 0;
      const moved = {};
      for (const pair of derivePairs(nodes, deriveColumns(nodes)))
        packColumn(pair, nodes, map, riders, owners, moved, () => true, sets);
      if (Object.keys(moved).length === 0)
        break;
    }
  };
  packAll();
  const end = (p) => p.hasOutput ? p.right : p.column.x + p.column.width;
  for (let round = 0; round < 8; round++) {
    const tight = derivePairs(nodes, deriveColumns(nodes));
    let moved = false;
    for (let i = 1; i < tight.length; i++) {
      const want = gridUp(end(tight[i - 1]) + GRID);
      const dx = want - tight[i].column.x;
      if (dx === 0)
        continue;
      for (const id of tight[i].column.cellIds) {
        const cell = map.get(id);
        cell.x += dx;
        const o = map.get(cell.outputNodeId ?? "");
        if (o)
          o.x += dx;
      }
      tight[i].column.x += dx;
      tight[i].outputX += dx;
      tight[i].right += dx;
      moved = true;
    }
    if (!moved)
      break;
  }
  packAll();
  return diff(input, nodes);
}
function insertAfter(nodes, afterId) {
  const after = nodes.find((n) => n.id === afterId);
  if (!after)
    return null;
  const map = byId(nodes);
  const owners = outputOwners(nodes);
  const x = snapGrid(after.x);
  const above = isMember(after, owners) ? nodes.filter((n) => isMember(n, owners) && snapGrid(n.x) === x && n.y <= after.y) : [];
  return { x, y: Math.max(rowBottom(after, map), ...above.map((n) => rowBottom(n, map))) + GRID };
}
function forkOf(nodes, cellId, side, w = NODE_SIZE.code.w) {
  const cell = nodes.find((n) => n.id === cellId);
  if (!cell || cell.type !== "code")
    return null;
  const pairs = derivePairs(nodes, deriveColumns(nodes));
  const pair = pairs.find((p) => p.column.cellIds.includes(cellId));
  if (!pair)
    return null;
  if (side === "right") {
    const map = byId(nodes);
    const next = pairs.find((p) => p.column.x >= pair.outputX && p.column.cellIds.some((id) => map.get(id)?.type === "code"));
    if (!next)
      return { x: gridUp(pair.right + GRID), y: snapGrid(cell.y) };
    const out = map.get(cell.outputNodeId ?? "");
    const slot = { x: next.column.x, y: snapGrid(cell.y), w, h: NODE_SIZE.code.h };
    return out && overlaps(slot, out) ? { x: slot.x, y: gridUp(out.y + out.h + GRID) } : { x: slot.x, y: slot.y };
  }
  const x = Math.floor((pair.column.x - GRID - (w + GRID + OUTPUT_MIN_W)) / GRID) * GRID;
  return x < 0 ? null : { x, y: snapGrid(cell.y) };
}
function placeOutput(nodes, codeId, existing) {
  const code = nodes.find((n) => n.id === codeId);
  if (!code || code.type !== "code")
    return null;
  const pairs = derivePairs(nodes, deriveColumns(nodes));
  const pair = pairs.find((p) => p.column.cellIds.includes(codeId));
  if (!pair)
    return null;
  return { x: pair.outputX, y: snapGrid(code.y), width: existing?.w ?? OUTPUT_MIN_W, height: existing?.h ?? OUTPUT_DEFAULT_H };
}
function applyPatchesToCanvas(nodes, p) {
  if (Object.keys(p).length === 0)
    return nodes;
  return nodes.map((n) => {
    const q = p[n.id];
    return q ? { ...n, x: q.x, y: q.y, ...q.w !== void 0 ? { width: q.w } : {}, ...q.h !== void 0 ? { height: q.h } : {} } : n;
  });
}
function anchorLane(nodes, sections, anchor) {
  const nodeId = typeof anchor === "string" ? anchor : anchor.nodeId;
  const derived = deriveLanes(nodes, sections);
  return typeof anchor !== "string" && anchor.sectionId !== void 0 ? derived.find((l) => l.id === anchor.sectionId) : derived.find((l) => nodeId !== void 0 && l.memberIds.includes(nodeId));
}
function sectionEngineNodes(nodes, sections, anchor, extraIds) {
  const lane = anchorLane(nodes, sections, anchor);
  if (!lane)
    return null;
  const members = /* @__PURE__ */ new Set([...lane.memberIds, ...extraIds ?? []]);
  return toEngineNodes(nodes.filter((n) => members.has(n.id)));
}
function sectionMembership(nodes, sections, anchor, extraIds) {
  const lane = anchorLane(nodes, sections, anchor);
  return new Map(lane ? [...lane.memberIds, ...extraIds ?? []].map((id) => [id, lane.index]) : []);
}
function columnsOfDeleted(nodes, sections, deletedIds) {
  if (sections.length === 0)
    return [];
  const derived = deriveLanes(nodes, sections);
  const seen = /* @__PURE__ */ new Set();
  const cols = [];
  for (const n of nodes) {
    if (!deletedIds.has(n.id))
      continue;
    const member = nodes.find((c) => c.type === "code" && c.outputNodeId === n.id) ?? n;
    const lane = derived.find((l) => l.memberIds.includes(member.id));
    if (!lane)
      continue;
    const key = `${lane.id}|${snapGrid(member.x)}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    cols.push({ sectionId: lane.id, columnX: snapGrid(member.x) });
  }
  return cols;
}
function toEngineNodes(nodes) {
  return nodes.filter((n) => !isGroup(n)).map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height, ...n.outputNodeId ? { outputNodeId: n.outputNodeId } : {} }));
}

// src/extension/jupyter/config.ts
function defaultServerFromEnv(env) {
  const hubUrl = env.JUPYTER_SERVER_URL;
  const token = env.JUPYTER_API_TOKEN;
  return hubUrl && token ? [{ name: "default", hubUrl, token }] : [];
}
function pickKernelServers(harness, settings, env) {
  const looked = [];
  if (harness === void 0 || harness === "")
    looked.push("SKENA_JUPYTER_KERNELS (not set)");
  else if (harness !== null) {
    let list;
    try {
      list = JSON.parse(harness);
    } catch {
      list = void 0;
    }
    if (Array.isArray(list) && list.length)
      return { servers: list, from: "SKENA_JUPYTER_KERNELS", looked };
    looked.push(Array.isArray(list) ? "SKENA_JUPYTER_KERNELS (empty list)" : "SKENA_JUPYTER_KERNELS (not a JSON list)");
  }
  for (const s of settings) {
    if (s.problem) {
      looked.push(`${s.file} (${s.problem})`);
      continue;
    }
    const list = s.json?.["skena.jupyter.kernels"];
    if (Array.isArray(list) && list.length)
      return { servers: list, from: s.file, looked };
    looked.push(`${s.file} (no skena.jupyter.kernels)`);
  }
  const fromEnv = defaultServerFromEnv(env);
  if (fromEnv.length)
    return { servers: fromEnv, from: "JUPYTER_SERVER_URL + JUPYTER_API_TOKEN", looked };
  const unset = ["JUPYTER_SERVER_URL", "JUPYTER_API_TOKEN"].filter((k) => !env[k]);
  looked.push(`${unset.join(" and ")} (not set)`);
  return { servers: [], from: null, looked };
}
function unknownServerText(name, lookup) {
  if (lookup.servers.length) {
    return `error: unknown server ${name} \u2014 known: ${lookup.servers.map((s) => s.name).join(", ")} (from ${lookup.from})`;
  }
  return `error: unknown server ${name} \u2014 no Jupyter servers configured; looked in: ${lookup.looked.join("; ")}`;
}

// src/extension/settingsFiles.ts
var fsSync = __toESM(require("fs"));
var path = __toESM(require("path"));

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + " ".repeat(index);
    })
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + "	".repeat(index);
    })
  }
};

// node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
    } else {
      handleError(5, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [
        2
        /* SyntaxKind.CloseBraceToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [
          4,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [
        4
        /* SyntaxKind.CloseBracketToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}

// node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse2 = parse;
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}

// src/extension/settingsJson.ts
function parseSettingsJson(raw) {
  const errors = [];
  const result = parse2(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `settings JSON parse error: ${printParseErrorCode(first.error)} at offset ${first.offset}`
    );
  }
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("settings JSON must parse to an object");
  }
  return result;
}

// src/extension/settingsFiles.ts
function workspaceDirAbove(start) {
  let dir = path.resolve(start);
  for (; ; ) {
    try {
      if (fsSync.statSync(path.join(dir, ".vscode")).isDirectory())
        return dir;
    } catch {
    }
    const parent = path.dirname(dir);
    if (parent === dir)
      return null;
    dir = parent;
  }
}
function readSettingsSync(file) {
  let raw;
  try {
    raw = fsSync.readFileSync(file, "utf-8");
  } catch (e) {
    return { file, problem: e.code === "ENOENT" ? "missing" : "not readable" };
  }
  try {
    return { file, json: parseSettingsJson(raw) };
  } catch (e) {
    return { file, problem: e instanceof Error ? e.message : String(e) };
  }
}

// src/shared/nodeRef.ts
var REF_RE = /^(.+\.canvas)#([A-Z]+\d+)$/;
function parseNodeRef(s) {
  const m = REF_RE.exec(s.trim());
  return m ? { canvas: m[1], label: m[2] } : null;
}
function isSectionLabel(label) {
  return /^S\d+$/.test(label);
}

// src/shared/youtube.ts
var YOUTUBE_NODE = { w: 500, h: 320 };
function youtubeId(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id = null;
  if (host === "youtu.be")
    id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch")
      id = u.searchParams.get("v");
    else
      id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

// src/shared/outputLink.ts
function ownedOutputId(nodes, edges, cell) {
  const id = cell.outputNodeId;
  if (!id || !nodes.some((n) => n.id === id && n.type === "cell"))
    return void 0;
  if (edges.some((e) => e.fromNode === cell.id && e.toNode === id))
    return id;
  return nodes.some((n) => n.type === "code" && n.id !== cell.id && n.outputNodeId === id) ? void 0 : id;
}

// src/shared/canvasMerge.ts
function same(a, b) {
  if (a === b)
    return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
    return false;
  if (Array.isArray(a) !== Array.isArray(b))
    return false;
  if (Array.isArray(a)) {
    const bb = b;
    if (a.length !== bb.length)
      return false;
    for (let i = 0; i < a.length; i++)
      if (!same(a[i], bb[i]))
        return false;
    return true;
  }
  const ao = a, bo = b;
  let na = 0;
  for (const k in ao) {
    if (ao[k] === void 0)
      continue;
    na++;
    if (!same(ao[k], bo[k]))
      return false;
  }
  let nb = 0;
  for (const k in bo)
    if (bo[k] !== void 0)
      nb++;
  return na === nb;
}
function pick(b, o, t) {
  if (same(o, t) || same(o, b))
    return { v: t, kept: false };
  if (same(t, b))
    return { v: o, kept: true };
  return { v: t, kept: false };
}
function mergeItem(b, o, t) {
  if (same(o, t) || same(o, b))
    return { v: t, kept: false };
  if (same(t, b))
    return { v: o, kept: true };
  if (!b || !o || !t)
    return { v: t, kept: false };
  const bo = b, oo = o, to = t;
  const out = {};
  let kept = false;
  for (const k of /* @__PURE__ */ new Set([...Object.keys(to), ...Object.keys(oo)])) {
    const r = pick(bo[k], oo[k], to[k]);
    if (r.v !== void 0)
      out[k] = r.v;
    kept ||= r.kept;
  }
  return { v: out, kept };
}
var byId2 = (xs) => new Map(xs.map((x) => [x.id, x]));
function listDelta(b, t) {
  const bm = byId2(b), tm = byId2(t);
  const d = /* @__PURE__ */ new Map();
  for (const x of t) {
    const bx = bm.get(x.id);
    if (!bx || !same(bx, x))
      d.set(x.id, x);
  }
  for (const x of b)
    if (!tm.has(x.id))
      d.set(x.id, void 0);
  return d;
}
function applyListDelta(b, o, d, wantKept) {
  const bm = byId2(b);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  let kept = false;
  for (const x of o) {
    seen.add(x.id);
    if (d.has(x.id)) {
      const r = mergeItem(bm.get(x.id), x, d.get(x.id));
      if (r.v)
        out.push(r.v);
      kept ||= r.kept;
    } else {
      out.push(x);
      if (wantKept && !kept)
        kept = !same(bm.get(x.id), x);
    }
  }
  for (const [id, tx] of d) {
    if (seen.has(id) || !tx)
      continue;
    const r = mergeItem(bm.get(id), void 0, tx);
    if (r.v)
      out.push(r.v);
    kept ||= r.kept;
  }
  if (wantKept && !kept) {
    for (const x of b)
      if (!seen.has(x.id) && !d.has(x.id)) {
        kept = true;
        break;
      }
  }
  return { v: out, kept };
}
function mergeList(b, o, t) {
  if (b === void 0 && o === void 0 && t === void 0)
    return { v: void 0, kept: false };
  const r = applyListDelta(b ?? [], o ?? [], listDelta(b ?? [], t ?? []), true);
  return t === void 0 && r.v.length === 0 && !r.kept ? { v: void 0, kept: false } : r;
}
var LIST_KEYS = /* @__PURE__ */ new Set(["sections", "kernels"]);
function mergeMetadata(b, o, t) {
  if (same(o, t) || same(o, b))
    return { v: t, kept: false };
  if (same(t, b))
    return { v: o, kept: true };
  const out = {};
  let kept = false;
  for (const k of /* @__PURE__ */ new Set([...Object.keys(t ?? {}), ...Object.keys(o ?? {})])) {
    const r = LIST_KEYS.has(k) ? mergeList(b?.[k], o?.[k], t?.[k]) : pick(b?.[k], o?.[k], t?.[k]);
    if (r.v !== void 0)
      out[k] = r.v;
    kept ||= r.kept;
  }
  return { v: out, kept };
}
function merge3(base, ours, theirs) {
  const b = base, o = ours, t = theirs;
  const out = {};
  let kept = false;
  for (const k of /* @__PURE__ */ new Set([...Object.keys(t), ...Object.keys(o)])) {
    let r;
    if (k === "nodes" || k === "edges")
      r = mergeList(b[k], o[k], t[k]);
    else if (k === "metadata")
      r = mergeMetadata(b[k], o[k], t[k]);
    else if (k === "creationCounter") {
      const ov = typeof o[k] === "number" ? o[k] : -Infinity;
      const tv = typeof t[k] === "number" ? t[k] : -Infinity;
      r = { v: Math.max(ov, tv) === -Infinity ? void 0 : Math.max(ov, tv), kept: ov > tv };
    } else
      r = pick(b[k], o[k], t[k]);
    if (r.v !== void 0)
      out[k] = r.v;
    kept ||= r.kept;
  }
  out.nodes ??= [];
  out.edges ??= [];
  const merged = out;
  const canvas = tidy(merged, labelsOf(theirs.nodes));
  return { canvas, kept: canvas === merged ? kept : !same(byIdOrder(canvas), byIdOrder(theirs)) };
}
function byIdOrder(c) {
  const sort = (xs) => xs && [...xs].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const m = c.metadata;
  return { ...c, nodes: sort(c.nodes) ?? [], edges: sort(c.edges) ?? [], ...m ? { metadata: { ...m, sections: sort(m.sections), kernels: sort(m.kernels) } } : {} };
}
var labelsOf = (nodes) => new Map(nodes.map((n) => [n.id, n.nodeLabel]));
function tidyParts(nodes, edges, sections) {
  const ids = new Set(nodes.map((n) => n.id));
  const keptEdges = edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
  const nextNodes = nodes.some((n) => n.outputNodeId && !ids.has(n.outputNodeId)) ? nodes.map((n) => {
    const oid = n.outputNodeId;
    if (!oid || ids.has(oid))
      return n;
    const { outputNodeId: _gone, ...rest } = n;
    return rest;
  }) : nodes;
  const nextSections = sections?.some((s) => s.folded?.some((id) => !ids.has(id))) ? sections.map((s) => s.folded?.some((id) => !ids.has(id)) ? { ...s, folded: s.folded.filter((id) => ids.has(id)) } : s) : sections;
  return { nodes: nextNodes, edges: keptEdges.length === edges.length ? edges : keptEdges, sections: nextSections };
}
function uniqueLabels(nodes, fileLabels) {
  const holderOf = /* @__PURE__ */ new Map();
  for (const [id, label] of fileLabels)
    if (label && !holderOf.has(label))
      holderOf.set(label, id);
  const keeps = /* @__PURE__ */ new Set();
  const used = /* @__PURE__ */ new Set();
  for (const n of nodes) {
    if (n.nodeLabel && holderOf.get(n.nodeLabel) === n.id && !used.has(n.nodeLabel)) {
      keeps.add(n);
      used.add(n.nodeLabel);
    }
  }
  const taken = /* @__PURE__ */ new Set([...holderOf.keys(), ...nodes.map((n) => n.nodeLabel ?? "")]);
  let changed = false;
  const out = nodes.map((n) => {
    if (!n.nodeLabel || keeps.has(n))
      return n;
    const holder = holderOf.get(n.nodeLabel);
    if (!used.has(n.nodeLabel) && (holder === void 0 || holder === n.id)) {
      used.add(n.nodeLabel);
      return n;
    }
    changed = true;
    const label = nextLabel(nodeLabelPrefix(n), /* @__PURE__ */ new Set([...taken, ...used]));
    used.add(label);
    return { ...n, nodeLabel: label };
  });
  return changed ? out : nodes;
}
function tidy(c, fileLabels) {
  const nodes = uniqueLabels(c.nodes, fileLabels);
  const parts = tidyParts(nodes, c.edges, c.metadata?.sections);
  let metadata = c.metadata;
  if (parts.sections !== c.metadata?.sections)
    metadata = { ...metadata, sections: parts.sections };
  const kernelIds = /* @__PURE__ */ new Set([...(metadata?.kernels ?? []).map((k) => k.id), ...parts.nodes.filter((n) => n.type === "kernel").map((n) => n.id)]);
  if (metadata?.sections?.some((s) => s.kernelId && !kernelIds.has(s.kernelId))) {
    metadata = {
      ...metadata,
      sections: metadata.sections.map((s) => {
        if (!s.kernelId || kernelIds.has(s.kernelId))
          return s;
        const { kernelId: _gone, ...rest } = s;
        return rest;
      })
    };
  }
  if (nodes === c.nodes && parts.nodes === c.nodes && parts.edges === c.edges && metadata === c.metadata)
    return c;
  return { ...c, nodes: parts.nodes, edges: parts.edges, ...metadata ? { metadata } : {} };
}

// src/extension/canvasLock.ts
var fs = __toESM(require("fs/promises"));
var os = __toESM(require("os"));
var path2 = __toESM(require("path"));
var import_crypto = require("crypto");
var LOCK_WAIT_MS = 15e3;
var LOCK_STALE_MS = 1e4;
var LOCK_HEARTBEAT_MS = 1e3;
var BREAK_STALE_MS = 2e3;
var CanvasLockTimeout = class extends Error {
};
var CanvasLockLost = class extends Error {
  constructor() {
    super(...arguments);
    this.name = "CanvasLockLost";
  }
};
var lockWasLost = (e) => e?.name === "CanvasLockLost";
async function lockPathFor(fsPath) {
  const abs = path2.resolve(fsPath);
  try {
    return `${await fs.realpath(abs)}.lock`;
  } catch {
    let dir = path2.dirname(abs);
    try {
      dir = await fs.realpath(dir);
    } catch {
    }
    return `${path2.join(dir, path2.basename(abs))}.lock`;
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
async function inspectLock(lock) {
  try {
    const st = await fs.stat(lock);
    const raw = await fs.readFile(lock, "utf-8");
    let holder = null;
    try {
      holder = JSON.parse(raw);
    } catch {
    }
    return { raw, holder, mtime: st.mtimeMs };
  } catch {
    return null;
  }
}
function stale(l, staleMs, now) {
  if (now - l.mtime > staleMs)
    return true;
  return !!l.holder && l.holder.host === os.hostname() && !alive(l.holder.pid);
}
var sameFile = (a, b) => !!a && a.raw === b.raw && a.mtime === b.mtime;
async function breakStale(lock, seen, token) {
  const brk = `${lock}.break`;
  try {
    await (await fs.open(brk, "wx")).close();
  } catch (e) {
    if (e.code !== "EEXIST")
      return false;
    try {
      const st = await fs.stat(brk);
      if (Date.now() - st.mtimeMs > BREAK_STALE_MS)
        await fs.rm(brk, { force: true });
    } catch {
    }
    return false;
  }
  try {
    const now = await inspectLock(lock);
    if (!now)
      return true;
    if (!sameFile(now, seen))
      return false;
    const aside = `${lock}.${token}.broken`;
    try {
      await fs.rename(lock, aside);
    } catch {
      return true;
    }
    if (!sameFile(await inspectLock(aside), seen)) {
      await fs.link(aside, lock).catch(() => void 0);
      await fs.rm(aside, { force: true });
      return false;
    }
    await fs.rm(aside, { force: true });
    return true;
  } finally {
    await fs.rm(brk, { force: true });
  }
}
function describe(h) {
  return h ? `${h.by} (pid ${h.pid} on ${h.host}, since ${new Date(h.at).toISOString()})` : "an unknown writer";
}
async function withCanvasLock(fsPath, by, fn, opts = {}) {
  const waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const heartbeatMs = opts.heartbeatMs ?? LOCK_HEARTBEAT_MS;
  const lock = await lockPathFor(fsPath);
  const token = `${process.pid}-${(0, import_crypto.randomUUID)()}`;
  const deadline = Date.now() + waitMs;
  for (let pause = 2; ; pause = Math.min(pause * 2, 50)) {
    try {
      const h = await fs.open(lock, "wx");
      try {
        const me = { pid: process.pid, host: os.hostname(), at: Date.now(), by, token };
        await h.writeFile(JSON.stringify(me));
      } finally {
        await h.close();
      }
      break;
    } catch (e) {
      if (e.code !== "EEXIST")
        throw e;
    }
    const seen = await inspectLock(lock);
    if (seen && stale(seen, staleMs, Date.now()) && await breakStale(lock, seen, token))
      continue;
    if (Date.now() >= deadline) {
      throw new CanvasLockTimeout(`${path2.basename(fsPath)} is locked by ${describe(seen?.holder ?? null)}; waited ${waitMs} ms, nothing written`);
    }
    await new Promise((r) => setTimeout(r, pause));
  }
  const ours = async () => (await inspectLock(lock))?.holder?.token === token;
  const beat = setInterval(() => {
    void (async () => {
      if (!await ours())
        return;
      const t = /* @__PURE__ */ new Date();
      await fs.utimes(lock, t, t).catch(() => void 0);
    })();
  }, heartbeatMs);
  beat.unref?.();
  const held = async () => {
    if (!await ours())
      throw new CanvasLockLost(`the lock on ${path2.basename(fsPath)} was taken over; nothing written`);
  };
  try {
    return await fn(held);
  } finally {
    clearInterval(beat);
    if (await ours())
      await fs.rm(lock, { force: true });
  }
}

// src/extension/canvas-io.ts
var fs2 = __toESM(require("fs/promises"));
var path3 = __toESM(require("path"));
var os2 = __toESM(require("os"));
function expandHome(p) {
  return p.startsWith("~/") ? path3.join(os2.homedir(), p.slice(2)) : p;
}
async function writeCanvasJson(fsPath, json, held) {
  const target = await fs2.realpath(expandHome(fsPath)).catch(() => expandHome(fsPath));
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.${(++tmpSeq).toString(36)}.tmp`;
  try {
    await fs2.writeFile(tmp, json, "utf-8");
    await held?.();
    await fs2.rename(tmp, target);
  } catch (e) {
    await fs2.rm(tmp, { force: true });
    throw e;
  }
}
var tmpSeq = 0;
var CanvasExists = class extends Error {
};
async function createCanvasJson(fsPath, json) {
  const target = expandHome(fsPath);
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.${(++tmpSeq).toString(36)}.tmp`;
  try {
    await fs2.writeFile(tmp, json, "utf-8");
    await fs2.link(tmp, target).catch((e) => {
      throw e.code === "EEXIST" ? new CanvasExists(`${path3.basename(target)} already exists`) : e;
    });
  } finally {
    await fs2.rm(tmp, { force: true });
  }
}

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// src/extension/jupyter/protocol.ts
function buildExecuteRequest(code, ids) {
  return {
    header: {
      msg_id: ids.msgId,
      session: ids.session,
      username: "skena",
      msg_type: "execute_request",
      version: "5.3",
      date: ids.date
    },
    parent_header: {},
    metadata: {},
    content: {
      code,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true
    },
    channel: "shell"
  };
}
function parseReply(raw) {
  const m = raw;
  const parentMsgId = m?.parent_header?.msg_id ?? null;
  const type = m?.header?.msg_type;
  const content = m?.content ?? {};
  switch (type) {
    case "stream":
      return { parentMsgId, kind: "stream", text: String(content.text ?? "") };
    case "execute_result":
      return { parentMsgId, kind: "result", data: content.data ?? {} };
    case "display_data":
      return { parentMsgId, kind: "display", data: content.data ?? {} };
    case "error": {
      const tb = Array.isArray(content.traceback) ? content.traceback.join("\n") : "";
      return { parentMsgId, kind: "error", error: tb || `${content.ename}: ${content.evalue}` };
    }
    case "status":
      return { parentMsgId, kind: "status", executionState: content.execution_state };
    case "comm_open": {
      const d = content.data ?? {};
      const state = d.state ?? {};
      return { parentMsgId, kind: "comm", comm: { id: content.comm_id, sub: "open", modelName: state._model_name, state } };
    }
    case "comm_msg": {
      const d = content.data ?? {};
      const state = d.method === "update" && d.state ? d.state : {};
      return { parentMsgId, kind: "comm", comm: { id: content.comm_id, sub: "msg", state } };
    }
    case "comm_close":
      return { parentMsgId, kind: "comm", comm: { id: content.comm_id, sub: "close" } };
    default:
      return { parentMsgId, kind: "other" };
  }
}
var RICH_MIMES = ["application/vnd.plotly.v1+json", "application/vnd.jupyter.widget-view+json", "image/png", "image/jpeg", "text/html", "application/json", "text/plain"];
function pickRich(data) {
  for (const mime of RICH_MIMES) {
    if (data[mime] != null) {
      const v = data[mime];
      return { mime, data: typeof v === "string" ? v : JSON.stringify(v) };
    }
  }
  return null;
}
function overwriteAt(line, col, s) {
  const padded = col > line.length ? line + " ".repeat(col - line.length) : line;
  return padded.slice(0, col) + s + padded.slice(col + s.length);
}
function renderStream(text) {
  const lines = [""];
  let row = 0;
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\x1B" && text[i + 1] === "[") {
      let j = i + 2;
      let num2 = "";
      while (j < text.length && text[j] >= "0" && text[j] <= "9") {
        num2 += text[j];
        j++;
      }
      const cmd = text[j];
      const n = parseInt(num2 || "1", 10);
      if (cmd === "A") {
        row = Math.max(0, row - n);
        col = 0;
        i = j;
        continue;
      }
      if (cmd === "B") {
        row += n;
        while (lines.length <= row)
          lines.push("");
        col = 0;
        i = j;
        continue;
      }
      const seq = text.slice(i, j + 1);
      lines[row] = overwriteAt(lines[row], col, seq);
      col += seq.length;
      i = j;
      continue;
    }
    if (ch === "\r") {
      col = 0;
      continue;
    }
    if (ch === "\n") {
      row++;
      col = 0;
      while (lines.length <= row)
        lines.push("");
      continue;
    }
    lines[row] = overwriteAt(lines[row], col, ch);
    col++;
  }
  return lines.join("\n");
}
function collectOutputs(replies, ourMsgId) {
  let streamText = "";
  const rich = [];
  const widgets = {};
  let status = "running";
  let error;
  let done = false;
  for (const raw of replies) {
    const p = parseReply(raw);
    if (p.kind === "comm" && p.comm) {
      const w = p.comm;
      if (w.sub === "open")
        widgets[w.id] = { modelName: String(w.modelName ?? ""), state: { ...w.state ?? {} } };
      else if (w.sub === "msg" && widgets[w.id])
        Object.assign(widgets[w.id].state, w.state ?? {});
      continue;
    }
    if (p.parentMsgId !== ourMsgId)
      continue;
    if (p.kind === "stream" && p.text)
      streamText += p.text;
    else if ((p.kind === "result" || p.kind === "display") && p.data) {
      const r = pickRich(p.data);
      if (r)
        rich.push(r);
    } else if (p.kind === "error") {
      status = "error";
      error = p.error;
    } else if (p.kind === "status" && p.executionState === "idle") {
      done = true;
      if (status !== "error")
        status = "ok";
    }
  }
  return { streamText, rich, status, error, done, widgets };
}

// src/extension/jupyter/client.ts
function restBase(hubUrl) {
  return hubUrl.replace(/\/+$/, "");
}
function wsBase(hubUrl) {
  return restBase(hubUrl).replace(/^http/, "ws");
}
async function startKernel(server, name = "python3") {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels`, {
    method: "POST",
    headers: { Authorization: `token ${server.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok)
    throw new Error(`POST /api/kernels ${res.status}`);
  const k = await res.json();
  return { id: k.id, name: k.name, state: k.execution_state ?? "starting" };
}
async function shutdownKernel(server, kernelId) {
  const res = await fetch(`${restBase(server.hubUrl)}/api/kernels/${kernelId}`, {
    method: "DELETE",
    headers: { Authorization: `token ${server.token}` }
  });
  if (!res.ok && res.status !== 404)
    throw new Error(`DELETE /api/kernels/${kernelId} ${res.status}`);
}
async function executeCell(server, kernelId, code, ids, onDelta) {
  const url = `${wsBase(server.hubUrl)}/api/kernels/${kernelId}/channels?token=${encodeURIComponent(server.token)}`;
  const ws = new wrapper_default(url, { headers: { Authorization: `token ${server.token}` } });
  const replies = [];
  return new Promise((resolve7, reject) => {
    const finish = (out) => {
      try {
        ws.close();
      } catch {
      }
      resolve7(out);
    };
    ws.on("open", () => ws.send(JSON.stringify(buildExecuteRequest(code, ids))));
    ws.on("message", (raw) => {
      try {
        replies.push(JSON.parse(raw.toString()));
        const out = collectOutputs(replies, ids.msgId);
        onDelta?.(out);
        if (out.done)
          finish(out);
      } catch {
      }
    });
    ws.on("error", (err2) => reject(err2));
    ws.on("close", () => resolve7(collectOutputs(replies, ids.msgId)));
  });
}

// src/extension/jupyter/widgets.ts
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function num(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function stripRef(ref) {
  return ref.startsWith("IPY_MODEL_") ? ref.slice("IPY_MODEL_".length) : ref;
}
function barColour(style) {
  switch (style) {
    case "success":
      return "#2ea043";
    case "info":
      return "#1f96bd";
    case "warning":
      return "#d29922";
    case "danger":
      return "#e5484d";
    default:
      return "#4cc8a0";
  }
}
function renderWidget(modelId, widgets, depth = 0) {
  if (depth > 20)
    return "";
  const w = widgets[modelId];
  if (!w)
    return "";
  const name = w.modelName || String(w.state._model_name ?? "");
  const s = w.state;
  if (name === "FloatProgressModel" || name === "IntProgressModel" || name === "ProgressModel") {
    const min = num(s.min, 0), max = num(s.max, 100), val = num(s.value, 0);
    const pct = max > min ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;
    const colour = barColour(String(s.bar_style ?? ""));
    return `<div class="skena-w-progress"><div class="skena-w-progress-fill" style="width:${(pct * 100).toFixed(1)}%;background:${colour}"></div></div>`;
  }
  if (name === "HTMLModel" || name === "LabelModel") {
    const raw = String(s.value ?? "");
    return `<span class="skena-w-label">${name === "LabelModel" ? esc(raw) : raw}</span>`;
  }
  if (name === "HBoxModel" || name === "VBoxModel") {
    const dir = name === "VBoxModel" ? "column" : "row";
    const kids = Array.isArray(s.children) ? s.children : [];
    const inner = kids.map((ref) => renderWidget(stripRef(ref), widgets, depth + 1)).join("");
    return `<div class="skena-w-box" style="display:flex;flex-direction:${dir};gap:6px;align-items:center">${inner}</div>`;
  }
  return `<span class="skena-w-unsupported">[unsupported widget: ${esc(name)}]</span>`;
}

// src/shared/outputCap.ts
var MAX_OUTPUT_HTML_BYTES = 4e5;
var MAX_OUTPUT_HTML_ROWS = 200;
var MAX_OUTPUT_TEXT_CHARS = 2e5;
function capOutputHtml(html) {
  const rows = (html.match(/<\/tr>/gi) ?? []).length;
  if (rows <= MAX_OUTPUT_HTML_ROWS && html.length <= MAX_OUTPUT_HTML_BYTES)
    return html;
  if (rows > MAX_OUTPUT_HTML_ROWS) {
    const re = /<\/tr>/gi;
    let m;
    let seen = 0;
    let cut = -1;
    while ((m = re.exec(html)) !== null) {
      if (++seen >= MAX_OUTPUT_HTML_ROWS) {
        cut = m.index + m[0].length;
        break;
      }
    }
    if (cut > 0) {
      return html.slice(0, cut) + `</tbody></table><div class="skena-out-truncated">\u26A0 output truncated \u2014 showing first ${MAX_OUTPUT_HTML_ROWS} of ${rows} rows</div>`;
    }
  }
  return html.slice(0, MAX_OUTPUT_HTML_BYTES) + `<div class="skena-out-truncated">\u26A0 output truncated \u2014 ${Math.round(html.length / 1024)} KB exceeded the ${Math.round(MAX_OUTPUT_HTML_BYTES / 1024)} KB render limit</div>`;
}
function capOutputText(text) {
  if (text.length <= MAX_OUTPUT_TEXT_CHARS)
    return text;
  return text.slice(0, MAX_OUTPUT_TEXT_CHARS) + `
\u2026 [truncated ${Math.round((text.length - MAX_OUTPUT_TEXT_CHARS) / 1024)} KB]`;
}

// src/extension/jupyter/output.ts
function esc2(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var ANSI_FG = {
  30: "#5c6370",
  31: "#e06c75",
  32: "#98c379",
  33: "#d19a66",
  34: "#61afef",
  35: "#c678dd",
  36: "#56b6c2",
  37: "#dcdfe4",
  90: "#7f848e",
  91: "#ff7a85",
  92: "#b5e890",
  93: "#e5c07b",
  94: "#7fb6ff",
  95: "#e29bef",
  96: "#68d9e6",
  97: "#ffffff"
};
function ansiToHtml(input) {
  let html = "";
  let color = null;
  let bold = false;
  const openSpan = () => {
    const st = [];
    if (color)
      st.push(`color:${color}`);
    if (bold)
      st.push("font-weight:bold");
    return st.length ? `<span style="${st.join(";")}">` : "";
  };
  const emit = (text) => {
    if (!text)
      return;
    const s = openSpan();
    html += s ? s + esc2(text) + "</span>" : esc2(text);
  };
  const apply = (codes) => {
    for (let k = 0; k < codes.length; k++) {
      const c = codes[k];
      if (c === 38 || c === 48) {
        if (codes[k + 1] === 5)
          k += 2;
        else if (codes[k + 1] === 2)
          k += 4;
        else
          k = codes.length;
      } else if (c === 0) {
        color = null;
        bold = false;
      } else if (c === 1)
        bold = true;
      else if (c === 22)
        bold = false;
      else if (c === 39)
        color = null;
      else if (ANSI_FG[c] !== void 0)
        color = ANSI_FG[c];
    }
  };
  const re = /\u001b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(input)) !== null) {
    emit(input.slice(last, m.index));
    apply(m[1] === "" ? [0] : m[1].split(";").map(Number));
    last = re.lastIndex;
  }
  emit(input.slice(last));
  return html;
}
function htmlHasVisibleContent(html) {
  if (/<(img|svg|canvas|table|video|iframe|math)\b/i.test(html))
    return true;
  const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
  return stripped.length > 0;
}
function hasVisibleOutput(out) {
  if (out.error)
    return true;
  if (out.streamText.trim().length > 0)
    return true;
  return out.rich.some((r) => {
    if (r.mime.startsWith("image/"))
      return true;
    if (r.mime === "application/vnd.plotly.v1+json")
      return true;
    if (r.mime === "application/vnd.jupyter.widget-view+json")
      return true;
    if (r.mime === "text/html")
      return htmlHasVisibleContent(r.data);
    return r.data.trim().length > 0;
  });
}
function renderOutput(out) {
  const rich = out.rich;
  const lone = rich.length === 1 && !out.error && !out.streamText;
  if (lone && rich[0].mime === "application/vnd.plotly.v1+json") {
    return { format: "plotly", content: rich[0].data };
  }
  if (lone && rich[0].mime.startsWith("image/")) {
    return { format: "image", content: `data:${rich[0].mime};base64,${rich[0].data}` };
  }
  const parts = [];
  if (out.streamText)
    parts.push(`<pre class="skena-out-stream">${ansiToHtml(renderStream(capOutputText(out.streamText)))}</pre>`);
  for (const r of rich) {
    if (r.mime.startsWith("image/")) {
      parts.push(`<img src="data:${r.mime};base64,${r.data}" style="max-width:100%;display:block;margin:6px 0" />`);
    } else if (r.mime === "text/html") {
      parts.push(`<div>${capOutputHtml(r.data)}</div>`);
    } else if (r.mime === "application/vnd.plotly.v1+json") {
      parts.push('<pre class="skena-out-note">[plotly figure \u2014 one interactive figure per cell run renders inline; multiple are listed only]</pre>');
    } else if (r.mime === "application/vnd.jupyter.widget-view+json") {
      let modelId = "";
      try {
        modelId = String(JSON.parse(r.data).model_id ?? "");
      } catch {
      }
      const html = modelId ? renderWidget(modelId, out.widgets) : "";
      parts.push(html || '<pre class="skena-out-note">[widget]</pre>');
    } else {
      parts.push(`<pre>${ansiToHtml(capOutputText(r.data))}</pre>`);
    }
  }
  if (out.error)
    parts.push(`<pre class="skena-out-error">${ansiToHtml(out.error)}</pre>`);
  return { format: "html", content: parts.join("\n") };
}

// src/extension/ipcEndpoint.ts
var fs3 = __toESM(require("fs"));
var os3 = __toESM(require("os"));
var path4 = __toESM(require("path"));
function hashPath(p) {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    h = h * 31 + p.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}
function userName() {
  try {
    return os3.userInfo().username;
  } catch {
    return "user";
  }
}
function endpointDirs(tmp) {
  const inTmp = path4.join(tmp ?? os3.tmpdir(), `skena-${userName()}`);
  const xdg = tmp ? void 0 : process.env.XDG_RUNTIME_DIR;
  return xdg ? [path4.join(xdg, "skena"), inTmp] : [inTmp];
}
var fileName = (workspaceDir) => `skena-ipc-${hashPath(path4.resolve(workspaceDir))}.json`;
function readFile3(file, workspaceDir) {
  try {
    const uid2 = process.getuid?.();
    if (uid2 !== void 0 && fs3.statSync(file).uid !== uid2)
      return null;
    const j = JSON.parse(fs3.readFileSync(file, "utf-8"));
    return typeof j.endpoint === "string" && j.workspaceDir === path4.resolve(workspaceDir) ? j.endpoint : null;
  } catch {
    return null;
  }
}
function readEndpoint(workspaceDir, tmp) {
  for (const dir of endpointDirs(tmp)) {
    const endpoint = readFile3(path4.join(dir, fileName(workspaceDir)), workspaceDir);
    if (endpoint)
      return endpoint;
  }
  return null;
}

// src/extension/mcp/exportRequest.ts
var http = __toESM(require("http"));
var UNREACHABLE = /* @__PURE__ */ new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL"]);
function postExport(port, token, body, timeoutMs) {
  return new Promise((resolve7) => {
    const data = JSON.stringify(body);
    let settled = false;
    const done = (o) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      resolve7(o);
    };
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/export",
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), "x-skena-token": token }
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        text += c;
      });
      res.on("end", () => done({ kind: "answer", status: res.statusCode ?? 0, body: text }));
      res.on("error", (e) => done({ kind: "closed", message: e.message }));
    });
    const timer = setTimeout(() => {
      done({ kind: "timeout" });
      req.destroy();
    }, timeoutMs);
    req.on("error", (e) => {
      done(e.code && UNREACHABLE.has(e.code) ? { kind: "unreachable", code: e.code } : { kind: "closed", message: e.message });
    });
    req.end(data);
  });
}

// src/extension/mcp/vaultLookup.ts
var fs4 = __toESM(require("fs"));
var http2 = __toESM(require("http"));
var path6 = __toESM(require("path"));
var import_url = require("url");

// src/extension/filePaths.ts
var path5 = __toESM(require("path"));
function vaultRoot(configured, home) {
  const expanded = configured.startsWith("~") ? path5.join(home ?? "~", configured.slice(1)) : configured;
  return path5.resolve(expanded);
}

// src/extension/mcp/vaultLookup.ts
var RELAY_WAIT_MS = 500;
var RELAY_CACHE_MS = 3e3;
var EXTENSION = "the skena extension";
var SETTINGS_LEVELS = 8;
function normaliseVaults(list, home) {
  const out = [];
  for (const v of list) {
    if (!v || typeof v !== "object")
      continue;
    const { name, path: p } = v;
    if (typeof name !== "string" || typeof p !== "string")
      continue;
    out.push({ ...v, path: vaultRoot(p, home) });
  }
  return out;
}
var listNote = (vaults) => vaults.length ? `${vaults.length} vault(s): ${vaults.map((v) => v.name).join(", ")}` : "an empty skena.vaults";
function requestRelayVaults(port, token, timeoutMs, home) {
  return new Promise((resolve7) => {
    let settled = false;
    const done = (r) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      resolve7(r);
    };
    const data = "{}";
    const req = http2.request({
      host: "127.0.0.1",
      port,
      path: "/vaults",
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), "x-skena-token": token }
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        text += c;
      });
      res.on("error", (e) => done({ kind: "none", why: e.message }));
      res.on("end", () => {
        if (res.statusCode !== 200)
          return done({ kind: "none", why: `refused (HTTP ${res.statusCode})` });
        try {
          const j = JSON.parse(text);
          if (!Array.isArray(j.vaults))
            return done({ kind: "none", why: "no vault list in its answer" });
          done({ kind: "answer", vaults: normaliseVaults(j.vaults, home) });
        } catch {
          done({ kind: "none", why: "an answer that is not JSON" });
        }
      });
    });
    const timer = setTimeout(() => {
      done({ kind: "none", why: `no answer within ${timeoutMs} ms` });
      req.destroy();
    }, timeoutMs);
    req.on("error", (e) => done({ kind: "none", why: e.code === "ECONNREFUSED" ? "nothing listening at its port" : e.message }));
    req.end(data);
  });
}
async function chooseVaults(steps) {
  const looked = [];
  for (const step of steps) {
    const s = await step();
    looked.push(s);
    if (s.vaults)
      return { vaults: s.vaults, looked };
  }
  return { vaults: [], looked };
}
function parseWorkspaceFile(raw, file, home) {
  const json = parseSettingsJson(raw);
  const folders = [];
  for (const f of Array.isArray(json.folders) ? json.folders : []) {
    const { path: p, uri } = f ?? {};
    if (typeof p === "string")
      folders.push(path6.resolve(path6.dirname(file), p));
    else if (typeof uri === "string" && uri.startsWith("file:"))
      folders.push((0, import_url.fileURLToPath)(uri));
  }
  const settings = json.settings && typeof json.settings === "object" ? json.settings : {};
  const list = settings["skena.vaults"];
  return { folders, vaults: Array.isArray(list) ? normaliseVaults(list, home) : null };
}
function spellings(p) {
  const abs = path6.resolve(p);
  try {
    const real = fs4.realpathSync(abs);
    return real === abs ? [abs] : [abs, real];
  } catch {
    return [abs];
  }
}
var inside = (file, folder) => file === folder || file.startsWith(folder + path6.sep);
function canvasSpellings(canvasPath) {
  const abs = path6.resolve(canvasPath);
  const real = spellings(path6.dirname(abs)).map((d) => path6.join(d, path6.basename(abs)));
  return [.../* @__PURE__ */ new Set([abs, ...real])];
}
function workspaceFilesIn(dir) {
  try {
    return fs4.readdirSync(dir).filter((n) => n.endsWith(".code-workspace")).sort().map((n) => path6.join(dir, n));
  } catch {
    return [];
  }
}
function findWorkspaceFile(canvasPath, starts) {
  const canvas = canvasSpellings(canvasPath);
  const seen = /* @__PURE__ */ new Set();
  for (const start of starts) {
    let dir = path6.resolve(start);
    for (; ; ) {
      if (!seen.has(dir)) {
        seen.add(dir);
        for (const file of workspaceFilesIn(dir)) {
          let folders;
          try {
            folders = parseWorkspaceFile(fs4.readFileSync(file, "utf-8"), file, void 0).folders;
          } catch {
            continue;
          }
          if (folders.some((f) => spellings(f).some((sp) => canvas.some((c) => inside(c, sp)))))
            return file;
        }
      }
      const parent = path6.dirname(dir);
      if (parent === dir)
        break;
      dir = parent;
    }
  }
  return null;
}
function readJson(file) {
  try {
    return parseSettingsJson(fs4.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}
function settingsFileSource(startDir, home) {
  let dir = path6.resolve(startDir);
  let top = dir;
  for (let i = 0; i < SETTINGS_LEVELS; i++) {
    top = dir;
    const basePath = path6.join(dir, ".vscode", "settings.json");
    const base = readJson(basePath);
    if (base !== null) {
      const localPath = path6.join(dir, ".vscode", "settings.local.json");
      const local = readJson(localPath);
      const fromLocal = Array.isArray(local?.["skena.vaults"]);
      const list = fromLocal ? local["skena.vaults"] : base["skena.vaults"];
      const vaults = Array.isArray(list) ? normaliseVaults(list, home) : null;
      return { where: fromLocal ? localPath : basePath, vaults, note: vaults ? listNote(vaults) : "no skena.vaults" };
    }
    const parent = path6.dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  return { where: ".vscode/settings.json", vaults: null, note: `none in the folders from ${path6.resolve(startDir)} up to ${top}` };
}
function workspaceFileSource(canvasPath, cwd, home) {
  const file = findWorkspaceFile(canvasPath, [path6.dirname(path6.resolve(canvasPath)), cwd]);
  if (!file)
    return { where: ".code-workspace", vaults: null, note: `no .code-workspace file above the canvas or ${cwd} lists a folder holding the canvas` };
  try {
    const { vaults } = parseWorkspaceFile(fs4.readFileSync(file, "utf-8"), file, home);
    return { where: file, vaults, note: vaults ? listNote(vaults) : "no skena.vaults in its settings" };
  } catch (e) {
    return { where: file, vaults: null, note: `not readable: ${e instanceof Error ? e.message : String(e)}` };
  }
}
var relayCache = /* @__PURE__ */ new Map();
async function relaySource(relay, now, waitMs, home) {
  if (!relay)
    return { where: EXTENSION, vaults: null, note: "no window for this workspace (no SKENA_RUN_IPC, no endpoint file)" };
  const key = `${relay.port}:${relay.token}`;
  let hit = relayCache.get(key);
  if (!hit || now - hit.at > RELAY_CACHE_MS || now < hit.at) {
    hit = { at: now, result: await requestRelayVaults(relay.port, relay.token, waitMs, home) };
    relayCache.set(key, hit);
  }
  const where = `${EXTENSION} (relay at 127.0.0.1:${relay.port})`;
  return hit.result.kind === "answer" ? { where, vaults: hit.result.vaults, note: listNote(hit.result.vaults) } : { where, vaults: null, note: hit.result.why };
}
async function loadVaults(canvasPath, opts) {
  const now = opts.now ?? Date.now();
  return chooseVaults([
    () => relaySource(opts.relay, now, opts.waitMs ?? RELAY_WAIT_MS, opts.home),
    () => settingsFileSource(path6.dirname(path6.resolve(canvasPath)), opts.home),
    () => workspaceFileSource(canvasPath, opts.cwd, opts.home)
  ]);
}
function notConfiguredText(name, lookup) {
  return [
    `(vault not configured \u2014 no "${name}" in skena.vaults. Looked at:`,
    ...lookup.looked.map((s) => `  ${s.where}: ${s.note}`),
    "Add it to skena.vaults in .vscode/settings.json, or in the settings of the .code-workspace file.)"
  ].join("\n");
}

// src/extension/mcp/server.ts
function parseRunIpc(raw) {
  if (!raw)
    return null;
  const i = raw.lastIndexOf(":");
  if (i <= 0)
    return null;
  const port = Number(raw.slice(0, i));
  const token = raw.slice(i + 1);
  return port && token ? { port, token } : null;
}
async function persistViaHost(ipc, canvasPath, payload) {
  if (!ipc)
    return { handled: false };
  try {
    const res = await fetch(`http://127.0.0.1:${ipc.port}/persist`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-skena-token": ipc.token },
      body: JSON.stringify({ canvasPath, payload })
    });
    if (!res.ok)
      return { handled: false };
    return await res.json();
  } catch {
    return { handled: false };
  }
}
function resolvePath(raw) {
  const expanded = raw.startsWith("~/") ? path7.join(os4.homedir(), raw.slice(2)) : raw;
  return path7.resolve(expanded);
}
function expandHome2(p) {
  return p.startsWith("~/") ? path7.join(os4.homedir(), p.slice(2)) : p;
}
async function resolveVaultUri(uri, canvasPath) {
  const rest = uri.slice("vault://".length);
  const slash = rest.indexOf("/");
  const name = slash === -1 ? rest : rest.slice(0, slash);
  const rel = slash === -1 ? "" : rest.slice(slash + 1);
  const lookup = await loadVaults(canvasPath, { relay: extensionRelay(canvasPath), cwd: process.cwd(), home: os4.homedir() });
  const vault = lookup.vaults.find((v) => v.name === name);
  return vault ? { fsPath: path7.join(vault.path, rel) } : { notConfigured: notConfiguredText(name, lookup) };
}
function normalizeFileUri(fileUri, canvasPath) {
  if (!fileUri || fileUri.startsWith("vault://"))
    return fileUri;
  if (!path7.isAbsolute(fileUri))
    return fileUri;
  const canvasDir = path7.dirname(canvasPath);
  const rel = path7.relative(canvasDir, fileUri).replace(/\\/g, "/");
  if (rel.startsWith(".."))
    return fileUri;
  return rel.startsWith("./") ? rel : `./${rel}`;
}
function noderefCanvasPath(target, canvasPath) {
  const abs = expandHome2(target);
  if (!path7.isAbsolute(abs))
    return target;
  const root = workspaceDirAbove(path7.dirname(canvasPath));
  const rel = root ? path7.relative(root, abs) : "";
  return rel && !rel.startsWith("..") && !path7.isAbsolute(rel) ? rel.split(path7.sep).join("/") : abs;
}
var _fileLocks = /* @__PURE__ */ new Map();
function withFileLock(fsPath, fn) {
  const prev = _fileLocks.get(fsPath) ?? Promise.resolve();
  const run = () => {
    _lastText.delete(fsPath);
    _lastOurs.delete(fsPath);
    return fn();
  };
  const next = prev.then(run, run);
  _fileLocks.set(fsPath, next.then(() => {
  }, () => {
  }));
  return next;
}
var _lastText = /* @__PURE__ */ new Map();
var _lastOurs = /* @__PURE__ */ new Map();
async function readCanvas(fsPath) {
  const raw = await fs5.readFile(fsPath, "utf-8");
  const data = canvasFromText(raw);
  _lastText.set(fsPath, raw);
  _lastOurs.set(fsPath, raw);
  return data;
}
function canvasFromText(raw) {
  const parsed = JSON.parse(raw);
  const data = {
    ...parsed,
    nodes: parsed.nodes ?? [],
    edges: parsed.edges ?? []
  };
  data.nodes = ensureLabels(data.nodes);
  data.edges = markKeepRowOnLoad(data.nodes, data.metadata?.sections ?? [], data.edges);
  return data;
}
function holdSection(d, edge) {
  return sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], edge.toNode) ?? toEngineNodes(d.nodes);
}
async function writeCanvas(fsPath, data) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await writeCanvasLocked(fsPath, data);
    } catch (e) {
      if (!lockWasLost(e) || attempt >= 3)
        throw e;
    }
  }
}
async function writeCanvasLocked(fsPath, data) {
  const out = await withCanvasLock(fsPath, "mcp", async (held) => {
    let merged = data;
    const lastText = _lastText.get(fsPath), lastOurs = _lastOurs.get(fsPath);
    if (lastText !== void 0 && lastOurs !== void 0) {
      try {
        const ours = lastOurs === lastText ? data : merge3(canvasFromText(lastOurs), data, canvasFromText(lastText)).canvas;
        const now = await fs5.readFile(fsPath, "utf-8").catch(() => null);
        merged = now !== null && now !== lastText ? merge3(canvasFromText(lastText), ours, canvasFromText(now)).canvas : ours;
      } catch {
      }
    }
    const json = JSON.stringify(merged, null, 2);
    await writeCanvasJson(fsPath, json, held);
    _lastText.set(fsPath, json);
    _lastOurs.set(fsPath, merged === data ? json : JSON.stringify(data, null, 2));
    return merged;
  });
  if (out !== data) {
    const written = new Map(out.nodes.map((n) => [n.id, n.nodeLabel]));
    for (const n of data.nodes) {
      const label = written.get(n.id);
      if (label !== void 0 && label !== n.nodeLabel)
        n.nodeLabel = label;
    }
  }
}
async function readCanvasOrEmpty(fsPath) {
  try {
    return await readCanvas(fsPath);
  } catch (e) {
    if (e.code === "ENOENT")
      return { nodes: [], edges: [] };
    throw e;
  }
}
var ID_OVER_LABEL = "A label can pass to another node when another writer (the open editor) adds one at the same moment; an id never changes, so name a node this session created by the id its reply printed.";
function findNode(data, ref) {
  const labelled = data.nodes.filter((n) => n.nodeLabel === ref);
  if (labelled.length > 1)
    throw new Error(`${ref} is the label of ${labelled.length} nodes (ids ${labelled.map((n) => n.id).join(", ")}): name the node by its id`);
  return labelled[0] ?? data.nodes.find((n) => n.id === ref);
}
function findEdge(data, ref) {
  if (typeof ref === "string")
    return data.edges.find((e) => e.id === ref);
  if (ref && typeof ref === "object") {
    const r = ref;
    const fromId = r.from ? findNode(data, r.from)?.id : void 0;
    const toId = r.to ? findNode(data, r.to)?.id : void 0;
    if (fromId === void 0 && toId === void 0)
      return void 0;
    return data.edges.find((e) => (fromId === void 0 || e.fromNode === fromId) && (toId === void 0 || e.toNode === toId));
  }
  return void 0;
}
function nodeSnippet(node) {
  switch (node.type) {
    case "text":
      return truncate(node.text.replace(/\n/g, " "), 80);
    case "file":
      return node.file;
    case "link":
      return node.url;
    case "group":
      return node.label ? `"${node.label}"` : "(unnamed group)";
    case "cell":
      return `${node.format} (${node.content.length} chars)`;
    case "code":
      return truncate((node.code ?? "").replace(/\n/g, " "), 80) || "(empty code cell)";
    case "kernel":
      return `kernel: ${node.displayName ?? node.server}${node.kernelId ? " (live)" : ""}`;
    case "chat":
      return `${node.agent}: ${node.title}`;
    case "portal":
      return `\u2192 ${node.canvas}`;
    case "noderef":
      return `\u2192 ${node.canvas}#${node.label}${isSectionLabel(node.label) ? " (section)" : ""}${node.title ? ` "${node.title}"` : ""}`;
    case "knowledge":
      return truncate(node.title, 80);
    default:
      return "(unknown)";
  }
}
function typeLabel(node) {
  if (node.type === "group")
    return "group (not shown)";
  if (node.type === "file") {
    const f = node.file.toLowerCase();
    if (f.endsWith(".ipynb"))
      return "notebook";
    if (f.endsWith(".md"))
      return "markdown";
    if (f.endsWith(".py"))
      return "python";
    if (f.endsWith(".yaml") || f.endsWith(".yml"))
      return "yaml";
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(f))
      return "image";
    return "file";
  }
  return node.type;
}
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
}
function nowLabel() {
  const d = /* @__PURE__ */ new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${min}`;
}
function stampLabel(ms) {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${min}`;
}
function uid() {
  return `ai-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}
function autoPlace(all, w, h) {
  const nodes = all.filter((n) => !isGroup(n));
  if (nodes.length === 0)
    return { x: 100, y: 100 };
  const GAP = 60;
  const rightmost = Math.max(...nodes.map((n) => n.x + n.width));
  const midY = (Math.min(...nodes.map((n) => n.y)) + Math.max(...nodes.map((n) => n.y + n.height))) / 2;
  return { x: Math.round(rightmost + GAP), y: Math.round(midY - h / 2) };
}
var CAPPED_NOTE = "some overlaps could not be resolved; run canvas_reflow_section";
function applyEngine(d, movers, holes = [], report, anchor) {
  const own = /* @__PURE__ */ new Map();
  const lanes = d.metadata?.sections ?? [];
  if (lanes.length === 0)
    return own;
  const derived = deriveLanes(d.nodes, lanes);
  const home = anchor ? derived.find((l) => l.memberIds.includes(anchor.id)) : void 0;
  const joined = new Set(home && anchor ? anchor.joining.filter((id) => !home.memberIds.includes(id)) : []);
  const jobs = [];
  const take = (laneId) => {
    const lane = derived.find((l) => l.id === laneId);
    if (!lane)
      return null;
    const ids = lane.memberIds.filter((id) => !joined.has(id));
    if (lane.id === home?.id)
      ids.push(...joined);
    for (const id of ids)
      own.set(id, lane.index);
    return new Set(ids);
  };
  const byLane = /* @__PURE__ */ new Map();
  for (const id of movers) {
    const lane = joined.has(id) ? home : derived.find((l) => l.memberIds.includes(id));
    if (!lane)
      continue;
    const list = byLane.get(lane.id);
    if (list)
      list.push(id);
    else
      byLane.set(lane.id, [id]);
  }
  for (const [laneId, moverIds] of byLane) {
    const members = take(laneId);
    if (members)
      jobs.push({ members, moverIds });
  }
  for (const h of holes) {
    const members = take(h.sectionId);
    if (members)
      jobs.push({ members, columnX: h.columnX });
  }
  for (const job of jobs) {
    const members = toEngineNodes(d.nodes.filter((n) => job.members.has(n.id)));
    const patches = layoutSection(members, { moverIds: job.moverIds, columnX: job.columnX, riders: ridersOf(members, d.edges), hanging: hangingBelow(members, d.edges), report });
    if (Object.keys(patches).length === 0)
      continue;
    d.nodes = applyPatchesToCanvas(d.nodes, patches);
  }
  return own;
}
function geomOf(d) {
  return new Map(d.nodes.map((n) => [n.id, `${n.x},${n.y}`]));
}
function movedLabels(d, before, exclude = []) {
  return d.nodes.filter((n) => !exclude.includes(n.id) && before.has(n.id) && before.get(n.id) !== `${n.x},${n.y}`).map((n) => n.nodeLabel ?? n.id);
}
var CELL_SIZE = { w: 480, h: 320 };
var NODEREF_SIZE = { w: 200, h: 120 };
var CODE_HEIGHT_RANGE = `${CODE_MIN_H} to ${CODE_MAX_H} px in ${CODE_H_STEP} px steps`;
var KERNEL_SERVERS_TEXT = `Jupyter servers are looked up on every call, and the first non-empty list wins: SKENA_JUPYTER_KERNELS (set when the canvas AI companion starts this server); then skena.jupyter.kernels in .vscode/settings.local.json and then .vscode/settings.json of the nearest folder above the canvas that has a .vscode directory, then of the one above this server's working directory; then JUPYTER_SERVER_URL + JUPYTER_API_TOKEN from the environment, as a server named "default". An unknown server name is answered with the names found and where they came from, or with every place looked in.`;
var ADD_NODE_TYPES = ["text", "code", "cell", "file", "link", "portal", "noderef"];
function defaultDims(type, url) {
  switch (type) {
    case "code":
      return NODE_SIZE.code;
    case "cell":
      return CELL_SIZE;
    case "file":
      return NODE_SIZE.file;
    case "link":
      return url && youtubeId(url) ? YOUTUBE_NODE : NODE_SIZE.link;
    case "portal":
      return NODE_SIZE.portal;
    case "noderef":
      return NODEREF_SIZE;
    default:
      return NODE_SIZE.text;
  }
}
var BINARY_EXTS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf", ".zip", ".7z"]);
var MAX_READ_BYTES = 64 * 1024;
async function readFileNodeContent(uri, canvasPath) {
  let fsPath;
  if (uri.startsWith("vault://")) {
    const resolved = await resolveVaultUri(uri, canvasPath);
    if ("notConfigured" in resolved)
      return `vault URI: ${uri}
${resolved.notConfigured}`;
    fsPath = resolved.fsPath;
  } else if (path7.isAbsolute(uri)) {
    fsPath = uri;
  } else {
    fsPath = path7.resolve(path7.dirname(canvasPath), uri);
  }
  const header = `File: ${fsPath}`;
  const ext = path7.extname(fsPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return `${header}
(binary file \u2014 content not shown)`;
  }
  try {
    const stat3 = await fs5.stat(fsPath);
    if (stat3.size > MAX_READ_BYTES) {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const fd = await fs5.open(fsPath, "r");
      try {
        const { bytesRead } = await fd.read(buf, 0, MAX_READ_BYTES, 0);
        let text2 = buf.slice(0, bytesRead).toString("utf-8");
        const lastNl = text2.lastIndexOf("\n");
        if (lastNl > 0)
          text2 = text2.slice(0, lastNl + 1);
        return `${header}
(truncated \u2014 showing first ${MAX_READ_BYTES / 1024} KB of ${Math.round(stat3.size / 1024)} KB)

${text2}`;
      } finally {
        await fd.close();
      }
    }
    const text = await fs5.readFile(fsPath, "utf-8");
    return `${header}

${text}`;
  } catch (e) {
    return `${header}
(error reading file: ${e})`;
  }
}
function outputLinks(d) {
  const byId3 = new Map(d.nodes.map((n) => [n.id, n]));
  const output = /* @__PURE__ */ new Map(), outputOf = /* @__PURE__ */ new Map();
  for (const n of d.nodes) {
    if (n.type !== "code")
      continue;
    const o = byId3.get(ownedOutputId(d.nodes, d.edges, n) ?? "");
    if (!o)
      continue;
    output.set(n.id, o);
    outputOf.set(o.id, n);
  }
  return { output, outputOf };
}
async function canvasList(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const lines = [
    `Canvas: ${p}`,
    `${d.nodes.length} node(s), ${d.edges.length} edge(s)`,
    "",
    "Nodes:"
  ];
  const links = outputLinks(d);
  for (const n of d.nodes) {
    const ext = n;
    const aiMark = ext.createdBy === "ai" ? " \u{1F916}" : "";
    const tags = ext.tags?.length ? `  [${ext.tags.join(", ")}]` : "";
    const out = links.output.get(n.id), of = links.outputOf.get(n.id);
    const link3 = out ? `  (output: ${out.nodeLabel ?? out.id})` : of ? `  (output of: ${of.nodeLabel ?? of.id})` : "";
    lines.push(`  ${(n.nodeLabel ?? n.id).padEnd(4)}  ${typeLabel(n).padEnd(10)}  ${nodeSnippet(n)}${aiMark}${tags}${link3}`);
  }
  if (d.metadata?.sections?.length) {
    lines.push("", "Sections:");
    for (const l of deriveLanes(d.nodes, d.metadata.sections)) {
      const kRec = l.kernelId ? kernelById(d, l.kernelId) : null;
      const kernel = kRec ? kRec.displayName ?? kRec.nodeLabel ?? kRec.id : "-";
      const title = l.title ? `"${l.title}"` : `(untitled, ${stampLabel(l.createdAt)})`;
      const fold = l.folded ? " folded" : "";
      lines.push(`  ${l.label.padEnd(4)}${`y=${l.top}`.padEnd(8)}${`kernel=${kernel}`.padEnd(11)}${title}${fold} nodes=${l.memberIds.length}`);
    }
  }
  if (d.metadata?.kernels?.length) {
    lines.push("", "Kernels:");
    for (const k of d.metadata.kernels) {
      const live = k.kernelId ? k.kernelId.slice(0, 8) : "-";
      lines.push(`  ${k.id.padEnd(11)}${(k.displayName ?? "-").padEnd(12)}${`server=${k.server}`.padEnd(16)}live=${live}`);
    }
  }
  if (d.edges.length > 0) {
    lines.push("", "Edges:");
    const labelMap = new Map(d.nodes.map((n) => [n.id, n.nodeLabel ?? n.id.slice(0, 8)]));
    for (const e of d.edges) {
      const from = labelMap.get(e.fromNode) ?? e.fromNode;
      const to = labelMap.get(e.toNode) ?? e.toNode;
      const lbl = e.label ? `  "${e.label}"` : "";
      lines.push(`  ${from} \u2192 ${to}${lbl}`);
    }
  }
  return lines.join("\n");
}
async function canvasRead(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref);
  if (!n)
    return `Node not found: ${args.ref}`;
  const labelMap = new Map(d.nodes.map((nd) => [nd.id, nd.nodeLabel ?? nd.id.slice(0, 8)]));
  const outgoing = d.edges.filter((e) => e.fromNode === n.id).map((e) => `\u2192 ${labelMap.get(e.toNode) ?? e.toNode}${e.label ? ` "${e.label}"` : ""}`);
  const incoming = d.edges.filter((e) => e.toNode === n.id).map((e) => `\u2190 ${labelMap.get(e.fromNode) ?? e.fromNode}${e.label ? ` "${e.label}"` : ""}`);
  const meta = [
    `Node ${n.nodeLabel ?? "?"} (id: ${n.id})`,
    `Type: ${typeLabel(n)}`
  ];
  const ext = n;
  if (ext.createdBy)
    meta.push(`Created by: ${ext.createdBy}`);
  if (ext.tags?.length)
    meta.push(`Tags: [${ext.tags.join(", ")}]`);
  meta.push(`Position: (${n.x}, ${n.y})  Size: ${n.width}\xD7${n.height}`);
  const lane = deriveLanes(d.nodes, d.metadata?.sections ?? []).find((l) => l.memberIds.includes(n.id));
  if (lane)
    meta.push(`Section: ${lane.label}${lane.folded?.includes(n.id) ? " hidden (folded)" : ""}`);
  const links = outputLinks(d);
  const out = links.output.get(n.id), of = links.outputOf.get(n.id);
  if (out)
    meta.push(`Output: ${out.nodeLabel ?? "?"} (id: ${out.id})`);
  if (of)
    meta.push(`Output of: ${of.nodeLabel ?? "?"} (id: ${of.id})`);
  if (incoming.length || outgoing.length) {
    meta.push(`Connections: ${[...incoming, ...outgoing].join("  ")}`);
  }
  let content = "";
  switch (n.type) {
    case "text":
      content = n.text;
      break;
    case "file":
      content = await readFileNodeContent(n.file, p);
      break;
    case "link":
      content = `URL: ${n.url}`;
      break;
    case "group":
      content = `Label: ${n.label ?? "(none)"}`;
      break;
    case "cell":
      content = `Format: ${n.format}

${n.content}`;
      break;
    case "code":
      content = `Language: ${n.language ?? "python"}  Status: ${n.lastStatus ?? "never run"}

${n.code ?? ""}`;
      break;
    case "kernel":
      content = `Kernel: ${n.displayName ?? "kernel"}  Server: ${n.server}  ${n.kernelId ? `Live id: ${n.kernelId}` : "(not started)"}`;
      break;
    case "chat":
      content = `Agent: ${n.agent}  Model: ${n.model ?? "default"}
Title: ${n.title}`;
      break;
    case "portal":
      content = `Sub-canvas: ${n.canvas}`;
      break;
    case "noderef":
      content = `Reference: ${n.canvas}#${n.label}${isSectionLabel(n.label) ? " (section)" : ""}${n.title ? `
Title: ${n.title}` : ""}`;
      break;
    case "knowledge":
      content = `Format: knowledge
Server: ${n.server}
Source: ${n.uri}
Fetched: ${n.fetchedAt}${n.error ? `
Last refresh failed: ${n.error}` : ""}

${n.text}`;
      break;
  }
  return [
    ...meta,
    "",
    "\u2500".repeat(60),
    content,
    "\u2500".repeat(60)
  ].join("\n");
}
async function canvasSearch(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const query = args.query.toLowerCase();
  const type = args.type;
  const results = [];
  for (const n of d.nodes) {
    if (type && n.type !== type)
      continue;
    const haystack = [
      n.nodeLabel ?? "",
      n.tags?.join(" ") ?? "",
      n.type === "text" ? n.text : "",
      n.type === "file" ? n.file : "",
      n.type === "link" ? n.url : "",
      n.type === "group" ? n.label ?? "" : "",
      n.type === "cell" ? n.content : "",
      n.type === "code" ? n.code ?? "" : "",
      n.type === "chat" ? n.title : "",
      n.type === "portal" ? n.canvas : "",
      n.type === "knowledge" ? `${n.title} ${n.text}` : "",
      d.edges.filter((e) => e.fromNode === n.id || e.toNode === n.id).map((e) => e.label ?? "").join(" ")
    ].join(" ").toLowerCase();
    if (haystack.includes(query))
      results.push(n);
  }
  if (results.length === 0)
    return `No nodes match "${args.query}"`;
  const lines = [`Found ${results.length} node(s) matching "${args.query}":`, ""];
  for (const n of results) {
    lines.push(`  ${(n.nodeLabel ?? n.id).padEnd(4)}  ${typeLabel(n).padEnd(10)}  ${nodeSnippet(n)}`);
  }
  return lines.join("\n");
}
async function canvasEdges(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref);
  if (!n)
    return `Node not found: ${args.ref}`;
  const labelMap = new Map(d.nodes.map((nd) => [nd.id, nd.nodeLabel ?? nd.id.slice(0, 8)]));
  const lines = [`Edges for ${n.nodeLabel ?? n.id}:`, ""];
  const out = d.edges.filter((e) => e.fromNode === n.id);
  const inn = d.edges.filter((e) => e.toNode === n.id);
  if (!out.length && !inn.length)
    return `No edges for ${n.nodeLabel ?? n.id}`;
  for (const e of inn)
    lines.push(`  \u2190  ${(labelMap.get(e.fromNode) ?? e.fromNode).padEnd(6)}  ${e.label ? `"${e.label}"` : "(no label)"}  [${e.fromSide ?? "?"} \u2192 ${e.toSide ?? "?"}]`);
  for (const e of out)
    lines.push(`  \u2192  ${(labelMap.get(e.toNode) ?? e.toNode).padEnd(6)}  ${e.label ? `"${e.label}"` : "(no label)"}  [${e.fromSide ?? "?"} \u2192 ${e.toSide ?? "?"}]`);
  return lines.join("\n");
}
async function canvasFollow(args) {
  const p = resolvePath(args.canvasPath);
  const d = await readCanvas(p);
  const n = findNode(d, args.ref);
  if (!n)
    return `Node not found: ${args.ref}`;
  if (n.type === "file") {
    if (n.file.startsWith("vault://")) {
      const resolved = await resolveVaultUri(n.file, p);
      if ("notConfigured" in resolved)
        return `Vault URI: ${n.file}
${resolved.notConfigured}`;
      return `File path: ${resolved.fsPath}
Vault URI: ${n.file}`;
    }
    const abs = path7.isAbsolute(n.file) ? n.file : path7.resolve(path7.dirname(p), n.file);
    return `File path: ${abs}`;
  }
  if (n.type === "portal") {
    if (n.canvas.startsWith("vault://")) {
      const resolved = await resolveVaultUri(n.canvas, p);
      if ("notConfigured" in resolved)
        return `Vault URI: ${n.canvas}
${resolved.notConfigured}`;
      return `Sub-canvas path: ${resolved.fsPath}
Vault URI: ${n.canvas}`;
    }
    const abs = path7.isAbsolute(n.canvas) ? n.canvas : path7.resolve(path7.dirname(p), n.canvas);
    return `Sub-canvas path: ${abs}`;
  }
  if (n.type === "link") {
    return `URL: ${n.url}`;
  }
  return `Node ${n.nodeLabel ?? n.id} (${n.type}) is not a file, portal, or link node`;
}
async function canvasAddNode(args) {
  const p = resolvePath(args.canvasPath);
  if (args.type !== void 0 && !ADD_NODE_TYPES.includes(args.type)) {
    const elsewhere = args.type === "knowledge" ? " (a knowledge node: canvas_add_knowledge)" : args.type === "kernel" ? " (a kernel: canvas_add_kernel adds a kernel record)" : args.type === "group" ? " (the canvas does not show groups; a section holds a set of nodes: canvas_add_section)" : "";
    return `error: unknown node type "${String(args.type)}" \u2014 canvas_add_node makes ${ADD_NODE_TYPES.join(", ")}${elsewhere}`;
  }
  const ref = args.type === "noderef" ? parseNodeRef(args.label === void 0 ? String(args.canvas ?? "") : `${String(args.canvas ?? "")}#${String(args.label)}`) : null;
  if (args.type === "noderef" && !ref)
    return "error: a noderef needs canvas (a path ending in .canvas) and label (the target node's label, e.g. N3, or a section's label, e.g. S3), or canvas as path.canvas#N3";
  return withFileLock(p, async () => {
    const d = await readCanvasOrEmpty(p);
    const anchorRef = args.after ?? args.forkOf;
    const anchor = anchorRef !== void 0 ? findNode(d, anchorRef) : void 0;
    if (anchorRef !== void 0 && !anchor)
      return `Node not found: ${anchorRef}`;
    const type = args.type ?? (anchor?.type === "code" ? "code" : "text");
    const dims = defaultDims(type, args.url);
    const w = args.width !== void 0 ? snapGrid(args.width) : dims.w;
    const sized = type === "code" && args.height === void 0 && typeof args.content === "string";
    const h = sized ? codeCellHeight(estimateCodeNeedPx(args.content)) : args.height !== void 0 ? snapGrid(args.height) : dims.h;
    let placed = null;
    if (anchor) {
      if (args.forkOf !== void 0 && anchor.type !== "code")
        return "forkOf must be a code cell";
      const around = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], anchor.id) ?? toEngineNodes(d.nodes);
      placed = args.after !== void 0 ? insertAfter(around, anchor.id) : forkOf(around, anchor.id, args.side ?? "right", w);
      if (!placed)
        return "a left fork does not fit before the origin";
    }
    const pos = placed ?? (args.x !== void 0 && args.y !== void 0 ? { x: args.x, y: args.y } : autoPlace(d.nodes, w, h));
    const at = clampToOrigin(snapGrid(pos.x), snapGrid(pos.y));
    const base = {
      id: uid(),
      type,
      x: at.x,
      y: at.y,
      width: w,
      height: h,
      createdBy: "ai",
      ...args.color ? { color: args.color } : {},
      ...args.tags ? { tags: args.tags } : {}
    };
    let newNode;
    switch (type) {
      case "text":
        newNode = { ...base, type: "text", text: args.content ?? "" };
        break;
      case "cell":
        newNode = { ...base, type: "cell", format: args.format ?? "markdown", content: args.content ?? "" };
        break;
      case "code":
        newNode = { ...base, type: "code", code: args.content ?? "", language: "python" };
        break;
      case "file": {
        const rawFile = args.file ?? "";
        const fileUri = normalizeFileUri(rawFile, p);
        newNode = { ...base, type: "file", file: fileUri };
        break;
      }
      case "link":
        newNode = { ...base, type: "link", url: args.url ?? "" };
        break;
      case "portal":
        newNode = { ...base, type: "portal", canvas: args.canvas ?? "" };
        break;
      case "noderef":
        newNode = { ...base, type: "noderef", canvas: noderefCanvasPath(ref.canvas, p), label: ref.label, ...args.title ? { title: args.title } : {} };
        break;
      default:
        newNode = { ...base, type: "text", text: args.content ?? "" };
    }
    const labeled = assignLabel(newNode, d.nodes);
    const before = geomOf(d);
    d.nodes.push(labeled);
    if (anchor && d.metadata?.sections)
      d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, anchor.id, labeled.id) };
    const report = {};
    const own = applyEngine(d, [labeled.id], [], report, anchor ? { id: anchor.id, joining: [labeled.id] } : void 0);
    Object.assign(d, applyLaneFit(d, Date.now(), own));
    const moved = movedLabels(d, before, [labeled.id]);
    await writeCanvas(p, d);
    const final = d.nodes.find((n) => n.id === labeled.id) ?? labeled;
    const lines = [
      `Created node ${labeled.nodeLabel} (id: ${labeled.id})`,
      `Type: ${type}`,
      `Position: (${final.x}, ${final.y})  Size: ${final.width}\xD7${final.height}`
    ];
    if (anchor && (args.x !== void 0 || args.y !== void 0))
      lines.push(`x/y ignored: placed ${args.after !== void 0 ? "after" : "as a fork of"} ${anchor.nodeLabel ?? anchor.id}`);
    if (moved.length)
      lines.push(`Moved: ${moved.join(", ")}`);
    if (report.capped)
      lines.push(CAPPED_NOTE);
    lines.push(`Canvas: ${p}`);
    return lines.join("\n");
  });
}
async function canvasUpdateNode(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const n = findNode(d, args.ref);
    if (!n)
      return `Node not found: ${args.ref}`;
    const idx = d.nodes.indexOf(n);
    const updated = { ...n };
    if (args.content !== void 0) {
      if (n.type === "knowledge")
        return "content is not settable on a knowledge node \u2014 use canvas_add_knowledge";
      if (n.type === "text")
        updated.text = args.content;
      if (n.type === "cell")
        updated.content = args.content;
      if (n.type === "code")
        updated.code = args.content;
    }
    if (args.tags !== void 0)
      updated.tags = args.tags;
    if (args.color !== void 0)
      updated.color = args.color;
    if (args.label !== void 0)
      updated.nodeLabel = args.label;
    const at = clampToOrigin(
      args.x !== void 0 ? snapGrid(args.x) : updated.x,
      args.y !== void 0 ? snapGrid(args.y) : updated.y
    );
    if (args.x !== void 0)
      updated.x = at.x;
    if (args.y !== void 0)
      updated.y = at.y;
    if (args.width !== void 0)
      updated.width = snapGrid(args.width);
    if (args.height !== void 0)
      updated.height = snapGrid(args.height);
    let resized = false;
    if (n.type === "code" && args.height === void 0 && args.content !== void 0 && args.content !== n.code) {
      updated.height = codeCellHeight(estimateCodeNeedPx(args.content));
      resized = updated.height !== n.height;
    }
    const isOutput = d.nodes.some((o) => o.type === "code" && o.outputNodeId === n.id);
    const clamped = [];
    if (isOutput && updated.width > OUTPUT_MAX_W) {
      updated.width = OUTPUT_MAX_W;
      clamped.push(`width to ${OUTPUT_MAX_W}`);
    }
    if (isOutput && updated.height > OUTPUT_MAX_H) {
      updated.height = OUTPUT_MAX_H;
      clamped.push(`height to ${OUTPUT_MAX_H}`);
    }
    const before = geomOf(d);
    d.nodes[idx] = updated;
    const geom = args.x !== void 0 || args.y !== void 0 || args.width !== void 0 || args.height !== void 0 || resized;
    const report = {};
    const own = geom ? applyEngine(d, [updated.id], [], report) : /* @__PURE__ */ new Map();
    Object.assign(d, applyLaneFit(d, Date.now(), own));
    const moved = geom ? movedLabels(d, before, [updated.id]) : [];
    await writeCanvas(p, d);
    return `Updated node ${updated.nodeLabel ?? updated.id}` + (clamped.length ? ` \u2014 output cell clamped: ${clamped.join(", ")}` : "") + (moved.length ? ` \u2014 moved ${moved.join(", ")}` : "") + (report.capped ? ` \u2014 ${CAPPED_NOTE}` : "");
  });
}
async function canvasAddKnowledge(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvasOrEmpty(p);
    const anchorRef = args.after;
    const anchor = anchorRef !== void 0 ? findNode(d, anchorRef) : void 0;
    if (anchorRef !== void 0 && !anchor)
      return `Node not found: ${anchorRef}`;
    const w = NODE_SIZE.knowledge.w;
    const h = NODE_SIZE.knowledge.h;
    const server = args.server ?? "";
    const uri = args.uri ?? "";
    let placed = null;
    if (anchor) {
      const around = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], anchor.id) ?? toEngineNodes(d.nodes);
      placed = insertAfter(around, anchor.id);
    }
    const pos = placed ?? (args.x !== void 0 && args.y !== void 0 ? { x: args.x, y: args.y } : autoPlace(d.nodes, w, h));
    const at = clampToOrigin(snapGrid(pos.x), snapGrid(pos.y));
    const node = {
      id: uid(),
      type: "knowledge",
      x: at.x,
      y: at.y,
      width: w,
      height: h,
      server,
      uri,
      title: args.title ?? "",
      text: args.text ?? "",
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      createdBy: "ai"
    };
    const labeled = assignLabel(node, d.nodes);
    const before = geomOf(d);
    d.nodes.push(labeled);
    if (anchor && d.metadata?.sections)
      d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, anchor.id, labeled.id) };
    const report = {};
    const own = applyEngine(d, [labeled.id], [], report, anchor ? { id: anchor.id, joining: [labeled.id] } : void 0);
    Object.assign(d, applyLaneFit(d, Date.now(), own));
    const moved = movedLabels(d, before, [labeled.id]);
    await writeCanvas(p, d);
    const final = d.nodes.find((n) => n.id === labeled.id) ?? labeled;
    const lines = [
      `Created node ${labeled.nodeLabel} (id: ${labeled.id})`,
      "Type: knowledge",
      `Source: ${server} ${uri}`,
      `Position: (${final.x}, ${final.y})  Size: ${final.width}\xD7${final.height}`
    ];
    if (anchor && (args.x !== void 0 || args.y !== void 0))
      lines.push(`x/y ignored: placed after ${anchor.nodeLabel ?? anchor.id}`);
    if (moved.length)
      lines.push(`Moved: ${moved.join(", ")}`);
    if (report.capped)
      lines.push(CAPPED_NOTE);
    lines.push(`Canvas: ${p}`);
    return lines.join("\n");
  });
}
var KNOWLEDGE_EPOCH = "1970-01-01T00:00:00.000Z";
async function canvasRefreshKnowledge(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const n = findNode(d, args.ref);
    if (!n)
      return `Node not found: ${args.ref}`;
    if (n.type !== "knowledge")
      return `Node ${n.nodeLabel ?? n.id} is not a knowledge node`;
    n.fetchedAt = KNOWLEDGE_EPOCH;
    await writeCanvas(p, d);
    return `Marked ${n.nodeLabel ?? n.id} for refresh on the next open`;
  });
}
async function canvasRemoveNode(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const refs = Array.isArray(args.ref) ? args.ref : [args.ref];
    const toRemove = /* @__PURE__ */ new Set();
    const labels = [];
    for (const ref of refs) {
      const n = findNode(d, ref);
      if (n) {
        toRemove.add(n.id);
        labels.push(n.nodeLabel ?? n.id);
      }
    }
    if (toRemove.size === 0)
      return `No nodes found for: ${refs.join(", ")}`;
    const holes = columnsOfDeleted(d.nodes, d.metadata?.sections ?? [], toRemove);
    const before = geomOf(d);
    d.nodes = d.nodes.filter((n) => !toRemove.has(n.id));
    d.edges = d.edges.filter((e) => !toRemove.has(e.fromNode) && !toRemove.has(e.toNode));
    if (d.metadata?.sections)
      d.metadata = { ...d.metadata, sections: pruneFoldedIds(d.metadata.sections, toRemove) };
    const report = {};
    const own = applyEngine(d, [], holes, report);
    Object.assign(d, applyLaneFit(d, Date.now(), own));
    const moved = movedLabels(d, before);
    await writeCanvas(p, d);
    return `Removed ${toRemove.size} node(s): ${labels.join(", ")}` + (moved.length ? ` \u2014 moved ${moved.join(", ")}` : "") + (report.capped ? ` \u2014 ${CAPPED_NOTE}` : "");
  });
}
async function canvasAddEdge(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const fn = findNode(d, args.from);
    const tn = findNode(d, args.to);
    if (!fn)
      return `Source node not found: ${args.from}`;
    if (!tn)
      return `Target node not found: ${args.to}`;
    const edge = {
      id: `edge-${uid()}`,
      fromNode: fn.id,
      fromSide: args.fromSide ?? "right",
      toNode: tn.id,
      toSide: args.toSide ?? "left",
      toEnd: "arrow",
      ...args.label ? { label: args.label } : {},
      ...args.color ? { color: args.color } : {}
    };
    d.edges.push({ ...edge, keepRow: keepRowOf(holdSection(d, edge), d.edges, edge) });
    await writeCanvas(p, d);
    return `Connected ${fn.nodeLabel ?? fn.id} \u2192 ${tn.nodeLabel ?? tn.id}  (edge id: ${edge.id})`;
  });
}
async function canvasUpdateEdge(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const e = findEdge(d, args.ref);
    if (!e)
      return `Edge not found: ${JSON.stringify(args.ref)}`;
    const around = holdSection(d, e);
    const was = ridersOf(around, [e]).has(e.toNode);
    const newSides = args.fromSide !== void 0 && args.fromSide !== (e.fromSide ?? "right") || args.toSide !== void 0 && args.toSide !== (e.toSide ?? "left");
    if (args.label !== void 0)
      e.label = args.label;
    if (args.color !== void 0)
      e.color = args.color;
    if (args.fromSide !== void 0)
      e.fromSide = args.fromSide;
    if (args.toSide !== void 0)
      e.toSide = args.toSide;
    if (newSides)
      e.keepRow = keepRowOf(around, d.edges, e);
    const before = geomOf(d);
    const report = {};
    if (was && !ridersOf(around, [e]).has(e.toNode)) {
      Object.assign(d, applyLaneFit(d, Date.now(), applyEngine(d, [e.toNode], [], report)));
    }
    const moved = movedLabels(d, before);
    await writeCanvas(p, d);
    return `Updated edge ${e.id}` + (moved.length ? ` \u2014 moved ${moved.join(", ")}` : "") + (report.capped ? ` \u2014 ${CAPPED_NOTE}` : "");
  });
}
async function canvasRemoveEdge(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const e = findEdge(d, args.ref);
    if (!e)
      return `Edge not found: ${JSON.stringify(args.ref)}`;
    const around = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], e.toNode) ?? toEngineNodes(d.nodes);
    const released = ridersOf(around, [e]).has(e.toNode);
    d.edges = d.edges.filter((x) => x.id !== e.id);
    const before = geomOf(d);
    const report = {};
    if (released)
      Object.assign(d, applyLaneFit(d, Date.now(), applyEngine(d, [e.toNode], [], report)));
    const moved = movedLabels(d, before);
    await writeCanvas(p, d);
    return `Removed edge ${e.id}` + (moved.length ? ` \u2014 moved ${moved.join(", ")}` : "") + (report.capped ? ` \u2014 ${CAPPED_NOTE}` : "");
  });
}
async function canvasLayout(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const items = Array.isArray(args.nodes) ? args.nodes : [];
    const done = [];
    const missing = [];
    const movers = [];
    const before = geomOf(d);
    for (const it of items) {
      const n = findNode(d, it.ref);
      if (!n) {
        missing.push(String(it.ref));
        continue;
      }
      const at = clampToOrigin(
        it.x !== void 0 ? snapGrid(it.x) : n.x,
        it.y !== void 0 ? snapGrid(it.y) : n.y
      );
      if (it.x !== void 0)
        n.x = at.x;
      if (it.y !== void 0)
        n.y = at.y;
      if (it.width !== void 0)
        n.width = snapGrid(it.width);
      if (it.height !== void 0)
        n.height = snapGrid(it.height);
      if (it.x !== void 0 || it.y !== void 0 || it.width !== void 0 || it.height !== void 0)
        movers.push(n.id);
      done.push(n.nodeLabel ?? n.id);
    }
    const report = {};
    Object.assign(d, applyLaneFit(d, Date.now(), applyEngine(d, movers, [], report)));
    const moved = movedLabels(d, before, movers);
    await writeCanvas(p, d);
    return `Laid out ${done.length} node(s): ${done.join(", ")}` + (moved.length ? ` \u2014 moved ${moved.join(", ")}` : "") + (missing.length ? ` \u2014 not found: ${missing.join(", ")}` : "") + (report.capped ? ` \u2014 ${CAPPED_NOTE}` : "");
  });
}
async function canvasCreate(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    await fs5.mkdir(path7.dirname(p), { recursive: true });
    try {
      await withCanvasLock(p, "mcp", () => createCanvasJson(p, JSON.stringify({ nodes: [], edges: [] }, null, 2)));
    } catch (e) {
      if (e instanceof CanvasExists)
        return `Canvas already exists: ${p}`;
      throw e;
    }
    return `Created empty canvas: ${p}`;
  });
}
async function canvasPinOutput(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const format2 = args.format ?? "html";
    const content = args.content ?? "";
    const W = CELL_SIZE.w, H = CELL_SIZE.h;
    let geom = { x: 0, y: 0, width: W, height: H };
    let sourceNode;
    if (args.sourceRef) {
      sourceNode = findNode(d, args.sourceRef);
      if (sourceNode) {
        const around = sourceNode.type === "code" && !ownedOutputId(d.nodes, d.edges, sourceNode) ? sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], sourceNode.id) : null;
        const slot = around && placeOutput(around, sourceNode.id);
        geom = slot ?? { ...outputCellGeom(d.metadata?.sections ?? [], sourceNode, 60), width: W, height: H };
      }
    }
    if (!sourceNode)
      geom = { ...autoPlace(d.nodes, W, H), width: W, height: H };
    const cell = {
      id: uid(),
      type: "cell",
      ...geom,
      format: format2,
      content,
      createdBy: "ai",
      ...args.tags ? { tags: args.tags } : {}
    };
    const labeled = assignLabel(cell, d.nodes);
    const before = geomOf(d);
    d.nodes.push(labeled);
    let edgeId = "";
    let pinEdge;
    if (sourceNode) {
      const edge = {
        id: `edge-pin-${uid()}`,
        fromNode: sourceNode.id,
        fromSide: "right",
        toNode: labeled.id,
        toSide: "left",
        toEnd: "arrow",
        label: args.edgeLabel ?? nowLabel()
      };
      edgeId = edge.id;
      pinEdge = edge;
    }
    const adopted = sourceNode?.type === "code" && !ownedOutputId(d.nodes, d.edges, sourceNode);
    if (adopted)
      sourceNode.outputNodeId = labeled.id;
    if (sourceNode && d.metadata?.sections)
      d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, sourceNode.id, labeled.id) };
    if (pinEdge)
      d.edges.push({ ...pinEdge, keepRow: keepRowOf(sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], sourceNode.id, [labeled.id]) ?? toEngineNodes(d.nodes), d.edges, pinEdge) });
    const report = {};
    const own = applyEngine(d, [adopted || !sourceNode ? labeled.id : sourceNode.id], [], report, sourceNode ? { id: sourceNode.id, joining: [labeled.id] } : void 0);
    Object.assign(d, applyLaneFit(d, Date.now(), own));
    const moved = movedLabels(d, before, [labeled.id]);
    await writeCanvas(p, d);
    const lines = [`Pinned output as cell node ${labeled.nodeLabel} (id: ${labeled.id})`];
    if (sourceNode)
      lines.push(`Connected from ${sourceNode.nodeLabel ?? sourceNode.id} with edge "${d.edges.find((e) => e.id === edgeId)?.label}"`);
    if (moved.length)
      lines.push(`Moved: ${moved.join(", ")}`);
    if (report.capped)
      lines.push(CAPPED_NOTE);
    lines.push(`Canvas: ${p}`);
    return lines.join("\n");
  });
}
function loadKernelServers(canvasPath) {
  const dirs = [workspaceDirAbove(path7.dirname(canvasPath)), workspaceDirAbove(process.cwd())].filter((d, i, all) => d !== null && all.indexOf(d) === i);
  const settings = dirs.length ? dirs.flatMap((d) => ["settings.local.json", "settings.json"].map((f) => readSettingsSync(path7.join(d, ".vscode", f)))) : [{ file: ".vscode settings", problem: `no .vscode folder at or above ${path7.dirname(canvasPath)} or ${process.cwd()}` }];
  return pickKernelServers(process.env.SKENA_JUPYTER_KERNELS, settings, process.env);
}
async function runCellCore(d, cell, kernel, kernelId, server, p, ipc) {
  const startRes = await persistViaHost(ipc, p, { phase: "start", cellNodeId: cell.id, kernelNodeId: kernel.id, kernelId });
  const hostOwns = startRes.handled;
  const owned = ownedOutputId(d.nodes, d.edges, cell);
  const outId = hostOwns ? startRes.outputNodeId ?? owned ?? uid() : owned ?? uid();
  if (!hostOwns) {
    cell.lastStatus = "running";
    await writeCanvas(p, d);
  }
  const around = sectionEngineNodes(d.nodes, d.metadata?.sections ?? [], cell.id);
  const outPrev = d.nodes.find((n) => n.id === outId && n.type === "cell");
  const outGeom = (around && placeOutput(around, cell.id, outPrev ? { w: outPrev.width, h: outPrev.height } : void 0)) ?? outputCellGeom(d.metadata?.sections ?? [], cell);
  const outEdge = { id: `e-${outId}`, fromNode: cell.id, fromSide: "right", toNode: outId, toSide: "left", toEnd: "arrow" };
  let lastPost = 0;
  const postFrame = (partial) => {
    if (!ipc)
      return;
    if (!hasVisibleOutput(partial))
      return;
    const { format: format3, content: content2 } = renderOutput(partial);
    const message = {
      type: "runOutput",
      codeNodeId: cell.id,
      lastStatus: "running",
      kernelNodeId: kernel.id,
      kernelId,
      source: "mcp",
      outputNode: { id: outId, type: "cell", format: format3, content: content2, ...outGeom, createdBy: "ai" },
      edge: outEdge
    };
    void fetch(`http://127.0.0.1:${ipc.port}/delta`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-skena-token": ipc.token },
      body: JSON.stringify({ canvasPath: p, message })
    }).catch(() => {
    });
  };
  const onDelta = (partial) => {
    const now = Date.now();
    if (now - lastPost >= 350) {
      lastPost = now;
      postFrame(partial);
    }
  };
  const ids = { msgId: crypto.randomUUID(), session: crypto.randomUUID(), date: (/* @__PURE__ */ new Date()).toISOString() };
  let out;
  try {
    out = await executeCell(server, kernelId, cell.code, ids, onDelta);
  } catch (e) {
    if (hostOwns) {
      await persistViaHost(ipc, p, { phase: "done", cellNodeId: cell.id, kernelNodeId: kernel.id, kernelId, outputNodeId: outId, status: "error", output: null });
    } else {
      cell.lastStatus = "error";
      cell.lastRun = Date.now();
      await writeCanvas(p, d);
    }
    return { status: "error", outLabel: "(error)", streamText: "", moved: [], capped: false, error: e instanceof Error ? e.message : String(e) };
  }
  const { format: format2, content } = renderOutput(out);
  const hasOutput = hasVisibleOutput(out);
  let outLabel = "(no output)";
  let moved = [];
  const report = {};
  if (hostOwns) {
    await persistViaHost(ipc, p, {
      phase: "done",
      cellNodeId: cell.id,
      kernelNodeId: kernel.id,
      kernelId,
      outputNodeId: outId,
      status: out.status === "error" ? "error" : "ok",
      output: hasOutput ? { format: format2, content } : null
    });
    cell.lastStatus = out.status === "error" ? "error" : "ok";
    cell.lastRun = Date.now();
    if (hasOutput)
      cell.outputNodeId = outId;
    outLabel = hasOutput ? outId : "(no output)";
  } else {
    cell.lastStatus = out.status === "error" ? "error" : "ok";
    cell.lastRun = Date.now();
    const before = geomOf(d);
    let own = /* @__PURE__ */ new Map();
    if (hasOutput) {
      const existing = d.nodes.find((n) => n.id === outId && n.type === "cell");
      if (existing) {
        existing.format = format2;
        existing.content = content;
        if (!d.edges.some((e) => e.fromNode === cell.id && e.toNode === outId))
          d.edges.push(outEdge);
        outLabel = existing.nodeLabel ?? existing.id;
      } else {
        const outNode = { id: outId, type: "cell", format: format2, content, ...outGeom, createdBy: "ai" };
        const labeled = assignLabel(outNode, d.nodes);
        d.nodes.push(labeled);
        d.edges.push(outEdge);
        cell.outputNodeId = outId;
        if (d.metadata?.sections)
          d.metadata = { ...d.metadata, sections: pinOutputToLane(d.metadata.sections, cell.id, outId) };
        own = applyEngine(d, [outId], [], report, { id: cell.id, joining: [outId] });
        outLabel = labeled.nodeLabel ?? labeled.id;
      }
    }
    Object.assign(d, applyLaneFit(d, Date.now(), own));
    moved = movedLabels(d, before);
    await writeCanvas(p, d);
    if (ipc) {
      const message = hasOutput ? { type: "runOutput", codeNodeId: cell.id, lastStatus: cell.lastStatus, kernelNodeId: kernel.id, kernelId, source: "mcp", outputNode: { id: outId, type: "cell", format: format2, content, ...outGeom, createdBy: "ai" }, edge: outEdge } : { type: "runOutput", codeNodeId: cell.id, lastStatus: cell.lastStatus, kernelNodeId: kernel.id, kernelId, source: "mcp" };
      void fetch(`http://127.0.0.1:${ipc.port}/delta`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-skena-token": ipc.token },
        body: JSON.stringify({ canvasPath: p, message })
      }).catch(() => {
      });
    }
  }
  return { status: cell.lastStatus, outLabel, moved, capped: report.capped === true, streamText: out.streamText, error: out.error };
}
function kernelByRef(d, ref) {
  const n = findNode(d, ref);
  return kernelById(d, ref) ?? (d.metadata?.kernels?.find((k) => k.displayName === ref) ?? null) ?? (n?.type === "kernel" ? kernelById(d, n.id) : null);
}
function prepareRun(d, p, cell, kernelRef) {
  let kernel = kernelRef ? kernelByRef(d, kernelRef) : null;
  if (kernelRef && !kernel)
    return `error: no kernel matches "${kernelRef}" \u2014 a record id or display name, or a kernel node label/id`;
  if (!kernel) {
    const kid = resolveCellKernel(cell.id, cellKernelView(d));
    kernel = kid ? kernelById(d, kid) : null;
  }
  if (!kernel)
    return "error: no kernel bound to this cell \u2014 connect it to a kernel node, or bind a kernel to its section from the rail";
  const lookup = loadKernelServers(p);
  const server = lookup.servers.find((s) => s.name === kernel.server);
  if (!server)
    return unknownServerText(kernel.server, lookup);
  if (!kernel.kernelId)
    return "error: kernel has no live kernelId (open the canvas so Skena starts it)";
  return { kernel, kernelId: kernel.kernelId, server, ipc: extensionRelay(p) };
}
async function canvasRunCell(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const cell = findNode(d, args.cellRef);
    if (!cell || cell.type !== "code")
      return `error: ${args.cellRef} is not a code node`;
    const prep = prepareRun(d, p, cell, args.kernelRef);
    if (typeof prep === "string")
      return prep;
    const { kernel, kernelId, server, ipc } = prep;
    const upstream = upstreamCellsForRun(cell.id, cellKernelView(d));
    const ran = [];
    for (const upId of upstream) {
      const up = d.nodes.find((n) => n.id === upId && n.type === "code");
      if (!up || up.lastStatus === "ok")
        continue;
      const r = await runCellCore(d, up, kernel, kernelId, server, p, ipc);
      ran.push(`${up.nodeLabel ?? up.id}:${r.status}`);
      if (r.status === "error") {
        return `error: upstream ${up.nodeLabel ?? up.id} failed \u2014 ${r.error ?? ""} (ran ${ran.join(", ")})`;
      }
    }
    const cellNow = d.nodes.find((n) => n.id === cell.id);
    const kernelNow = kernelById(d, kernel.id);
    if (!cellNow || !kernelNow)
      return "error: cell or kernel vanished during the upstream run";
    const res = await runCellCore(d, cellNow, kernelNow, kernelId, server, p, ipc);
    const prefix = ran.length ? `(upstream ${ran.join(", ")}) ` : "";
    return `${prefix}ran ${cellNow.nodeLabel ?? cellNow.id} on ${kernelNow.server} \u2192 ${res.outLabel}: ${res.status}${res.moved.length ? ` \u2014 moved ${res.moved.join(", ")}` : ""}${res.capped ? ` \u2014 ${CAPPED_NOTE}` : ""}${res.error ? " \u2014 " + res.error : ""}
${res.streamText.slice(0, 500)}`;
  });
}
async function canvasAddSection(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvasOrEmpty(p);
    const lanes = d.metadata?.sections ?? [];
    const now = Date.now();
    let next;
    if (args.y !== void 0) {
      const y = args.y;
      next = insertLaneAt(lanes, y, now);
      if (next === lanes) {
        return y < 0 ? "error: y must be \u2265 0" : `error: a section already starts at y=${snapGrid(y)}`;
      }
    } else {
      const last = deriveLanes(d.nodes, lanes).at(-1);
      let y = 0;
      if (last) {
        const hidden = new Set(last.folded ?? []);
        const visible = d.nodes.filter((n) => last.memberIds.includes(n.id) && !hidden.has(n.id));
        y = last.top + sectionTargetHeight(last, visible);
      }
      next = insertLaneAt(lanes, y, now);
      if (next === lanes)
        return `error: a section already starts at y=${snapGrid(y)}`;
    }
    const created = next.find((l) => !lanes.includes(l));
    if (created && typeof args.title === "string" && args.title)
      created.title = args.title;
    d.metadata = { ...d.metadata, sections: next };
    Object.assign(d, applyLaneFit(d, now));
    await writeCanvas(p, d);
    const shown = deriveLanes(d.nodes, d.metadata?.sections ?? []).find((l) => l.id === created?.id);
    return `Created section ${shown?.label ?? "S?"} (id ${created?.id}) at y=${shown?.top ?? created?.y}`;
  });
}
async function canvasRemoveSection(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const lanes = d.metadata?.sections ?? [];
    const lane = sectionByRef(lanes, args.ref);
    if (!lane)
      return `error: no section matches ${args.ref}`;
    const derived = deriveLanes(d.nodes, lanes).find((l) => l.id === lane.id);
    const label = derived?.label ?? lane.id;
    const doomed = new Set(derived?.memberIds ?? []);
    d.nodes = d.nodes.filter((n) => !doomed.has(n.id));
    d.edges = d.edges.filter((e) => !doomed.has(e.fromNode) && !doomed.has(e.toNode));
    const kept = parkFirstLaneAtOrigin(pruneFoldedIds(lanes.filter((l) => l.id !== lane.id), doomed));
    if (kept.length)
      d.metadata = { ...d.metadata, sections: kept };
    else {
      const { sections: _none, ...rest } = d.metadata ?? {};
      d.metadata = rest;
    }
    Object.assign(d, applyLaneFit(d, Date.now()));
    await writeCanvas(p, d);
    return `Removed section ${label} and ${doomed.size} node(s)`;
  });
}
async function canvasUpdateSection(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    let lanes = d.metadata?.sections ?? [];
    const lane = sectionByRef(lanes, args.ref);
    if (!lane)
      return `error: no section matches ${args.ref}`;
    const label = deriveLanes(d.nodes, lanes).find((l) => l.id === lane.id)?.label ?? lane.id;
    const changed = [];
    if (typeof args.title === "string") {
      const t = args.title;
      lanes = lanes.map((l) => {
        if (l.id !== lane.id)
          return l;
        const { title: _drop, ...rest } = l;
        return t ? { ...rest, title: t } : rest;
      });
      changed.push(t ? `title "${t}"` : "title cleared");
    }
    if (args.kernelRef !== void 0) {
      if (args.kernelRef === null) {
        lanes = lanes.map((l) => {
          if (l.id !== lane.id)
            return l;
          const { kernelId: _unbound, ...rest } = l;
          return rest;
        });
        changed.push("kernel unbound");
      } else {
        const k = kernelByRef(d, args.kernelRef);
        if (!k)
          return `error: no kernel matches "${args.kernelRef}" \u2014 a record id or display name, or a kernel node label/id`;
        lanes = lanes.map((l) => l.id === lane.id ? { ...l, kernelId: k.id } : l);
        changed.push(`kernel ${k.displayName ?? k.id}`);
      }
    }
    let foldNoop = false;
    if (args.folded !== void 0) {
      if (args.folded) {
        const next = foldLane(lanes, d.nodes, lane.id);
        foldNoop = next === lanes;
        changed.push(foldNoop ? "already folded" : `folded (${next.find((l) => l.id === lane.id)?.folded?.length ?? 0} node(s) hidden)`);
        lanes = next;
      } else {
        const u = unfoldLane(lanes, d.nodes, lane.id);
        foldNoop = u.lanes === lanes;
        if (foldNoop)
          changed.push("already unfolded");
        else {
          d.nodes = d.nodes.map((n) => u.nodeShifts[n.id] ? { ...n, y: n.y + u.nodeShifts[n.id] } : n);
          lanes = u.lanes;
          changed.push("unfolded");
        }
      }
    }
    if (changed.length === 0)
      return "error: nothing to update \u2014 supply title, kernelRef or folded";
    if (foldNoop && changed.length === 1)
      return `Section ${label}: ${changed[0]}`;
    d.metadata = { ...d.metadata, sections: lanes };
    Object.assign(d, applyLaneFit(d, Date.now()));
    await writeCanvas(p, d);
    return `Updated section ${label}: ${changed.join(", ")}`;
  });
}
async function canvasReflowSection(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const lanes = d.metadata?.sections ?? [];
    const lane = sectionByRef(lanes, args.ref);
    if (!lane)
      return `error: no section matches ${args.ref}`;
    const derived = deriveLanes(d.nodes, lanes).find((l) => l.id === lane.id);
    const label = derived?.label ?? lane.id;
    const members = new Set(derived?.memberIds ?? []);
    const around = toEngineNodes(d.nodes.filter((n) => members.has(n.id)));
    const patches = reflowSection(around, { riders: ridersOf(around, d.edges) });
    const count = Object.keys(patches).length;
    if (count === 0)
      return `Reflowed ${label}: nothing moved`;
    const own = sectionMembership(d.nodes, lanes, { sectionId: lane.id });
    d.nodes = applyPatchesToCanvas(d.nodes, patches);
    Object.assign(d, applyLaneFit(d, Date.now(), own));
    await writeCanvas(p, d);
    return `Reflowed ${label}: ${count} node(s) moved`;
  });
}
async function canvasRunSection(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const lanes = d.metadata?.sections ?? [];
    const lane = sectionByRef(lanes, args.ref);
    if (!lane)
      return `error: no section matches ${args.ref}`;
    const label = deriveLanes(d.nodes, lanes).find((l) => l.id === lane.id)?.label ?? lane.id;
    const order = memberCodeCellsInRunOrder(d.nodes, lanes, lane.id);
    if (order.length === 0)
      return `error: no code cells in ${label}`;
    const ran = [];
    const moved = [];
    let capped = false;
    for (const cellId of order) {
      const cell = d.nodes.find((n) => n.id === cellId && n.type === "code");
      if (!cell)
        continue;
      const prep = prepareRun(d, p, cell);
      if (typeof prep === "string")
        return `${prep}${ran.length ? ` (ran ${ran.join(", ")})` : ""}`;
      const r = await runCellCore(d, cell, prep.kernel, prep.kernelId, prep.server, p, prep.ipc);
      ran.push(`${cell.nodeLabel ?? cell.id}:${r.status}`);
      for (const m of r.moved)
        if (!moved.includes(m))
          moved.push(m);
      capped ||= r.capped;
      if (r.status === "error")
        return `error: ${cell.nodeLabel ?? cell.id} failed \u2014 ${r.error ?? ""} (ran ${ran.join(", ")})`;
    }
    return `ran ${ran.join(", ")}` + (moved.length ? ` \u2014 moved ${moved.join(", ")}` : "") + (capped ? ` \u2014 ${CAPPED_NOTE}` : "");
  });
}
async function canvasAddKernel(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const lookup = loadKernelServers(p);
    const server = lookup.servers.find((s) => s.name === args.server);
    if (!server)
      return unknownServerText(String(args.server), lookup);
    const spec = args.spec;
    let kernelId;
    if (args.start !== false) {
      try {
        kernelId = (await startKernel(server, spec ?? "python3")).id;
      } catch (e) {
        return `error: failed to start kernel on ${server.name}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    const existing = (d.metadata?.kernels?.length ?? 0) + d.nodes.filter((n) => n.type === "kernel").length;
    const record = {
      id: `k-${Date.now().toString(36)}`,
      server: server.name,
      ...spec ? { spec } : {},
      displayName: args.displayName ?? spec ?? "kernel",
      ...kernelId ? { kernelId } : {},
      colorIndex: nextKernelColorIndex(existing)
    };
    let bound = "";
    let sections = d.metadata?.sections;
    if (args.bindSection !== void 0) {
      const lane = sectionByRef(sections ?? [], args.bindSection);
      if (!lane)
        return `error: no section matches ${args.bindSection}`;
      sections = (sections ?? []).map((l) => l.id === lane.id ? { ...l, kernelId: record.id } : l);
      bound = `, bound to ${deriveLanes(d.nodes, sections).find((l) => l.id === lane.id)?.label ?? lane.id}`;
    }
    d.metadata = { ...d.metadata, kernels: [...d.metadata?.kernels ?? [], record], ...sections ? { sections } : {} };
    Object.assign(d, applyLaneFit(d, Date.now()));
    await writeCanvas(p, d);
    return `Added kernel ${record.id} (${record.displayName}) on ${server.name}, live id ${kernelId ?? "(not started)"}${bound}`;
  });
}
async function canvasRemoveKernel(args) {
  const p = resolvePath(args.canvasPath);
  return withFileLock(p, async () => {
    const d = await readCanvas(p);
    const ref = args.ref;
    const rec = d.metadata?.kernels?.find((k) => k.id === ref || k.displayName === ref);
    if (!rec) {
      const n = findNode(d, ref);
      if (n?.type === "kernel")
        return `error: ${ref} is a kernel node; remove it with canvas_remove_node`;
      return `error: no kernel record matches ${ref} \u2014 a record id or display name`;
    }
    const server = loadKernelServers(p).servers.find((s) => s.name === rec.server);
    if (server && rec.kernelId) {
      try {
        await shutdownKernel(server, rec.kernelId);
      } catch {
      }
    }
    const bound = new Set(resolveKernelCellsInCanvas(rec.id, cellKernelView(d)));
    for (const n of d.nodes) {
      if (n.type === "code" && bound.has(n.id))
        n.lastStatus = void 0;
    }
    d.metadata = {
      ...d.metadata,
      kernels: d.metadata?.kernels?.filter((k) => k.id !== rec.id),
      // - drop the key rather than persisting `kernelId: undefined` on the lane
      sections: d.metadata?.sections?.map((l) => {
        if (l.kernelId !== rec.id)
          return l;
        const { kernelId: _unbound, ...rest } = l;
        return rest;
      })
    };
    Object.assign(d, applyLaneFit(d, Date.now()));
    await writeCanvas(p, d);
    return `Removed kernel ${rec.id} (${rec.displayName ?? "kernel"}); ${bound.size} cell(s) un-run`;
  });
}
var NO_EXPORT_HOST = "no running skena extension found for this workspace. The page is rendered by the extension, which has Typst, the code theme setting and the knowledge server token: open the workspace in VS Code, open any .canvas in it once (that starts skena), and call this again.";
function extensionRelay(canvasPath) {
  const fromEnv = parseRunIpc(process.env.SKENA_RUN_IPC);
  if (fromEnv)
    return fromEnv;
  const dirs = [workspaceDirAbove(path7.dirname(canvasPath)), process.cwd()].filter((d) => !!d);
  for (const dir of dirs) {
    const ipc = parseRunIpc(readEndpoint(dir) ?? void 0);
    if (ipc)
      return ipc;
  }
  return null;
}
var EXPORT_WAIT_MS = 30 * 6e4;
async function canvasExportHtml(args) {
  const canvasPath = resolvePath(String(args.canvasPath ?? ""));
  if (!canvasPath.endsWith(".canvas"))
    throw new Error(`not a .canvas file: ${canvasPath}`);
  await fs5.access(canvasPath);
  const outPath = typeof args.outPath === "string" && args.outPath.trim() ? path7.resolve(path7.dirname(canvasPath), expandHome2(args.outPath.trim())) : void 0;
  if (outPath === canvasPath)
    throw new Error(`not writing the page to ${outPath}: it is the canvas being exported`);
  if (outPath && /\.canvas$/i.test(outPath))
    throw new Error(`not writing the page to ${outPath}: that is a .canvas file`);
  const ipc = extensionRelay(canvasPath);
  if (!ipc)
    throw new Error(NO_EXPORT_HOST);
  const res = await postExport(ipc.port, ipc.token, { canvasPath, outPath }, EXPORT_WAIT_MS);
  if (res.kind === "unreachable")
    throw new Error(NO_EXPORT_HOST);
  if (res.kind === "closed")
    throw new Error(`the skena extension closed the connection before it answered (${res.message}): was the VS Code window closed or reloaded? Call this again once it is open.`);
  if (res.kind === "timeout") {
    const target = outPath ?? path7.join(path7.dirname(canvasPath), `${path7.basename(canvasPath, ".canvas")}.html`);
    throw new Error(`the export is still running in VS Code (no answer after ${EXPORT_WAIT_MS / 6e4} min); the page appears at ${target} when it is done.`);
  }
  if (res.status === 403)
    throw new Error("the skena extension of this workspace refused the export: it may be older than this MCP script; reload the VS Code window");
  if (res.status !== 200)
    throw new Error(`the skena extension answered HTTP ${res.status}`);
  const reply = JSON.parse(res.body);
  if (!reply.ok)
    throw new Error(reply.error);
  const missing = reply.missing.length ? `
${reply.missing.length} images could not be read and show their address instead:
${reply.missing.slice(0, 20).join("\n")}` : "";
  return `Exported ${reply.nodes} nodes and ${reply.edges} edges to ${reply.outPath} (${(reply.bytes / 1e6).toFixed(1)} MB).${missing}`;
}
var TOOLS = [
  {
    name: "canvas_list",
    description: 'List all nodes and edges on a canvas. Returns node labels (N1, J3, etc.), types, and content previews. Use these labels to reference nodes in other tools. A code cell that has an output ends its line with "(output: C5)", and that output cell with "(output of: E6)". Lists the sections (S1\u2026, their y, kernel and title) when the canvas has any. Lists the kernel records (id, name, server, live id) when the canvas has any. A group entry in the file is listed as "group (not shown)", by its id when it has no label: the canvas keeps it but does not show it, lay it out or count it in a section.',
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Absolute, workspace-relative, or ~/... path to the .canvas file" }
      },
      required: ["canvasPath"]
    }
  },
  {
    name: "canvas_read",
    description: 'Read the full content and metadata of a canvas node by its label (e.g. N1, J3) or node ID. A code cell that has an output gets an "Output: C5 (id: \u2026)" line naming that output cell; an output cell gets an "Output of: E6 (id: \u2026)" line naming its code cell. An edge alone does not say which cell is an output.',
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Node label (N1, J3, etc.) or full node ID" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_search",
    description: "Search for canvas nodes whose labels, content, filenames, tags, or the labels of their edges contain a query string (case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        query: { type: "string", description: "Search string (case-insensitive)" },
        type: { type: "string", description: "Optional: filter by node type (text, file, cell, link, portal, etc.)" }
      },
      required: ["canvasPath", "query"]
    }
  },
  {
    name: "canvas_edges",
    description: "List all edges (connections) going to or from a specific node.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Node label or ID" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_follow",
    description: "Resolve a file or portal node to its filesystem path so you can read its contents. File nodes return their absolute path; portal nodes return the sub-canvas path; link nodes return their URL.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Node label or ID of a file, portal, or link node" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_add_node",
    description: `Add a new node to the canvas: text (default), code, cell, file, link, portal or noderef; any other type is refused with an error (a group too: the canvas does not show groups, a section does that job). The node is marked as AI-created (\u{1F916} badge) and assigned a label. Default sizes are the ones the canvas UI gives a new node: text ${NODE_SIZE.text.w}\xD7${NODE_SIZE.text.h}, code ${NODE_SIZE.code.w}\xD7${NODE_SIZE.code.h} (a code cell with content is as tall as its lines need, ${CODE_HEIGHT_RANGE}), cell ${CELL_SIZE.w}\xD7${CELL_SIZE.h}, file ${NODE_SIZE.file.w}\xD7${NODE_SIZE.file.h}, link ${NODE_SIZE.link.w}\xD7${NODE_SIZE.link.h} (a link to a YouTube video ${YOUTUBE_NODE.w}\xD7${YOUTUBE_NODE.h}, room for its thumbnail), portal ${NODE_SIZE.portal.w}\xD7${NODE_SIZE.portal.h}, noderef ${NODEREF_SIZE.w}\xD7${NODEREF_SIZE.h}; a supplied width or height is snapped to the grid. A noderef points at a node or a section in another canvas: canvas (the target .canvas file) and label (the target node's label, e.g. N3, or a section's label, e.g. S3 \u2014 S followed by digits always names a section), or canvas alone as path.canvas#N3, plus an optional title. Opening a section reference unfolds that section and focuses its first node. Position defaults to the right of all existing nodes. after puts the new node under any node, in that node's own column (the type defaults to code under a code cell, else to a text note); forkOf names a code cell: on side right the new node goes on that cell's row in the nearest column past its output column that holds a code cell (under the cell's own output when it would overlap it), else it starts a new column pair right of the cell's pair; on side left it starts a new column pair left of the cell's column; both ignore x/y. Whatever the placement, the layout engine then packs the column the node landed in and pushes the column pairs to its right and the notes it covers out of the way \u2014 never across a section boundary. Sections fit their content: a node placed past its section's bottom edge grows it, slack shrinks it (never under the minimum), and every section and node below moves by the same grid multiple, down or up. Supplied coordinates are snapped to the grid and clamped to the canvas origin.`,
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        type: { type: "string", description: `Node type: ${ADD_NODE_TYPES.join(", ")}; text is the default (code under a code cell)` },
        content: { type: "string", description: "Text of a text note or a cell, or the code of a code node" },
        format: { type: "string", description: "Cell format: markdown (default), html, image" },
        file: { type: "string", description: "File path for file nodes (vault:// URI, or a path; an absolute one under the canvas folder is stored relative to it)" },
        url: { type: "string", description: "URL for link nodes" },
        canvas: { type: "string", description: "portal: path of the target canvas relative to this canvas's folder, stored as given. noderef: the target .canvas \u2014 absolute (stored relative to the workspace folder, as Copy node reference writes it) or relative to the workspace folder \u2014 or the whole reference path.canvas#N3" },
        label: { type: "string", description: "noderef: the target node's label (N3, E10) or a section's label (S3)" },
        title: { type: "string", description: "noderef: optional text shown under the reference" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags for search/organisation" },
        color: { type: "string", description: "Node accent color: 1=red, 2=orange, 3=yellow, 4=green, 5=cyan, 6=purple" },
        x: { type: "number", description: "X position (auto-placed if omitted; ignored with after/forkOf)" },
        y: { type: "number", description: "Y position (auto-placed if omitted; ignored with after/forkOf)" },
        width: { type: "number", description: "Width in canvas units, snapped to the grid (default: the UI size for the type)" },
        height: { type: "number", description: `Height in canvas units, snapped to the grid (default: the UI size for the type; a code cell with content is sized to the lines it holds, ${CODE_HEIGHT_RANGE})` },
        after: { type: "string", description: "Label or id of any node: place the new node one gap below it in the same column (type defaults to code under a code cell, else text)" },
        forkOf: { type: "string", description: "Label or id of a code cell: the new node goes on its row beside it (see the tool description; type defaults to code)" },
        side: { type: "string", description: "forkOf side: right (default) or left; a left fork that would start before the canvas origin is refused" }
      },
      required: ["canvasPath"]
    }
  },
  {
    name: "canvas_update_node",
    description: `Update an existing node: content, tags, color, label, and/or move/resize it. Partial \u2014 only supplied fields change. content sets the text of a text note, the content of a cell or the code of a code cell; other types ignore it and a knowledge node refuses it. Code content that CHANGES the cell's text, with no explicit height, re-sizes it to the lines it now holds (grows or shrinks, ${CODE_HEIGHT_RANGE}) and counts as a resize; re-sending the same text re-sizes nothing, so a height set by hand is kept. Move/resize uses absolute canvas coordinates and runs the layout engine: the node's column is packed, the column pairs to its right are pushed clear, and the notes it covers move down. An output cell is clamped to ${OUTPUT_MAX_W} wide by ${OUTPUT_MAX_H} high so it cannot overlap the pair to its right. Sections fit their content: a node placed past its section's bottom edge grows it, slack shrinks it (never under the minimum), and every section and node below moves by the same grid multiple, down or up. Supplied coordinates and sizes are snapped to the grid; coordinates are clamped to the canvas origin.`,
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: `Node label or ID to update. ${ID_OVER_LABEL}` },
        content: { type: "string", description: "New text of a text note or a cell, or new code of a code cell" },
        tags: { type: "array", items: { type: "string" }, description: "Replace tags list" },
        color: { type: "string", description: "New accent color (1-6)" },
        label: { type: "string", description: "Override the node label (e.g. rename N5 to N1); not checked against the labels already in use" },
        x: { type: "number", description: "Move: absolute x (left)" },
        y: { type: "number", description: "Move: absolute y (top)" },
        width: { type: "number", description: "Resize: width" },
        height: { type: "number", description: `Resize: height (omit it and code content that CHANGES the text re-sizes the cell to the lines it now holds, ${CODE_HEIGHT_RANGE})` }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_add_knowledge",
    description: "Put a result you read from a knowledge server on the canvas as a knowledge node: the server name, the source URI, the title and the text you read, cached in the node so it reads offline. This server holds no knowledge-server token and never calls one \u2014 search the knowledge server yourself and pass the text you got back. The node is marked AI-created and assigned a W label; the canvas refreshes it from its server on a later open. Placement and the layout engine work as in canvas_add_node: `after` puts the node one gap below any node in that node's column and ignores x/y, otherwise x/y (snapped and clamped to the canvas origin) or a free slot right of everything; the column then packs, the pairs to its right are pushed clear, and the sections grow or shrink to fit.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        server: { type: "string", description: "Name of the knowledge server the result came from (a skena.knowledge.servers entry, e.g. crtx)" },
        uri: { type: "string", description: "Source URI as the server gave it (e.g. crtx://crtx/projects/skena.md#state); the canvas refreshes the node from it" },
        title: { type: "string", description: "Title shown in the node header" },
        text: { type: "string", description: "The markdown text you read from the server, cached in the node" },
        after: { type: "string", description: "Label or id of any node: place the new node one gap below it in the same column" },
        x: { type: "number", description: "X position (auto-placed if omitted; ignored with after)" },
        y: { type: "number", description: "Y position (auto-placed if omitted; ignored with after)" }
      },
      required: ["canvasPath", "server", "uri", "title", "text"]
    }
  },
  {
    name: "canvas_refresh_knowledge",
    description: "Mark a knowledge node stale so the canvas fetches its text again the next time it is opened. This server has no knowledge-server token, so it cannot fetch the text itself \u2014 it only dates the node back. To replace the text now, read the source yourself and add a new node with canvas_add_knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { type: "string", description: "Label (W1, W2\u2026) or id of the knowledge node" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_create",
    description: "Create a new empty .canvas file (with parent directories). No-op if it already exists.",
    inputSchema: {
      type: "object",
      properties: { canvasPath: { type: "string", description: "Path to the .canvas file to create" } },
      required: ["canvasPath"]
    }
  },
  {
    name: "canvas_layout",
    description: "Batch move/resize many nodes in one file write. Each item: { ref, x?, y?, width?, height? } (partial, absolute coordinates). Every moved node runs the layout engine over its section: its column is packed, the column pairs to its right are pushed clear, and the notes it covers move down. Sections fit their content: a node placed past its section's bottom edge grows it, slack shrinks it (never under the minimum), and every section and node below moves by the same grid multiple, down or up. Supplied coordinates are snapped to the grid and clamped to the canvas origin.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        nodes: {
          type: "array",
          description: "Nodes to position",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "Node label or ID" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" }
            },
            required: ["ref"]
          }
        }
      },
      required: ["canvasPath", "nodes"]
    }
  },
  {
    name: "canvas_update_edge",
    description: "Update an existing edge: label, color, and/or handle sides. Partial. ref is an edge id, or { from, to } node labels/ids (either optional).",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { oneOf: [{ type: "string" }, { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } }], description: "Edge id, or { from, to } node refs" },
        label: { type: "string", description: "New edge label" },
        color: { type: "string", description: "Edge color (1-6)" },
        fromSide: { type: "string", description: "Source handle: top, right, bottom, left" },
        toSide: { type: "string", description: "Target handle: top, left, bottom, right" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_remove_edge",
    description: "Delete an edge. ref is an edge id, or { from, to } node labels/ids (either optional).",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { oneOf: [{ type: "string" }, { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } }], description: "Edge id, or { from, to } node refs" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_remove_node",
    description: "Delete one or more nodes from the canvas (also removes their connected edges). The column each deleted node sat in closes the hole it left (a deleted output counts for its code cell's column). A code cell's output is deleted only when it is named too; deleting a kernel node does not shut its kernel down. Sections fit their content.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        ref: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: `Node label, node ID, or array of labels/IDs to delete. ${ID_OVER_LABEL}` }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_add_edge",
    description: "Connect two canvas nodes with a directed edge.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        from: { type: "string", description: "Source node label or ID" },
        to: { type: "string", description: "Target node label or ID" },
        label: { type: "string", description: "Optional edge label text" },
        fromSide: { type: "string", description: "Source handle: top, right (default), bottom, left" },
        toSide: { type: "string", description: "Target handle: top, left (default), bottom, right" },
        color: { type: "string", description: "Edge color (1-6)" }
      },
      required: ["canvasPath", "from", "to"]
    }
  },
  {
    name: "canvas_pin_output",
    description: `Pin a content snippet (analysis result, notebook output, HTML table, image) as a cell node on the canvas. With sourceRef it is connected from that node by an edge labelled with the date and time (or edgeLabel). Pinned onto a code cell that has no output yet, it becomes that cell's output: it is placed in the pair's output column, and the column below and the pairs to the right may move. Pinned onto any other node, or a code cell that already has an output, it is a ${CELL_SIZE.w}\xD7${CELL_SIZE.h} cell beside the source; with no source, right of all existing nodes.`,
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        content: { type: "string", description: "Content to pin (markdown text, HTML string, or base64 image data URI)" },
        format: { type: "string", description: "Content format: html (default), markdown, image" },
        sourceRef: { type: "string", description: "Optional: label/ID of the node this output came from (notebook, analysis). Creates an edge." },
        edgeLabel: { type: "string", description: "Label for the connecting edge (defaults to current timestamp yy-mm-dd hh:mm)" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" }
      },
      required: ["canvasPath", "content"]
    }
  },
  {
    name: "canvas_run_section",
    description: "Run every code cell of a section in run order (top to bottom, then left to right), each on its own resolved kernel, whether it has run before or not, stopping at the first error. Needs a live kernel on a server this process can find, as canvas_run_cell does. A new output is placed in its pair's output column; the column below and the pairs to the right may move.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        ref: { type: "string", description: "S1, S2 \u2026 as printed by canvas_list, or the section id" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_add_kernel",
    description: `Add a kernel record to the canvas (the kind a section binds, not a kernel node). By default it starts the kernel on the Jupyter server at once, as the rail's "New kernel\u2026" does, so cells can run on it immediately. ${KERNEL_SERVERS_TEXT}`,
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        server: { type: "string", description: "name of a Jupyter server this process can find (see the tool description), e.g. a skena.jupyter.kernels[].name" },
        spec: { type: "string", description: "optional: kernelspec to launch, default python3; remembered so a restart reuses the same environment" },
        displayName: { type: "string", description: "optional: name shown in the rail; defaults to the spec" },
        bindSection: { type: "string", description: "optional: section to bind it to (S1, S2 \u2026 or the section id)" },
        start: { type: "boolean", description: "optional: start the kernel now, default true" }
      },
      required: ["canvasPath", "server"]
    }
  },
  {
    name: "canvas_remove_kernel",
    description: "Remove a kernel record: shut it down if it is live and its server can be found, unbind every section that named it, and un-run the cells that ran on it (its namespace is gone with it). A kernel NODE is removed with canvas_remove_node instead.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        ref: { type: "string", description: "kernel record id or display name" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_add_section",
    description: "Add a section (a horizontal lane; a node belongs to the lane whose range holds its top edge). Without y it goes under the last section's fitted range, as the rail's + does; with y it is snapped to the grid and inserted there, splitting the lane it lands in \u2014 nodes stay where they are and membership follows y. The section is fitted like every other write: a y inside the empty part of the section above is pulled up to that section's content, and the nodes below move with it; the returned y is the final one.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        title: { type: "string", description: "optional: section title; without one the rail shows the creation datetime" },
        y: { type: "number", description: "optional: canvas y where the section starts (snapped to the grid, must be \u2265 0); default is under the last section" }
      },
      required: ["canvasPath"]
    }
  },
  {
    name: "canvas_remove_section",
    description: "Delete a section: the nodes and edges of the section are deleted with it (including the ones a fold hides). The topmost remaining section re-parks at the canvas origin, fold lists drop the removed ids, and sections fit their content.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        ref: { type: "string", description: "S1, S2 \u2026 as printed by canvas_list, or the section id" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_update_section",
    description: "Rename a section, bind or unbind its kernel, or fold it. Folding hides its nodes (they stay in the file, pinned to the section); unfolding grows the section back before releasing them, so the section below cannot adopt one. Sections then fit their content.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        ref: { type: "string", description: "S1, S2 \u2026 as printed by canvas_list, or the section id" },
        title: { type: "string", description: "optional: new title; an empty string clears it" },
        kernelRef: { type: ["string", "null"], description: "optional: a kernel record id or display name, or a kernel node label/id; null unbinds" },
        folded: { type: "boolean", description: "optional: true folds the section, false unfolds it" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_reflow_section",
    description: "Lay out a whole section again: the only write that moves more than the column it touches. Every node is put on a column, left to right \u2014 the code cells decide where the columns are, then every other node joins the nearest column that reaches it or starts its own (an output cell goes back to its pair's output slot; a kernel node stays where it is). Every column is packed (a node an edge holds on another node's row keeps that row), the columns are moved tight left to right one gap apart (the output slot is kept only after a column that has an output), and the columns are packed again. Sizes do not change; nothing is written when nothing moves. Sections fit their content afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        ref: { type: "string", description: "S1, S2 \u2026 as printed by canvas_list, or the section id" }
      },
      required: ["canvasPath", "ref"]
    }
  },
  {
    name: "canvas_run_cell",
    description: `Run a code cell node on a Jupyter kernel and write its output to a linked cell node. Resolves the kernel from kernelRef, else the code node's bound-kernel edge, else the kernel bound to the node's section; the kernel must be live. First runs, in order, the cells upstream of it that have not run successfully yet; a failed one stops the chain. The reply ends with the first 500 characters of the stream output. A new output is placed in its pair's output column; the column below and the pairs to the right may move. ${KERNEL_SERVERS_TEXT}`,
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "absolute path to the .canvas file" },
        cellRef: { type: "string", description: `label or id of the code node to run. ${ID_OVER_LABEL}` },
        kernelRef: { type: "string", description: "optional: a kernel record id or display name, or a kernel node label/id; defaults to the resolved one" }
      },
      required: ["canvasPath", "cellRef"]
    }
  },
  {
    name: "canvas_export_html",
    description: "Write the canvas as one self-contained HTML page that loads nothing from the network: every node at its canvas position and size with its label, sections as frames (folded ones drawn unfolded), edges with their labels, math (KaTeX, Typst), code cells in the skena.code.theme colours, output cells (html, images, plotly), knowledge nodes and markdown files in full, all fonts and images inlined. Read-only on the .canvas file. The page is rendered by the skena extension of the running VS Code window of this workspace; without one this tool says so.",
    inputSchema: {
      type: "object",
      properties: {
        canvasPath: { type: "string", description: "Path to the .canvas file" },
        outPath: { type: "string", description: "Where to write the page: absolute, ~/..., or relative to the canvas's folder; default: next to the canvas, same name, .html. An existing file is overwritten; a .canvas file never is." }
      },
      required: ["canvasPath"]
    }
  }
];
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id, result) {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}
function err(id, code, message) {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}
async function dispatch(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "skena", version: "1.0.0" }
    });
    return;
  }
  if (method === "notifications/initialized")
    return;
  if (method === "tools/list") {
    ok(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name ?? "";
    const args = params?.arguments ?? {};
    try {
      let text;
      switch (name) {
        case "canvas_list":
          text = await canvasList(args);
          break;
        case "canvas_read":
          text = await canvasRead(args);
          break;
        case "canvas_search":
          text = await canvasSearch(args);
          break;
        case "canvas_edges":
          text = await canvasEdges(args);
          break;
        case "canvas_follow":
          text = await canvasFollow(args);
          break;
        case "canvas_add_node":
          text = await canvasAddNode(args);
          break;
        case "canvas_update_node":
          text = await canvasUpdateNode(args);
          break;
        case "canvas_add_knowledge":
          text = await canvasAddKnowledge(args);
          break;
        case "canvas_refresh_knowledge":
          text = await canvasRefreshKnowledge(args);
          break;
        case "canvas_remove_node":
          text = await canvasRemoveNode(args);
          break;
        case "canvas_add_edge":
          text = await canvasAddEdge(args);
          break;
        case "canvas_update_edge":
          text = await canvasUpdateEdge(args);
          break;
        case "canvas_remove_edge":
          text = await canvasRemoveEdge(args);
          break;
        case "canvas_layout":
          text = await canvasLayout(args);
          break;
        case "canvas_create":
          text = await canvasCreate(args);
          break;
        case "canvas_pin_output":
          text = await canvasPinOutput(args);
          break;
        case "canvas_run_cell":
          text = await canvasRunCell(args);
          break;
        case "canvas_add_section":
          text = await canvasAddSection(args);
          break;
        case "canvas_remove_section":
          text = await canvasRemoveSection(args);
          break;
        case "canvas_update_section":
          text = await canvasUpdateSection(args);
          break;
        case "canvas_run_section":
          text = await canvasRunSection(args);
          break;
        case "canvas_reflow_section":
          text = await canvasReflowSection(args);
          break;
        case "canvas_add_kernel":
          text = await canvasAddKernel(args);
          break;
        case "canvas_remove_kernel":
          text = await canvasRemoveKernel(args);
          break;
        case "canvas_export_html":
          text = await canvasExportHtml(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      ok(id, { content: [{ type: "text", text }] });
    } catch (e) {
      const msg2 = e instanceof Error ? e.message : String(e);
      ok(id, { content: [{ type: "text", text: `Error: ${msg2}` }], isError: true });
    }
    return;
  }
  err(id, -32601, `Method not found: ${method}`);
}
var rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed)
    return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  dispatch(msg).catch((e) => {
    process.stderr.write(`Skena MCP: unhandled error: ${e}
`);
  });
});
rl.on("close", () => process.exit(0));
process.stdin.resume();
//# sourceMappingURL=mcp-server.js.map
