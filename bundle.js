(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const logElem = exports.logElem = document.querySelector('.log')
const logHeading = document.querySelector('#logHeading')
const speed = document.querySelector('.speed')

exports.log = function log (item, unsafe) {
  logHeading.style.display = 'block'

  const p = document.createElement('p')
  if (unsafe) p.innerHTML = item
  else p.textContent = item
  logElem.appendChild(p)
  return p
}

exports.unsafeLog = function unsafeLog (item) {
  return exports.log(item, true)
}

exports.appendElemToLog = function append (item) {
  logHeading.style.display = 'block'

  logElem.appendChild(item)
  exports.lineBreak()
  return item
}

exports.lineBreak = function lineBreak () {
  logElem.appendChild(document.createElement('br'))
}

// replace the last P in the log
exports.updateSpeed = function updateSpeed (str) {
  speed.innerHTML = str
}

exports.warning = function warning (err) {
  console.error(err.stack || err.message || err)
  return exports.log(err.message || err)
}

exports.error = function error (err) {
  console.error(err.stack || err.message || err)
  const p = exports.log(err.message || err)
  p.style.color = 'red'
  p.style.fontWeight = 'bold'
  return p
}

},{}],2:[function(require,module,exports){
(function (global){(function (){
const createTorrent = require('create-torrent')
const debug = require('debug')('instant.io')
const dragDrop = require('drag-drop')
const escapeHtml = require('escape-html')
const get = require('simple-get')
const formatDistance = require('date-fns/formatDistance')
const path = require('path')
const prettierBytes = require('prettier-bytes')
const throttle = require('throttleit')
const thunky = require('thunky')
const uploadElement = require('upload-element')
const WebTorrent = require('webtorrent')
const JSZip = require('jszip')
const SimplePeer = require('simple-peer')

const util = require('./util')

global.WEBTORRENT_ANNOUNCE = createTorrent.announceList
  .map(function (arr) {
    return arr[0]
  })
  .filter(function (url) {
    return url.indexOf('wss://') === 0 || url.indexOf('ws://') === 0
  })

const DISALLOWED = [
  '6feb54706f41f459f819c0ae5b560a21ebfead8f'
]

const getClient = thunky(function (cb) {
  getRtcConfig(function (err, rtcConfig) {
    if (err) util.error(err)
    const client = new WebTorrent({
      tracker: {
        rtcConfig: {
          ...SimplePeer.config,
          ...rtcConfig
        }
      }
    })
    window.client = client // for easier debugging
    client.on('warning', util.warning)
    client.on('error', util.error)
    cb(null, client)
  })
})

init()

function init () {
  if (!WebTorrent.WEBRTC_SUPPORT) {
    util.error('This browser is unsupported. Please use a browser with WebRTC support.')
  }

  // For performance, create the client immediately
  getClient(function () {})

  // Seed via upload input element
  const upload = document.querySelector('input[name=upload]')
  if (upload) {
    uploadElement(upload, function (err, files) {
      if (err) return util.error(err)
      files = files.map(function (file) { return file.file })
      onFiles(files)
    })
  }

  // Seed via drag-and-drop
  dragDrop('body', onFiles)

  // Download via input element
  const form = document.querySelector('form')
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      downloadTorrent(document.querySelector('form input[name=torrentId]').value.trim())
    })
  }

  // Download by URL hash
  onHashChange()
  window.addEventListener('hashchange', onHashChange)
  function onHashChange () {
    const hash = decodeURIComponent(window.location.hash.substring(1)).trim()
    if (hash !== '') downloadTorrent(hash)
  }

  // Register a protocol handler for "magnet:" (will prompt the user)
  if ('registerProtocolHandler' in navigator) {
    navigator.registerProtocolHandler('magnet', window.location.origin + '#%s', 'Instant.io')
  }
}

function getRtcConfig (cb) {
  // WARNING: This is *NOT* a public endpoint. Do not depend on it in your app.
  get.concat({
    url: '/__rtcConfig__',
    timeout: 5000
  }, function (err, res, data) {
    if (err || res.statusCode !== 200) {
      cb(new Error('Could not get WebRTC config from server. Using default (without TURN).'))
    } else {
      try {
        data = JSON.parse(data)
      } catch (err) {
        return cb(new Error('Got invalid WebRTC config from server: ' + data))
      }
      debug('got rtc config: %o', data.rtcConfig)
      cb(null, data.rtcConfig)
    }
  })
}

function onFiles (files) {
  debug('got files:')
  files.forEach(function (file) {
    debug(' - %s (%s bytes)', file.name, file.size)
  })

  // .torrent file = start downloading the torrent
  files.filter(isTorrentFile).forEach(downloadTorrentFile)

  // everything else = seed these files
  seed(files.filter(isNotTorrentFile))
}

function isTorrentFile (file) {
  const extname = path.extname(file.name).toLowerCase()
  return extname === '.torrent'
}

function isNotTorrentFile (file) {
  return !isTorrentFile(file)
}

function downloadTorrent (torrentId) {
  const disallowed = DISALLOWED.some(function (infoHash) {
    return torrentId.indexOf(infoHash) >= 0
  })

  if (disallowed) {
    util.log('File not found ' + torrentId)
  } else {
    util.log('Downloading torrent from ' + torrentId)
    getClient(function (err, client) {
      if (err) return util.error(err)
      client.add(torrentId, onTorrent)
    })
  }
}

function downloadTorrentFile (file) {
  util.unsafeLog('Downloading torrent from <strong>' + escapeHtml(file.name) + '</strong>')
  getClient(function (err, client) {
    if (err) return util.error(err)
    client.add(file, onTorrent)
  })
}

function seed (files) {
  if (files.length === 0) return
  util.log('Seeding ' + files.length + ' files')

  // Seed from WebTorrent
  getClient(function (err, client) {
    if (err) return util.error(err)
    client.seed(files, onTorrent)
  })
}

function onTorrent (torrent) {
  torrent.on('warning', util.warning)
  torrent.on('error', util.error)

  const upload = document.querySelector('input[name=upload]')
  upload.value = upload.defaultValue // reset upload element

  const torrentFileName = path.basename(torrent.name, path.extname(torrent.name)) + '.torrent'

  util.log('"' + torrentFileName + '" contains ' + torrent.files.length + ' files:')

  torrent.files.forEach(function (file) {
    util.unsafeLog('&nbsp;&nbsp;- ' + escapeHtml(file.name) + ' (' + escapeHtml(prettierBytes(file.length)) + ')')
  })

  util.log('Torrent info hash: ' + torrent.infoHash)
  util.unsafeLog(
    '<a href="/#' + escapeHtml(torrent.infoHash) + '" onclick="prompt(\'Share this link with anyone you want to download this torrent:\', this.href);return false;">[Share link]</a> ' +
    '<a href="' + escapeHtml(torrent.magnetURI) + '" target="_blank">[Magnet URI]</a> ' +
    '<a href="' + escapeHtml(torrent.torrentFileBlobURL) + '" target="_blank" download="' + escapeHtml(torrentFileName) + '">[Download .torrent]</a>'
  )

  function updateSpeed () {
    const progress = (100 * torrent.progress).toFixed(1)

    let remaining
    if (torrent.done) {
      remaining = 'Done.'
    } else {
      remaining = torrent.timeRemaining !== Infinity
        ? formatDistance(torrent.timeRemaining, 0, { includeSeconds: true })
        : 'Infinity years'
      remaining = remaining[0].toUpperCase() + remaining.substring(1) + ' remaining.'
    }

    util.updateSpeed(
      '<b>Peers:</b> ' + torrent.numPeers + ' ' +
      '<b>Progress:</b> ' + progress + '% ' +
      '<b>Download speed:</b> ' + prettierBytes(window.client.downloadSpeed) + '/s ' +
      '<b>Upload speed:</b> ' + prettierBytes(window.client.uploadSpeed) + '/s ' +
      '<b>ETA:</b> ' + remaining
    )
  }

  torrent.on('download', throttle(updateSpeed, 250))
  torrent.on('upload', throttle(updateSpeed, 250))
  setInterval(updateSpeed, 5000)
  updateSpeed()

  torrent.files.forEach(function (file) {
    // append file
    file.appendTo(util.logElem, {
      maxBlobLength: 2 * 1000 * 1000 * 1000 // 2 GB
    }, function (err, elem) {
      if (err) return util.error(err)
    })

    // append download link
    file.getBlobURL(function (err, url) {
      if (err) return util.error(err)

      const a = document.createElement('a')
      a.target = '_blank'
      a.download = file.name
      a.href = url
      a.textContent = 'Download ' + file.name
      util.appendElemToLog(a)
    })
  })

  const downloadZip = document.createElement('a')
  downloadZip.href = '#'
  downloadZip.target = '_blank'
  downloadZip.textContent = 'Download all files as zip'
  downloadZip.addEventListener('click', function (event) {
    let addedFiles = 0
    const zipFilename = path.basename(torrent.name, path.extname(torrent.name)) + '.zip'
    let zip = new JSZip()
    event.preventDefault()

    torrent.files.forEach(function (file) {
      file.getBlob(function (err, blob) {
        addedFiles += 1
        if (err) return util.error(err)

        // add file to zip
        zip.file(file.path, blob)

        // start the download when all files have been added
        if (addedFiles === torrent.files.length) {
          if (torrent.files.length > 1) {
            // generate the zip relative to the torrent folder
            zip = zip.folder(torrent.name)
          }
          zip.generateAsync({ type: 'blob' })
            .then(function (blob) {
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.download = zipFilename
              a.href = url
              a.click()
              setTimeout(function () {
                URL.revokeObjectURL(url)
              }, 30 * 1000)
            }, util.error)
        }
      })
    })
  })
  util.appendElemToLog(downloadZip)
}

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./util":1,"create-torrent":71,"date-fns/formatDistance":98,"debug":111,"drag-drop":113,"escape-html":116,"jszip":141,"path":203,"prettier-bytes":205,"simple-get":238,"simple-peer":239,"throttleit":299,"thunky":300,"upload-element":308,"webtorrent":315}],3:[function(require,module,exports){
const ADDR_RE = /^\[?([^\]]+)\]?:(\d+)$/ // ipv4/ipv6/hostname + port

let cache = {}

// reset cache when it gets to 100,000 elements (~ 600KB of ipv4 addresses)
// so it will not grow to consume all memory in long-running processes
let size = 0

module.exports = function addrToIPPort (addr) {
  if (size === 100000) module.exports.reset()
  if (!cache[addr]) {
    const m = ADDR_RE.exec(addr)
    if (!m) throw new Error(`invalid addr: ${addr}`)
    cache[addr] = [ m[1], Number(m[2]) ]
    size += 1
  }
  return cache[addr]
}

module.exports.reset = function reset () {
  cache = {}
  size = 0
}

},{}],4:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  var i
  for (i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}

},{}],5:[function(require,module,exports){
var Buffer = require('safe-buffer').Buffer

const INTEGER_START = 0x69 // 'i'
const STRING_DELIM = 0x3A // ':'
const DICTIONARY_START = 0x64 // 'd'
const LIST_START = 0x6C // 'l'
const END_OF_TYPE = 0x65 // 'e'

/**
 * replaces parseInt(buffer.toString('ascii', start, end)).
 * For strings with less then ~30 charachters, this is actually a lot faster.
 *
 * @param {Buffer} data
 * @param {Number} start
 * @param {Number} end
 * @return {Number} calculated number
 */
function getIntFromBuffer (buffer, start, end) {
  var sum = 0
  var sign = 1

  for (var i = start; i < end; i++) {
    var num = buffer[i]

    if (num < 58 && num >= 48) {
      sum = sum * 10 + (num - 48)
      continue
    }

    if (i === start && num === 43) { // +
      continue
    }

    if (i === start && num === 45) { // -
      sign = -1
      continue
    }

    if (num === 46) { // .
      // its a float. break here.
      break
    }

    throw new Error('not a number: buffer[' + i + '] = ' + num)
  }

  return sum * sign
}

/**
 * Decodes bencoded data.
 *
 * @param  {Buffer} data
 * @param  {Number} start (optional)
 * @param  {Number} end (optional)
 * @param  {String} encoding (optional)
 * @return {Object|Array|Buffer|String|Number}
 */
function decode (data, start, end, encoding) {
  if (data == null || data.length === 0) {
    return null
  }

  if (typeof start !== 'number' && encoding == null) {
    encoding = start
    start = undefined
  }

  if (typeof end !== 'number' && encoding == null) {
    encoding = end
    end = undefined
  }

  decode.position = 0
  decode.encoding = encoding || null

  decode.data = !(Buffer.isBuffer(data))
    ? Buffer.from(data)
    : data.slice(start, end)

  decode.bytes = decode.data.length

  return decode.next()
}

decode.bytes = 0
decode.position = 0
decode.data = null
decode.encoding = null

decode.next = function () {
  switch (decode.data[decode.position]) {
    case DICTIONARY_START:
      return decode.dictionary()
    case LIST_START:
      return decode.list()
    case INTEGER_START:
      return decode.integer()
    default:
      return decode.buffer()
  }
}

decode.find = function (chr) {
  var i = decode.position
  var c = decode.data.length
  var d = decode.data

  while (i < c) {
    if (d[i] === chr) return i
    i++
  }

  throw new Error(
    'Invalid data: Missing delimiter "' +
    String.fromCharCode(chr) + '" [0x' +
    chr.toString(16) + ']'
  )
}

decode.dictionary = function () {
  decode.position++

  var dict = {}

  while (decode.data[decode.position] !== END_OF_TYPE) {
    dict[decode.buffer()] = decode.next()
  }

  decode.position++

  return dict
}

decode.list = function () {
  decode.position++

  var lst = []

  while (decode.data[decode.position] !== END_OF_TYPE) {
    lst.push(decode.next())
  }

  decode.position++

  return lst
}

decode.integer = function () {
  var end = decode.find(END_OF_TYPE)
  var number = getIntFromBuffer(decode.data, decode.position + 1, end)

  decode.position += end + 1 - decode.position

  return number
}

decode.buffer = function () {
  var sep = decode.find(STRING_DELIM)
  var length = getIntFromBuffer(decode.data, decode.position, sep)
  var end = ++sep + length

  decode.position = end

  return decode.encoding
    ? decode.data.toString(decode.encoding, sep, end)
    : decode.data.slice(sep, end)
}

module.exports = decode

},{"safe-buffer":236}],6:[function(require,module,exports){
var Buffer = require('safe-buffer').Buffer

/**
 * Encodes data in bencode.
 *
 * @param  {Buffer|Array|String|Object|Number|Boolean} data
 * @return {Buffer}
 */
function encode (data, buffer, offset) {
  var buffers = []
  var result = null

  encode._encode(buffers, data)
  result = Buffer.concat(buffers)
  encode.bytes = result.length

  if (Buffer.isBuffer(buffer)) {
    result.copy(buffer, offset)
    return buffer
  }

  return result
}

encode.bytes = -1
encode._floatConversionDetected = false

encode.getType = function (value) {
  if (Buffer.isBuffer(value)) return 'buffer'
  if (Array.isArray(value)) return 'array'
  if (ArrayBuffer.isView(value)) return 'arraybufferview'
  if (value instanceof Number) return 'number'
  if (value instanceof Boolean) return 'boolean'
  if (value instanceof ArrayBuffer) return 'arraybuffer'
  return typeof value
}

encode._encode = function (buffers, data) {
  if (data == null) { return }

  switch (encode.getType(data)) {
    case 'buffer': encode.buffer(buffers, data); break
    case 'object': encode.dict(buffers, data); break
    case 'array': encode.list(buffers, data); break
    case 'string': encode.string(buffers, data); break
    case 'number': encode.number(buffers, data); break
    case 'boolean': encode.number(buffers, data); break
    case 'arraybufferview': encode.buffer(buffers, Buffer.from(data.buffer, data.byteOffset, data.byteLength)); break
    case 'arraybuffer': encode.buffer(buffers, Buffer.from(data)); break
  }
}

var buffE = Buffer.from('e')
var buffD = Buffer.from('d')
var buffL = Buffer.from('l')

encode.buffer = function (buffers, data) {
  buffers.push(Buffer.from(data.length + ':'), data)
}

encode.string = function (buffers, data) {
  buffers.push(Buffer.from(Buffer.byteLength(data) + ':' + data))
}

encode.number = function (buffers, data) {
  var maxLo = 0x80000000
  var hi = (data / maxLo) << 0
  var lo = (data % maxLo) << 0
  var val = hi * maxLo + lo

  buffers.push(Buffer.from('i' + val + 'e'))

  if (val !== data && !encode._floatConversionDetected) {
    encode._floatConversionDetected = true
    console.warn(
      'WARNING: Possible data corruption detected with value "' + data + '":',
      'Bencoding only defines support for integers, value was converted to "' + val + '"'
    )
    console.trace()
  }
}

encode.dict = function (buffers, data) {
  buffers.push(buffD)

  var j = 0
  var k
  // fix for issue #13 - sorted dicts
  var keys = Object.keys(data).sort()
  var kl = keys.length

  for (; j < kl; j++) {
    k = keys[j]
    if (data[k] == null) continue
    encode.string(buffers, k)
    encode._encode(buffers, data[k])
  }

  buffers.push(buffE)
}

encode.list = function (buffers, data) {
  var i = 0
  var c = data.length
  buffers.push(buffL)

  for (; i < c; i++) {
    if (data[i] == null) continue
    encode._encode(buffers, data[i])
  }

  buffers.push(buffE)
}

module.exports = encode

},{"safe-buffer":236}],7:[function(require,module,exports){
var bencode = module.exports

bencode.encode = require('./encode')
bencode.decode = require('./decode')

/**
 * Determines the amount of bytes
 * needed to encode the given value
 * @param  {Object|Array|Buffer|String|Number|Boolean} value
 * @return {Number} byteCount
 */
bencode.byteLength = bencode.encodingLength = function (value) {
  return bencode.encode(value).length
}

},{"./decode":5,"./encode":6}],8:[function(require,module,exports){
module.exports = parseRange
module.exports.parse = parseRange
module.exports.compose = composeRange

function composeRange (range) {
  return range
    .reduce((acc, cur, idx, arr) => {
      if (idx === 0 || cur !== arr[idx - 1] + 1) acc.push([])
      acc[acc.length - 1].push(cur)
      return acc
    }, [])
    .map((cur) => {
      return cur.length > 1 ? `${cur[0]}-${cur[cur.length - 1]}` : `${cur[0]}`
    })
}

function parseRange (range) {
  const generateRange = (start, end = start) => Array.from({ length: end - start + 1 }, (cur, idx) => idx + start)

  return range
    .reduce((acc, cur, idx, arr) => {
      const r = cur.split('-').map(cur => parseInt(cur))
      return acc.concat(generateRange(...r))
    }, [])
}

},{}],9:[function(require,module,exports){
module.exports = function(haystack, needle, comparator, low, high) {
  var mid, cmp;

  if(low === undefined)
    low = 0;

  else {
    low = low|0;
    if(low < 0 || low >= haystack.length)
      throw new RangeError("invalid lower bound");
  }

  if(high === undefined)
    high = haystack.length - 1;

  else {
    high = high|0;
    if(high < low || high >= haystack.length)
      throw new RangeError("invalid upper bound");
  }

  while(low <= high) {
    // The naive `low + high >>> 1` could fail for array lengths > 2**31
    // because `>>>` converts its operands to int32. `low + (high - low >>> 1)`
    // works for array lengths <= 2**32-1 which is also Javascript's max array
    // length.
    mid = low + ((high - low) >>> 1);
    cmp = +comparator(haystack[mid], needle, mid, haystack);

    // Too low.
    if(cmp < 0.0)
      low  = mid + 1;

    // Too high.
    else if(cmp > 0.0)
      high = mid - 1;

    // Key found.
    else
      return mid;
  }

  // Key not found.
  return ~low;
}

},{}],10:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function getByteSize(num) {
    var out = num >> 3;
    if (num % 8 !== 0)
        out++;
    return out;
}
var BitField = /** @class */ (function () {
    /**
     *
     *
     * @param data Either a number representing the maximum number of supported bytes, or a Uint8Array.
     * @param opts Options for the bitfield.
     */
    function BitField(data, opts) {
        if (data === void 0) { data = 0; }
        var grow = opts === null || opts === void 0 ? void 0 : opts.grow;
        this.grow = (grow && isFinite(grow) && getByteSize(grow)) || grow || 0;
        this.buffer =
            typeof data === "number" ? new Uint8Array(getByteSize(data)) : data;
    }
    /**
     * Get a particular bit.
     *
     * @param i Bit index to retrieve.
     * @returns A boolean indicating whether the `i`th bit is set.
     */
    BitField.prototype.get = function (i) {
        var j = i >> 3;
        return j < this.buffer.length && !!(this.buffer[j] & (128 >> i % 8));
    };
    /**
     * Set a particular bit.
     *
     * Will grow the underlying array if the bit is out of bounds and the `grow` option is set.
     *
     * @param i Bit index to set.
     * @param value Value to set the bit to. Defaults to `true`.
     */
    BitField.prototype.set = function (i, value) {
        if (value === void 0) { value = true; }
        var j = i >> 3;
        if (value) {
            if (this.buffer.length < j + 1) {
                var length_1 = Math.max(j + 1, Math.min(2 * this.buffer.length, this.grow));
                if (length_1 <= this.grow) {
                    var newBuffer = new Uint8Array(length_1);
                    newBuffer.set(this.buffer);
                    this.buffer = newBuffer;
                }
            }
            // Set
            this.buffer[j] |= 128 >> i % 8;
        }
        else if (j < this.buffer.length) {
            // Clear
            this.buffer[j] &= ~(128 >> i % 8);
        }
    };
    /**
     * Loop through the bits in the bitfield.
     *
     * @param fn Function to be called with the bit value and index.
     * @param start Index of the first bit to look at.
     * @param end Index of the first bit that should no longer be considered.
     */
    BitField.prototype.forEach = function (fn, start, end) {
        if (start === void 0) { start = 0; }
        if (end === void 0) { end = this.buffer.length * 8; }
        for (var i = start, j = i >> 3, y = 128 >> i % 8, byte = this.buffer[j]; i < end; i++) {
            fn(!!(byte & y), i);
            y = y === 1 ? ((byte = this.buffer[++j]), 128) : y >> 1;
        }
    };
    return BitField;
}());
exports.default = BitField;

},{}],11:[function(require,module,exports){
(function (Buffer){(function (){
/*! bittorrent-protocol. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
const arrayRemove = require('unordered-array-remove')
const bencode = require('bencode')
const BitField = require('bitfield').default
const debug = require('debug')('bittorrent-protocol')
const randombytes = require('randombytes')
const speedometer = require('speedometer')
const stream = require('readable-stream')

const BITFIELD_GROW = 400000
const KEEP_ALIVE_TIMEOUT = 55000

const MESSAGE_PROTOCOL = Buffer.from('\u0013BitTorrent protocol')
const MESSAGE_KEEP_ALIVE = Buffer.from([0x00, 0x00, 0x00, 0x00])
const MESSAGE_CHOKE = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00])
const MESSAGE_UNCHOKE = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01])
const MESSAGE_INTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02])
const MESSAGE_UNINTERESTED = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03])

const MESSAGE_RESERVED = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
const MESSAGE_PORT = [0x00, 0x00, 0x00, 0x03, 0x09, 0x00, 0x00]

class Request {
  constructor (piece, offset, length, callback) {
    this.piece = piece
    this.offset = offset
    this.length = length
    this.callback = callback
  }
}

class Wire extends stream.Duplex {
  constructor () {
    super()

    this._debugId = randombytes(4).toString('hex')
    this._debug('new wire')

    this.peerId = null // remote peer id (hex string)
    this.peerIdBuffer = null // remote peer id (buffer)
    this.type = null // connection type ('webrtc', 'tcpIncoming', 'tcpOutgoing', 'webSeed')

    this.amChoking = true // are we choking the peer?
    this.amInterested = false // are we interested in the peer?

    this.peerChoking = true // is the peer choking us?
    this.peerInterested = false // is the peer interested in us?

    // The largest torrent that I know of (the Geocities archive) is ~641 GB and has
    // ~41,000 pieces. Therefore, cap bitfield to 10x larger (400,000 bits) to support all
    // possible torrents but prevent malicious peers from growing bitfield to fill memory.
    this.peerPieces = new BitField(0, { grow: BITFIELD_GROW })

    this.peerExtensions = {}

    this.requests = [] // outgoing
    this.peerRequests = [] // incoming

    this.extendedMapping = {} // number -> string, ex: 1 -> 'ut_metadata'
    this.peerExtendedMapping = {} // string -> number, ex: 9 -> 'ut_metadata'

    // The extended handshake to send, minus the "m" field, which gets automatically
    // filled from `this.extendedMapping`
    this.extendedHandshake = {}

    this.peerExtendedHandshake = {} // remote peer's extended handshake

    this._ext = {} // string -> function, ex 'ut_metadata' -> ut_metadata()
    this._nextExt = 1

    this.uploaded = 0
    this.downloaded = 0
    this.uploadSpeed = speedometer()
    this.downloadSpeed = speedometer()

    this._keepAliveInterval = null
    this._timeout = null
    this._timeoutMs = 0
    this._timeoutExpiresAt = null

    this.destroyed = false // was the wire ended by calling `destroy`?
    this._finished = false

    this._parserSize = 0 // number of needed bytes to parse next message from remote peer
    this._parser = null // function to call once `this._parserSize` bytes are available

    this._buffer = [] // incomplete message data
    this._bufferSize = 0 // cached total length of buffers in `this._buffer`

    this.once('finish', () => this._onFinish())

    this._parseHandshake()
  }

  /**
   * Set whether to send a "keep-alive" ping (sent every 55s)
   * @param {boolean} enable
   */
  setKeepAlive (enable) {
    this._debug('setKeepAlive %s', enable)
    clearInterval(this._keepAliveInterval)
    if (enable === false) return
    this._keepAliveInterval = setInterval(() => {
      this.keepAlive()
    }, KEEP_ALIVE_TIMEOUT)
  }

  /**
   * Set the amount of time to wait before considering a request to be "timed out"
   * @param {number} ms
   * @param {boolean=} unref (should the timer be unref'd? default: false)
   */
  setTimeout (ms, unref) {
    this._debug('setTimeout ms=%d unref=%s', ms, unref)
    this._timeoutMs = ms
    this._timeoutUnref = !!unref
    this._resetTimeout(true)
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true
    this._debug('destroy')
    this.emit('close')
    this.end()
  }

  end (...args) {
    this._debug('end')
    this._onUninterested()
    this._onChoke()
    super.end(...args)
  }

  /**
   * Use the specified protocol extension.
   * @param  {function} Extension
   */
  use (Extension) {
    const name = Extension.prototype.name
    if (!name) {
      throw new Error('Extension class requires a "name" property on the prototype')
    }
    this._debug('use extension.name=%s', name)

    const ext = this._nextExt
    const handler = new Extension(this)

    function noop () {}

    if (typeof handler.onHandshake !== 'function') {
      handler.onHandshake = noop
    }
    if (typeof handler.onExtendedHandshake !== 'function') {
      handler.onExtendedHandshake = noop
    }
    if (typeof handler.onMessage !== 'function') {
      handler.onMessage = noop
    }

    this.extendedMapping[ext] = name
    this._ext[name] = handler
    this[name] = handler

    this._nextExt += 1
  }

  //
  // OUTGOING MESSAGES
  //

  /**
   * Message "keep-alive": <len=0000>
   */
  keepAlive () {
    this._debug('keep-alive')
    this._push(MESSAGE_KEEP_ALIVE)
  }

  /**
   * Message: "handshake" <pstrlen><pstr><reserved><info_hash><peer_id>
   * @param  {Buffer|string} infoHash (as Buffer or *hex* string)
   * @param  {Buffer|string} peerId
   * @param  {Object} extensions
   */
  handshake (infoHash, peerId, extensions) {
    let infoHashBuffer
    let peerIdBuffer
    if (typeof infoHash === 'string') {
      infoHash = infoHash.toLowerCase()
      infoHashBuffer = Buffer.from(infoHash, 'hex')
    } else {
      infoHashBuffer = infoHash
      infoHash = infoHashBuffer.toString('hex')
    }
    if (typeof peerId === 'string') {
      peerIdBuffer = Buffer.from(peerId, 'hex')
    } else {
      peerIdBuffer = peerId
      peerId = peerIdBuffer.toString('hex')
    }

    if (infoHashBuffer.length !== 20 || peerIdBuffer.length !== 20) {
      throw new Error('infoHash and peerId MUST have length 20')
    }

    this._debug('handshake i=%s p=%s exts=%o', infoHash, peerId, extensions)

    const reserved = Buffer.from(MESSAGE_RESERVED)

    // enable extended message
    reserved[5] |= 0x10

    if (extensions && extensions.dht) reserved[7] |= 1

    this._push(Buffer.concat([MESSAGE_PROTOCOL, reserved, infoHashBuffer, peerIdBuffer]))
    this._handshakeSent = true

    if (this.peerExtensions.extended && !this._extendedHandshakeSent) {
      // Peer's handshake indicated support already
      // (incoming connection)
      this._sendExtendedHandshake()
    }
  }

  /* Peer supports BEP-0010, send extended handshake.
   *
   * This comes after the 'handshake' event to give the user a chance to populate
   * `this.extendedHandshake` and `this.extendedMapping` before the extended handshake
   * is sent to the remote peer.
   */
  _sendExtendedHandshake () {
    // Create extended message object from registered extensions
    const msg = Object.assign({}, this.extendedHandshake)
    msg.m = {}
    for (const ext in this.extendedMapping) {
      const name = this.extendedMapping[ext]
      msg.m[name] = Number(ext)
    }

    // Send extended handshake
    this.extended(0, bencode.encode(msg))
    this._extendedHandshakeSent = true
  }

  /**
   * Message "choke": <len=0001><id=0>
   */
  choke () {
    if (this.amChoking) return
    this.amChoking = true
    this._debug('choke')
    while (this.peerRequests.length) {
      this.peerRequests.pop()
    }
    this._push(MESSAGE_CHOKE)
  }

  /**
   * Message "unchoke": <len=0001><id=1>
   */
  unchoke () {
    if (!this.amChoking) return
    this.amChoking = false
    this._debug('unchoke')
    this._push(MESSAGE_UNCHOKE)
  }

  /**
   * Message "interested": <len=0001><id=2>
   */
  interested () {
    if (this.amInterested) return
    this.amInterested = true
    this._debug('interested')
    this._push(MESSAGE_INTERESTED)
  }

  /**
   * Message "uninterested": <len=0001><id=3>
   */
  uninterested () {
    if (!this.amInterested) return
    this.amInterested = false
    this._debug('uninterested')
    this._push(MESSAGE_UNINTERESTED)
  }

  /**
   * Message "have": <len=0005><id=4><piece index>
   * @param  {number} index
   */
  have (index) {
    this._debug('have %d', index)
    this._message(4, [index], null)
  }

  /**
   * Message "bitfield": <len=0001+X><id=5><bitfield>
   * @param  {BitField|Buffer} bitfield
   */
  bitfield (bitfield) {
    this._debug('bitfield')
    if (!Buffer.isBuffer(bitfield)) bitfield = bitfield.buffer
    this._message(5, [], bitfield)
  }

  /**
   * Message "request": <len=0013><id=6><index><begin><length>
   * @param  {number}   index
   * @param  {number}   offset
   * @param  {number}   length
   * @param  {function} cb
   */
  request (index, offset, length, cb) {
    if (!cb) cb = () => {}
    if (this._finished) return cb(new Error('wire is closed'))
    if (this.peerChoking) return cb(new Error('peer is choking'))

    this._debug('request index=%d offset=%d length=%d', index, offset, length)

    this.requests.push(new Request(index, offset, length, cb))
    if (!this._timeout) {
      this._resetTimeout(true)
    }
    this._message(6, [index, offset, length], null)
  }

  /**
   * Message "piece": <len=0009+X><id=7><index><begin><block>
   * @param  {number} index
   * @param  {number} offset
   * @param  {Buffer} buffer
   */
  piece (index, offset, buffer) {
    this._debug('piece index=%d offset=%d', index, offset)
    this.uploaded += buffer.length
    this.uploadSpeed(buffer.length)
    this.emit('upload', buffer.length)
    this._message(7, [index, offset], buffer)
  }

  /**
   * Message "cancel": <len=0013><id=8><index><begin><length>
   * @param  {number} index
   * @param  {number} offset
   * @param  {number} length
   */
  cancel (index, offset, length) {
    this._debug('cancel index=%d offset=%d length=%d', index, offset, length)
    this._callback(
      this._pull(this.requests, index, offset, length),
      new Error('request was cancelled'),
      null
    )
    this._message(8, [index, offset, length], null)
  }

  /**
   * Message: "port" <len=0003><id=9><listen-port>
   * @param {Number} port
   */
  port (port) {
    this._debug('port %d', port)
    const message = Buffer.from(MESSAGE_PORT)
    message.writeUInt16BE(port, 5)
    this._push(message)
  }

  /**
   * Message: "extended" <len=0005+X><id=20><ext-number><payload>
   * @param  {number|string} ext
   * @param  {Object} obj
   */
  extended (ext, obj) {
    this._debug('extended ext=%s', ext)
    if (typeof ext === 'string' && this.peerExtendedMapping[ext]) {
      ext = this.peerExtendedMapping[ext]
    }
    if (typeof ext === 'number') {
      const extId = Buffer.from([ext])
      const buf = Buffer.isBuffer(obj) ? obj : bencode.encode(obj)

      this._message(20, [], Buffer.concat([extId, buf]))
    } else {
      throw new Error(`Unrecognized extension: ${ext}`)
    }
  }

  /**
   * Duplex stream method. Called whenever the remote peer stream wants data. No-op
   * since we'll just push data whenever we get it.
   */
  _read () {}

  /**
   * Send a message to the remote peer.
   */
  _message (id, numbers, data) {
    const dataLength = data ? data.length : 0
    const buffer = Buffer.allocUnsafe(5 + (4 * numbers.length))

    buffer.writeUInt32BE(buffer.length + dataLength - 4, 0)
    buffer[4] = id
    for (let i = 0; i < numbers.length; i++) {
      buffer.writeUInt32BE(numbers[i], 5 + (4 * i))
    }

    this._push(buffer)
    if (data) this._push(data)
  }

  _push (data) {
    if (this._finished) return
    return this.push(data)
  }

  //
  // INCOMING MESSAGES
  //

  _onKeepAlive () {
    this._debug('got keep-alive')
    this.emit('keep-alive')
  }

  _onHandshake (infoHashBuffer, peerIdBuffer, extensions) {
    const infoHash = infoHashBuffer.toString('hex')
    const peerId = peerIdBuffer.toString('hex')

    this._debug('got handshake i=%s p=%s exts=%o', infoHash, peerId, extensions)

    this.peerId = peerId
    this.peerIdBuffer = peerIdBuffer
    this.peerExtensions = extensions

    this.emit('handshake', infoHash, peerId, extensions)

    let name
    for (name in this._ext) {
      this._ext[name].onHandshake(infoHash, peerId, extensions)
    }

    if (extensions.extended && this._handshakeSent &&
        !this._extendedHandshakeSent) {
      // outgoing connection
      this._sendExtendedHandshake()
    }
  }

  _onChoke () {
    this.peerChoking = true
    this._debug('got choke')
    this.emit('choke')
    while (this.requests.length) {
      this._callback(this.requests.pop(), new Error('peer is choking'), null)
    }
  }

  _onUnchoke () {
    this.peerChoking = false
    this._debug('got unchoke')
    this.emit('unchoke')
  }

  _onInterested () {
    this.peerInterested = true
    this._debug('got interested')
    this.emit('interested')
  }

  _onUninterested () {
    this.peerInterested = false
    this._debug('got uninterested')
    this.emit('uninterested')
  }

  _onHave (index) {
    if (this.peerPieces.get(index)) return
    this._debug('got have %d', index)

    this.peerPieces.set(index, true)
    this.emit('have', index)
  }

  _onBitField (buffer) {
    this.peerPieces = new BitField(buffer)
    this._debug('got bitfield')
    this.emit('bitfield', this.peerPieces)
  }

  _onRequest (index, offset, length) {
    if (this.amChoking) return
    this._debug('got request index=%d offset=%d length=%d', index, offset, length)

    const respond = (err, buffer) => {
      if (request !== this._pull(this.peerRequests, index, offset, length)) return
      if (err) return this._debug('error satisfying request index=%d offset=%d length=%d (%s)', index, offset, length, err.message)
      this.piece(index, offset, buffer)
    }

    const request = new Request(index, offset, length, respond)
    this.peerRequests.push(request)
    this.emit('request', index, offset, length, respond)
  }

  _onPiece (index, offset, buffer) {
    this._debug('got piece index=%d offset=%d', index, offset)
    this._callback(this._pull(this.requests, index, offset, buffer.length), null, buffer)
    this.downloaded += buffer.length
    this.downloadSpeed(buffer.length)
    this.emit('download', buffer.length)
    this.emit('piece', index, offset, buffer)
  }

  _onCancel (index, offset, length) {
    this._debug('got cancel index=%d offset=%d length=%d', index, offset, length)
    this._pull(this.peerRequests, index, offset, length)
    this.emit('cancel', index, offset, length)
  }

  _onPort (port) {
    this._debug('got port %d', port)
    this.emit('port', port)
  }

  _onExtended (ext, buf) {
    if (ext === 0) {
      let info
      try {
        info = bencode.decode(buf)
      } catch (err) {
        this._debug('ignoring invalid extended handshake: %s', err.message || err)
      }

      if (!info) return
      this.peerExtendedHandshake = info

      let name
      if (typeof info.m === 'object') {
        for (name in info.m) {
          this.peerExtendedMapping[name] = Number(info.m[name].toString())
        }
      }
      for (name in this._ext) {
        if (this.peerExtendedMapping[name]) {
          this._ext[name].onExtendedHandshake(this.peerExtendedHandshake)
        }
      }
      this._debug('got extended handshake')
      this.emit('extended', 'handshake', this.peerExtendedHandshake)
    } else {
      if (this.extendedMapping[ext]) {
        ext = this.extendedMapping[ext] // friendly name for extension
        if (this._ext[ext]) {
          // there is an registered extension handler, so call it
          this._ext[ext].onMessage(buf)
        }
      }
      this._debug('got extended message ext=%s', ext)
      this.emit('extended', ext, buf)
    }
  }

  _onTimeout () {
    this._debug('request timed out')
    this._callback(this.requests.shift(), new Error('request has timed out'), null)
    this.emit('timeout')
  }

  /**
   * Duplex stream method. Called whenever the remote peer has data for us. Data that the
   * remote peer sends gets buffered (i.e. not actually processed) until the right number
   * of bytes have arrived, determined by the last call to `this._parse(number, callback)`.
   * Once enough bytes have arrived to process the message, the callback function
   * (i.e. `this._parser`) gets called with the full buffer of data.
   * @param  {Buffer} data
   * @param  {string} encoding
   * @param  {function} cb
   */
  _write (data, encoding, cb) {
    this._bufferSize += data.length
    this._buffer.push(data)

    while (this._bufferSize >= this._parserSize) {
      const buffer = (this._buffer.length === 1)
        ? this._buffer[0]
        : Buffer.concat(this._buffer, this._bufferSize)
      this._bufferSize -= this._parserSize
      this._buffer = this._bufferSize
        ? [buffer.slice(this._parserSize)]
        : []
      this._parser(buffer.slice(0, this._parserSize))
    }

    cb(null) // Signal that we're ready for more data
  }

  _callback (request, err, buffer) {
    if (!request) return

    this._resetTimeout(!this.peerChoking && !this._finished)

    request.callback(err, buffer)
  }

  _resetTimeout (setAgain) {
    if (!setAgain || !this._timeoutMs || !this.requests.length) {
      clearTimeout(this._timeout)
      this._timeout = null
      this._timeoutExpiresAt = null
      return
    }

    const timeoutExpiresAt = Date.now() + this._timeoutMs

    if (this._timeout) {
      // If existing expiration is already within 5% of correct, it's close enough
      if (timeoutExpiresAt - this._timeoutExpiresAt < this._timeoutMs * 0.05) {
        return
      }
      clearTimeout(this._timeout)
    }

    this._timeoutExpiresAt = timeoutExpiresAt
    this._timeout = setTimeout(() => this._onTimeout(), this._timeoutMs)
    if (this._timeoutUnref && this._timeout.unref) this._timeout.unref()
  }

  /**
   * Takes a number of bytes that the local peer is waiting to receive from the remote peer
   * in order to parse a complete message, and a callback function to be called once enough
   * bytes have arrived.
   * @param  {number} size
   * @param  {function} parser
   */
  _parse (size, parser) {
    this._parserSize = size
    this._parser = parser
  }

  /**
   * Handle the first 4 bytes of a message, to determine the length of bytes that must be
   * waited for in order to have the whole message.
   * @param  {Buffer} buffer
   */
  _onMessageLength (buffer) {
    const length = buffer.readUInt32BE(0)
    if (length > 0) {
      this._parse(length, this._onMessage)
    } else {
      this._onKeepAlive()
      this._parse(4, this._onMessageLength)
    }
  }

  /**
   * Handle a message from the remote peer.
   * @param  {Buffer} buffer
   */
  _onMessage (buffer) {
    this._parse(4, this._onMessageLength)
    switch (buffer[0]) {
      case 0:
        return this._onChoke()
      case 1:
        return this._onUnchoke()
      case 2:
        return this._onInterested()
      case 3:
        return this._onUninterested()
      case 4:
        return this._onHave(buffer.readUInt32BE(1))
      case 5:
        return this._onBitField(buffer.slice(1))
      case 6:
        return this._onRequest(
          buffer.readUInt32BE(1),
          buffer.readUInt32BE(5),
          buffer.readUInt32BE(9)
        )
      case 7:
        return this._onPiece(
          buffer.readUInt32BE(1),
          buffer.readUInt32BE(5),
          buffer.slice(9)
        )
      case 8:
        return this._onCancel(
          buffer.readUInt32BE(1),
          buffer.readUInt32BE(5),
          buffer.readUInt32BE(9)
        )
      case 9:
        return this._onPort(buffer.readUInt16BE(1))
      case 20:
        return this._onExtended(buffer.readUInt8(1), buffer.slice(2))
      default:
        this._debug('got unknown message')
        return this.emit('unknownmessage', buffer)
    }
  }

  _parseHandshake () {
    this._parse(1, buffer => {
      const pstrlen = buffer.readUInt8(0)
      this._parse(pstrlen + 48, handshake => {
        const protocol = handshake.slice(0, pstrlen)
        if (protocol.toString() !== 'BitTorrent protocol') {
          this._debug('Error: wire not speaking BitTorrent protocol (%s)', protocol.toString())
          this.end()
          return
        }
        handshake = handshake.slice(pstrlen)
        this._onHandshake(handshake.slice(8, 28), handshake.slice(28, 48), {
          dht: !!(handshake[7] & 0x01), // see bep_0005
          extended: !!(handshake[5] & 0x10) // see bep_0010
        })
        this._parse(4, this._onMessageLength)
      })
    })
  }

  _onFinish () {
    this._finished = true

    this.push(null) // stream cannot be half open, so signal the end of it
    while (this.read()) {
      // body intentionally empty
      // consume and discard the rest of the stream data
    }

    clearInterval(this._keepAliveInterval)
    this._parse(Number.MAX_VALUE, () => {})
    while (this.peerRequests.length) {
      this.peerRequests.pop()
    }
    while (this.requests.length) {
      this._callback(this.requests.pop(), new Error('wire was closed'), null)
    }
  }

  _debug (...args) {
    args[0] = `[${this._debugId}] ${args[0]}`
    debug(...args)
  }

  _pull (requests, piece, offset, length) {
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i]
      if (req.piece === piece && req.offset === offset && req.length === length) {
        arrayRemove(requests, i)
        return req
      }
    }
    return null
  }
}

module.exports = Wire

}).call(this)}).call(this,require("buffer").Buffer)
},{"bencode":7,"bitfield":10,"buffer":52,"debug":111,"randombytes":214,"readable-stream":26,"speedometer":273,"unordered-array-remove":307}],12:[function(require,module,exports){
'use strict';

function _inheritsLoose(subClass, superClass) { subClass.prototype = Object.create(superClass.prototype); subClass.prototype.constructor = subClass; subClass.__proto__ = superClass; }

var codes = {};

function createErrorType(code, message, Base) {
  if (!Base) {
    Base = Error;
  }

  function getMessage(arg1, arg2, arg3) {
    if (typeof message === 'string') {
      return message;
    } else {
      return message(arg1, arg2, arg3);
    }
  }

  var NodeError =
  /*#__PURE__*/
  function (_Base) {
    _inheritsLoose(NodeError, _Base);

    function NodeError(arg1, arg2, arg3) {
      return _Base.call(this, getMessage(arg1, arg2, arg3)) || this;
    }

    return NodeError;
  }(Base);

  NodeError.prototype.name = Base.name;
  NodeError.prototype.code = code;
  codes[code] = NodeError;
} // https://github.com/nodejs/node/blob/v10.8.0/lib/internal/errors.js


function oneOf(expected, thing) {
  if (Array.isArray(expected)) {
    var len = expected.length;
    expected = expected.map(function (i) {
      return String(i);
    });

    if (len > 2) {
      return "one of ".concat(thing, " ").concat(expected.slice(0, len - 1).join(', '), ", or ") + expected[len - 1];
    } else if (len === 2) {
      return "one of ".concat(thing, " ").concat(expected[0], " or ").concat(expected[1]);
    } else {
      return "of ".concat(thing, " ").concat(expected[0]);
    }
  } else {
    return "of ".concat(thing, " ").concat(String(expected));
  }
} // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith


function startsWith(str, search, pos) {
  return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
} // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith


function endsWith(str, search, this_len) {
  if (this_len === undefined || this_len > str.length) {
    this_len = str.length;
  }

  return str.substring(this_len - search.length, this_len) === search;
} // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/includes


function includes(str, search, start) {
  if (typeof start !== 'number') {
    start = 0;
  }

  if (start + search.length > str.length) {
    return false;
  } else {
    return str.indexOf(search, start) !== -1;
  }
}

createErrorType('ERR_INVALID_OPT_VALUE', function (name, value) {
  return 'The value "' + value + '" is invalid for option "' + name + '"';
}, TypeError);
createErrorType('ERR_INVALID_ARG_TYPE', function (name, expected, actual) {
  // determiner: 'must be' or 'must not be'
  var determiner;

  if (typeof expected === 'string' && startsWith(expected, 'not ')) {
    determiner = 'must not be';
    expected = expected.replace(/^not /, '');
  } else {
    determiner = 'must be';
  }

  var msg;

  if (endsWith(name, ' argument')) {
    // For cases like 'first argument'
    msg = "The ".concat(name, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
  } else {
    var type = includes(name, '.') ? 'property' : 'argument';
    msg = "The \"".concat(name, "\" ").concat(type, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
  }

  msg += ". Received type ".concat(typeof actual);
  return msg;
}, TypeError);
createErrorType('ERR_STREAM_PUSH_AFTER_EOF', 'stream.push() after EOF');
createErrorType('ERR_METHOD_NOT_IMPLEMENTED', function (name) {
  return 'The ' + name + ' method is not implemented';
});
createErrorType('ERR_STREAM_PREMATURE_CLOSE', 'Premature close');
createErrorType('ERR_STREAM_DESTROYED', function (name) {
  return 'Cannot call ' + name + ' after a stream was destroyed';
});
createErrorType('ERR_MULTIPLE_CALLBACK', 'Callback called multiple times');
createErrorType('ERR_STREAM_CANNOT_PIPE', 'Cannot pipe, not readable');
createErrorType('ERR_STREAM_WRITE_AFTER_END', 'write after end');
createErrorType('ERR_STREAM_NULL_VALUES', 'May not write null values to stream', TypeError);
createErrorType('ERR_UNKNOWN_ENCODING', function (arg) {
  return 'Unknown encoding: ' + arg;
}, TypeError);
createErrorType('ERR_STREAM_UNSHIFT_AFTER_END_EVENT', 'stream.unshift() after end event');
module.exports.codes = codes;

},{}],13:[function(require,module,exports){
(function (process){(function (){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.
'use strict';
/*<replacement>*/

var objectKeys = Object.keys || function (obj) {
  var keys = [];

  for (var key in obj) {
    keys.push(key);
  }

  return keys;
};
/*</replacement>*/


module.exports = Duplex;

var Readable = require('./_stream_readable');

var Writable = require('./_stream_writable');

require('inherits')(Duplex, Readable);

{
  // Allow the keys array to be GC'ed.
  var keys = objectKeys(Writable.prototype);

  for (var v = 0; v < keys.length; v++) {
    var method = keys[v];
    if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
  }
}

function Duplex(options) {
  if (!(this instanceof Duplex)) return new Duplex(options);
  Readable.call(this, options);
  Writable.call(this, options);
  this.allowHalfOpen = true;

  if (options) {
    if (options.readable === false) this.readable = false;
    if (options.writable === false) this.writable = false;

    if (options.allowHalfOpen === false) {
      this.allowHalfOpen = false;
      this.once('end', onend);
    }
  }
}

Object.defineProperty(Duplex.prototype, 'writableHighWaterMark', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._writableState.highWaterMark;
  }
});
Object.defineProperty(Duplex.prototype, 'writableBuffer', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._writableState && this._writableState.getBuffer();
  }
});
Object.defineProperty(Duplex.prototype, 'writableLength', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._writableState.length;
  }
}); // the no-half-open enforcer

function onend() {
  // If the writable side ended, then we're ok.
  if (this._writableState.ended) return; // no more data can be written.
  // But allow more writes to happen in this tick.

  process.nextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

Object.defineProperty(Duplex.prototype, 'destroyed', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    if (this._readableState === undefined || this._writableState === undefined) {
      return false;
    }

    return this._readableState.destroyed && this._writableState.destroyed;
  },
  set: function set(value) {
    // we ignore the value if the stream
    // has not been initialized yet
    if (this._readableState === undefined || this._writableState === undefined) {
      return;
    } // backward compatibility, the user is explicitly
    // managing destroyed


    this._readableState.destroyed = value;
    this._writableState.destroyed = value;
  }
});
}).call(this)}).call(this,require('_process'))
},{"./_stream_readable":15,"./_stream_writable":17,"_process":206,"inherits":138}],14:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.
'use strict';

module.exports = PassThrough;

var Transform = require('./_stream_transform');

require('inherits')(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough)) return new PassThrough(options);
  Transform.call(this, options);
}

PassThrough.prototype._transform = function (chunk, encoding, cb) {
  cb(null, chunk);
};
},{"./_stream_transform":16,"inherits":138}],15:[function(require,module,exports){
(function (process,global){(function (){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
'use strict';

module.exports = Readable;
/*<replacement>*/

var Duplex;
/*</replacement>*/

Readable.ReadableState = ReadableState;
/*<replacement>*/

var EE = require('events').EventEmitter;

var EElistenerCount = function EElistenerCount(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

/*<replacement>*/


var Stream = require('./internal/streams/stream');
/*</replacement>*/


var Buffer = require('buffer').Buffer;

var OurUint8Array = global.Uint8Array || function () {};

function _uint8ArrayToBuffer(chunk) {
  return Buffer.from(chunk);
}

function _isUint8Array(obj) {
  return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
}
/*<replacement>*/


var debugUtil = require('util');

var debug;

if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog('stream');
} else {
  debug = function debug() {};
}
/*</replacement>*/


var BufferList = require('./internal/streams/buffer_list');

var destroyImpl = require('./internal/streams/destroy');

var _require = require('./internal/streams/state'),
    getHighWaterMark = _require.getHighWaterMark;

var _require$codes = require('../errors').codes,
    ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
    ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF,
    ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
    ERR_STREAM_UNSHIFT_AFTER_END_EVENT = _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT; // Lazy loaded to improve the startup performance.


var StringDecoder;
var createReadableStreamAsyncIterator;
var from;

require('inherits')(Readable, Stream);

var errorOrDestroy = destroyImpl.errorOrDestroy;
var kProxyEvents = ['error', 'close', 'destroy', 'pause', 'resume'];

function prependListener(emitter, event, fn) {
  // Sadly this is not cacheable as some libraries bundle their own
  // event emitter implementation with them.
  if (typeof emitter.prependListener === 'function') return emitter.prependListener(event, fn); // This is a hack to make sure that our error handler is attached before any
  // userland ones.  NEVER DO THIS. This is here only because this code needs
  // to continue to work with older versions of Node.js that do not include
  // the prependListener() method. The goal is to eventually remove this hack.

  if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);else if (Array.isArray(emitter._events[event])) emitter._events[event].unshift(fn);else emitter._events[event] = [fn, emitter._events[event]];
}

function ReadableState(options, stream, isDuplex) {
  Duplex = Duplex || require('./_stream_duplex');
  options = options || {}; // Duplex streams are both readable and writable, but share
  // the same options object.
  // However, some cases require setting options to different
  // values for the readable and the writable sides of the duplex stream.
  // These options can be provided separately as readableXXX and writableXXX.

  if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away

  this.objectMode = !!options.objectMode;
  if (isDuplex) this.objectMode = this.objectMode || !!options.readableObjectMode; // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"

  this.highWaterMark = getHighWaterMark(this, options, 'readableHighWaterMark', isDuplex); // A linked list is used to store data chunks instead of an array because the
  // linked list can remove elements from the beginning faster than
  // array.shift()

  this.buffer = new BufferList();
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false; // a flag to be able to tell if the event 'readable'/'data' is emitted
  // immediately, or on a later tick.  We set this to true at first, because
  // any actions that shouldn't happen until "later" should generally also
  // not happen before the first read call.

  this.sync = true; // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.

  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;
  this.paused = true; // Should close be emitted on destroy. Defaults to true.

  this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'end' (and potentially 'finish')

  this.autoDestroy = !!options.autoDestroy; // has it been destroyed

  this.destroyed = false; // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.

  this.defaultEncoding = options.defaultEncoding || 'utf8'; // the number of writers that are awaiting a drain event in .pipe()s

  this.awaitDrain = 0; // if true, a maybeReadMore has been scheduled

  this.readingMore = false;
  this.decoder = null;
  this.encoding = null;

  if (options.encoding) {
    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  Duplex = Duplex || require('./_stream_duplex');
  if (!(this instanceof Readable)) return new Readable(options); // Checking for a Stream.Duplex instance is faster here instead of inside
  // the ReadableState constructor, at least with V8 6.5

  var isDuplex = this instanceof Duplex;
  this._readableState = new ReadableState(options, this, isDuplex); // legacy

  this.readable = true;

  if (options) {
    if (typeof options.read === 'function') this._read = options.read;
    if (typeof options.destroy === 'function') this._destroy = options.destroy;
  }

  Stream.call(this);
}

Object.defineProperty(Readable.prototype, 'destroyed', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    if (this._readableState === undefined) {
      return false;
    }

    return this._readableState.destroyed;
  },
  set: function set(value) {
    // we ignore the value if the stream
    // has not been initialized yet
    if (!this._readableState) {
      return;
    } // backward compatibility, the user is explicitly
    // managing destroyed


    this._readableState.destroyed = value;
  }
});
Readable.prototype.destroy = destroyImpl.destroy;
Readable.prototype._undestroy = destroyImpl.undestroy;

Readable.prototype._destroy = function (err, cb) {
  cb(err);
}; // Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.


Readable.prototype.push = function (chunk, encoding) {
  var state = this._readableState;
  var skipChunkCheck;

  if (!state.objectMode) {
    if (typeof chunk === 'string') {
      encoding = encoding || state.defaultEncoding;

      if (encoding !== state.encoding) {
        chunk = Buffer.from(chunk, encoding);
        encoding = '';
      }

      skipChunkCheck = true;
    }
  } else {
    skipChunkCheck = true;
  }

  return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
}; // Unshift should *always* be something directly out of read()


Readable.prototype.unshift = function (chunk) {
  return readableAddChunk(this, chunk, null, true, false);
};

function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
  debug('readableAddChunk', chunk);
  var state = stream._readableState;

  if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else {
    var er;
    if (!skipChunkCheck) er = chunkInvalid(state, chunk);

    if (er) {
      errorOrDestroy(stream, er);
    } else if (state.objectMode || chunk && chunk.length > 0) {
      if (typeof chunk !== 'string' && !state.objectMode && Object.getPrototypeOf(chunk) !== Buffer.prototype) {
        chunk = _uint8ArrayToBuffer(chunk);
      }

      if (addToFront) {
        if (state.endEmitted) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());else addChunk(stream, state, chunk, true);
      } else if (state.ended) {
        errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
      } else if (state.destroyed) {
        return false;
      } else {
        state.reading = false;

        if (state.decoder && !encoding) {
          chunk = state.decoder.write(chunk);
          if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);else maybeReadMore(stream, state);
        } else {
          addChunk(stream, state, chunk, false);
        }
      }
    } else if (!addToFront) {
      state.reading = false;
      maybeReadMore(stream, state);
    }
  } // We can push more data if we are below the highWaterMark.
  // Also, if we have no data yet, we can stand some more bytes.
  // This is to work around cases where hwm=0, such as the repl.


  return !state.ended && (state.length < state.highWaterMark || state.length === 0);
}

function addChunk(stream, state, chunk, addToFront) {
  if (state.flowing && state.length === 0 && !state.sync) {
    state.awaitDrain = 0;
    stream.emit('data', chunk);
  } else {
    // update the buffer info.
    state.length += state.objectMode ? 1 : chunk.length;
    if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);
    if (state.needReadable) emitReadable(stream);
  }

  maybeReadMore(stream, state);
}

function chunkInvalid(state, chunk) {
  var er;

  if (!_isUint8Array(chunk) && typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
    er = new ERR_INVALID_ARG_TYPE('chunk', ['string', 'Buffer', 'Uint8Array'], chunk);
  }

  return er;
}

Readable.prototype.isPaused = function () {
  return this._readableState.flowing === false;
}; // backwards compatibility.


Readable.prototype.setEncoding = function (enc) {
  if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
  var decoder = new StringDecoder(enc);
  this._readableState.decoder = decoder; // If setEncoding(null), decoder.encoding equals utf8

  this._readableState.encoding = this._readableState.decoder.encoding; // Iterate over current buffer to convert already stored Buffers:

  var p = this._readableState.buffer.head;
  var content = '';

  while (p !== null) {
    content += decoder.write(p.data);
    p = p.next;
  }

  this._readableState.buffer.clear();

  if (content !== '') this._readableState.buffer.push(content);
  this._readableState.length = content.length;
  return this;
}; // Don't raise the hwm > 1GB


var MAX_HWM = 0x40000000;

function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    // TODO(ronag): Throw ERR_VALUE_OUT_OF_RANGE.
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2 to prevent increasing hwm excessively in
    // tiny amounts
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }

  return n;
} // This function is designed to be inlinable, so please take care when making
// changes to the function body.


function howMuchToRead(n, state) {
  if (n <= 0 || state.length === 0 && state.ended) return 0;
  if (state.objectMode) return 1;

  if (n !== n) {
    // Only flow one buffer at a time
    if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
  } // If we're asking for more than the current hwm, then raise the hwm.


  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
  if (n <= state.length) return n; // Don't have enough

  if (!state.ended) {
    state.needReadable = true;
    return 0;
  }

  return state.length;
} // you can override either this method, or the async _read(n) below.


Readable.prototype.read = function (n) {
  debug('read', n);
  n = parseInt(n, 10);
  var state = this._readableState;
  var nOrig = n;
  if (n !== 0) state.emittedReadable = false; // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.

  if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state); // if we've ended, and we're now clear, then finish it up.

  if (n === 0 && state.ended) {
    if (state.length === 0) endReadable(this);
    return null;
  } // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.
  // if we need a readable event, then we need to do some reading.


  var doRead = state.needReadable;
  debug('need readable', doRead); // if we currently have less than the highWaterMark, then also read some

  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  } // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.


  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  } else if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true; // if the length is currently zero, then we *need* a readable event.

    if (state.length === 0) state.needReadable = true; // call internal read method

    this._read(state.highWaterMark);

    state.sync = false; // If _read pushed data synchronously, then `reading` will be false,
    // and we need to re-evaluate how much data we can return to the user.

    if (!state.reading) n = howMuchToRead(nOrig, state);
  }

  var ret;
  if (n > 0) ret = fromList(n, state);else ret = null;

  if (ret === null) {
    state.needReadable = state.length <= state.highWaterMark;
    n = 0;
  } else {
    state.length -= n;
    state.awaitDrain = 0;
  }

  if (state.length === 0) {
    // If we have nothing in the buffer, then we want to know
    // as soon as we *do* get something into the buffer.
    if (!state.ended) state.needReadable = true; // If we tried to read() past the EOF, then emit end on the next tick.

    if (nOrig !== n && state.ended) endReadable(this);
  }

  if (ret !== null) this.emit('data', ret);
  return ret;
};

function onEofChunk(stream, state) {
  debug('onEofChunk');
  if (state.ended) return;

  if (state.decoder) {
    var chunk = state.decoder.end();

    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }

  state.ended = true;

  if (state.sync) {
    // if we are sync, wait until next tick to emit the data.
    // Otherwise we risk emitting data in the flow()
    // the readable code triggers during a read() call
    emitReadable(stream);
  } else {
    // emit 'readable' now to make sure it gets picked up.
    state.needReadable = false;

    if (!state.emittedReadable) {
      state.emittedReadable = true;
      emitReadable_(stream);
    }
  }
} // Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.


function emitReadable(stream) {
  var state = stream._readableState;
  debug('emitReadable', state.needReadable, state.emittedReadable);
  state.needReadable = false;

  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    process.nextTick(emitReadable_, stream);
  }
}

function emitReadable_(stream) {
  var state = stream._readableState;
  debug('emitReadable_', state.destroyed, state.length, state.ended);

  if (!state.destroyed && (state.length || state.ended)) {
    stream.emit('readable');
    state.emittedReadable = false;
  } // The stream needs another readable event if
  // 1. It is not flowing, as the flow mechanism will take
  //    care of it.
  // 2. It is not ended.
  // 3. It is below the highWaterMark, so we can schedule
  //    another readable later.


  state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
  flow(stream);
} // at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.


function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    process.nextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  // Attempt to read more data if we should.
  //
  // The conditions for reading more data are (one of):
  // - Not enough data buffered (state.length < state.highWaterMark). The loop
  //   is responsible for filling the buffer with enough data if such data
  //   is available. If highWaterMark is 0 and we are not in the flowing mode
  //   we should _not_ attempt to buffer any extra data. We'll get more data
  //   when the stream consumer calls read() instead.
  // - No data in the buffer, and the stream is in flowing mode. In this mode
  //   the loop below is responsible for ensuring read() is called. Failing to
  //   call read here would abort the flow and there's no other mechanism for
  //   continuing the flow if the stream consumer has just subscribed to the
  //   'data' event.
  //
  // In addition to the above conditions to keep reading data, the following
  // conditions prevent the data from being read:
  // - The stream has ended (state.ended).
  // - There is already a pending 'read' operation (state.reading). This is a
  //   case where the the stream has called the implementation defined _read()
  //   method, but they are processing the call asynchronously and have _not_
  //   called push() with new data. In this case we skip performing more
  //   read()s. The execution ends in this method again after the _read() ends
  //   up calling push() with more data.
  while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
    var len = state.length;
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length) // didn't get any data, stop spinning.
      break;
  }

  state.readingMore = false;
} // abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.


Readable.prototype._read = function (n) {
  errorOrDestroy(this, new ERR_METHOD_NOT_IMPLEMENTED('_read()'));
};

Readable.prototype.pipe = function (dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;

    case 1:
      state.pipes = [state.pipes, dest];
      break;

    default:
      state.pipes.push(dest);
      break;
  }

  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);
  var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
  var endFn = doEnd ? onend : unpipe;
  if (state.endEmitted) process.nextTick(endFn);else src.once('end', endFn);
  dest.on('unpipe', onunpipe);

  function onunpipe(readable, unpipeInfo) {
    debug('onunpipe');

    if (readable === src) {
      if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
        unpipeInfo.hasUnpiped = true;
        cleanup();
      }
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  } // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.


  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);
  var cleanedUp = false;

  function cleanup() {
    debug('cleanup'); // cleanup event handlers once the pipe is broken

    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', unpipe);
    src.removeListener('data', ondata);
    cleanedUp = true; // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.

    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  src.on('data', ondata);

  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    debug('dest.write', ret);

    if (ret === false) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      // => Check whether `dest` is still a piping destination.
      if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
        debug('false write response, pause', state.awaitDrain);
        state.awaitDrain++;
      }

      src.pause();
    }
  } // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.


  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EElistenerCount(dest, 'error') === 0) errorOrDestroy(dest, er);
  } // Make sure our error handler is attached before userland ones.


  prependListener(dest, 'error', onerror); // Both close and finish should trigger unpipe, but only once.

  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }

  dest.once('close', onclose);

  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }

  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  } // tell the dest that it's being piped to


  dest.emit('pipe', src); // start the flow if it hasn't been started already.

  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function pipeOnDrainFunctionResult() {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain) state.awaitDrain--;

    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}

Readable.prototype.unpipe = function (dest) {
  var state = this._readableState;
  var unpipeInfo = {
    hasUnpiped: false
  }; // if we're not piping anywhere, then do nothing.

  if (state.pipesCount === 0) return this; // just one destination.  most common case.

  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes) return this;
    if (!dest) dest = state.pipes; // got a match.

    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest) dest.emit('unpipe', this, unpipeInfo);
    return this;
  } // slow case. multiple pipe destinations.


  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++) {
      dests[i].emit('unpipe', this, {
        hasUnpiped: false
      });
    }

    return this;
  } // try to find the right one.


  var index = indexOf(state.pipes, dest);
  if (index === -1) return this;
  state.pipes.splice(index, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1) state.pipes = state.pipes[0];
  dest.emit('unpipe', this, unpipeInfo);
  return this;
}; // set up data events if they are asked for
// Ensure readable listeners eventually get something


Readable.prototype.on = function (ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);
  var state = this._readableState;

  if (ev === 'data') {
    // update readableListening so that resume() may be a no-op
    // a few lines down. This is needed to support once('readable').
    state.readableListening = this.listenerCount('readable') > 0; // Try start flowing on next tick if stream isn't explicitly paused

    if (state.flowing !== false) this.resume();
  } else if (ev === 'readable') {
    if (!state.endEmitted && !state.readableListening) {
      state.readableListening = state.needReadable = true;
      state.flowing = false;
      state.emittedReadable = false;
      debug('on readable', state.length, state.reading);

      if (state.length) {
        emitReadable(this);
      } else if (!state.reading) {
        process.nextTick(nReadingNextTick, this);
      }
    }
  }

  return res;
};

Readable.prototype.addListener = Readable.prototype.on;

Readable.prototype.removeListener = function (ev, fn) {
  var res = Stream.prototype.removeListener.call(this, ev, fn);

  if (ev === 'readable') {
    // We need to check if there is someone still listening to
    // readable and reset the state. However this needs to happen
    // after readable has been emitted but before I/O (nextTick) to
    // support once('readable', fn) cycles. This means that calling
    // resume within the same tick will have no
    // effect.
    process.nextTick(updateReadableListening, this);
  }

  return res;
};

Readable.prototype.removeAllListeners = function (ev) {
  var res = Stream.prototype.removeAllListeners.apply(this, arguments);

  if (ev === 'readable' || ev === undefined) {
    // We need to check if there is someone still listening to
    // readable and reset the state. However this needs to happen
    // after readable has been emitted but before I/O (nextTick) to
    // support once('readable', fn) cycles. This means that calling
    // resume within the same tick will have no
    // effect.
    process.nextTick(updateReadableListening, this);
  }

  return res;
};

function updateReadableListening(self) {
  var state = self._readableState;
  state.readableListening = self.listenerCount('readable') > 0;

  if (state.resumeScheduled && !state.paused) {
    // flowing needs to be set to true now, otherwise
    // the upcoming resume will not flow.
    state.flowing = true; // crude way to check if we should resume
  } else if (self.listenerCount('data') > 0) {
    self.resume();
  }
}

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
} // pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.


Readable.prototype.resume = function () {
  var state = this._readableState;

  if (!state.flowing) {
    debug('resume'); // we flow only if there is no one listening
    // for readable, but we still have to call
    // resume()

    state.flowing = !state.readableListening;
    resume(this, state);
  }

  state.paused = false;
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    process.nextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  debug('resume', state.reading);

  if (!state.reading) {
    stream.read(0);
  }

  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

Readable.prototype.pause = function () {
  debug('call pause flowing=%j', this._readableState.flowing);

  if (this._readableState.flowing !== false) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }

  this._readableState.paused = true;
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);

  while (state.flowing && stream.read() !== null) {
    ;
  }
} // wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.


Readable.prototype.wrap = function (stream) {
  var _this = this;

  var state = this._readableState;
  var paused = false;
  stream.on('end', function () {
    debug('wrapped end');

    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) _this.push(chunk);
    }

    _this.push(null);
  });
  stream.on('data', function (chunk) {
    debug('wrapped data');
    if (state.decoder) chunk = state.decoder.write(chunk); // don't skip over falsy values in objectMode

    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

    var ret = _this.push(chunk);

    if (!ret) {
      paused = true;
      stream.pause();
    }
  }); // proxy all the other methods.
  // important when wrapping filters and duplexes.

  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function methodWrap(method) {
        return function methodWrapReturnFunction() {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  } // proxy certain important events.


  for (var n = 0; n < kProxyEvents.length; n++) {
    stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
  } // when we try to consume some more bytes, simply unpause the
  // underlying stream.


  this._read = function (n) {
    debug('wrapped _read', n);

    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return this;
};

if (typeof Symbol === 'function') {
  Readable.prototype[Symbol.asyncIterator] = function () {
    if (createReadableStreamAsyncIterator === undefined) {
      createReadableStreamAsyncIterator = require('./internal/streams/async_iterator');
    }

    return createReadableStreamAsyncIterator(this);
  };
}

Object.defineProperty(Readable.prototype, 'readableHighWaterMark', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._readableState.highWaterMark;
  }
});
Object.defineProperty(Readable.prototype, 'readableBuffer', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._readableState && this._readableState.buffer;
  }
});
Object.defineProperty(Readable.prototype, 'readableFlowing', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._readableState.flowing;
  },
  set: function set(state) {
    if (this._readableState) {
      this._readableState.flowing = state;
    }
  }
}); // exposed for testing purposes only.

Readable._fromList = fromList;
Object.defineProperty(Readable.prototype, 'readableLength', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._readableState.length;
  }
}); // Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.

function fromList(n, state) {
  // nothing buffered
  if (state.length === 0) return null;
  var ret;
  if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
    // read it all, truncate the list
    if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.first();else ret = state.buffer.concat(state.length);
    state.buffer.clear();
  } else {
    // read part of list
    ret = state.buffer.consume(n, state.decoder);
  }
  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;
  debug('endReadable', state.endEmitted);

  if (!state.endEmitted) {
    state.ended = true;
    process.nextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  debug('endReadableNT', state.endEmitted, state.length); // Check that we didn't get one last unshift.

  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');

    if (state.autoDestroy) {
      // In case of duplex streams we need a way to detect
      // if the writable side is ready for autoDestroy as well
      var wState = stream._writableState;

      if (!wState || wState.autoDestroy && wState.finished) {
        stream.destroy();
      }
    }
  }
}

if (typeof Symbol === 'function') {
  Readable.from = function (iterable, opts) {
    if (from === undefined) {
      from = require('./internal/streams/from');
    }

    return from(Readable, iterable, opts);
  };
}

function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }

  return -1;
}
}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../errors":12,"./_stream_duplex":13,"./internal/streams/async_iterator":18,"./internal/streams/buffer_list":19,"./internal/streams/destroy":20,"./internal/streams/from":22,"./internal/streams/state":24,"./internal/streams/stream":25,"_process":206,"buffer":52,"events":117,"inherits":138,"string_decoder/":296,"util":48}],16:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.
'use strict';

module.exports = Transform;

var _require$codes = require('../errors').codes,
    ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
    ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
    ERR_TRANSFORM_ALREADY_TRANSFORMING = _require$codes.ERR_TRANSFORM_ALREADY_TRANSFORMING,
    ERR_TRANSFORM_WITH_LENGTH_0 = _require$codes.ERR_TRANSFORM_WITH_LENGTH_0;

var Duplex = require('./_stream_duplex');

require('inherits')(Transform, Duplex);

function afterTransform(er, data) {
  var ts = this._transformState;
  ts.transforming = false;
  var cb = ts.writecb;

  if (cb === null) {
    return this.emit('error', new ERR_MULTIPLE_CALLBACK());
  }

  ts.writechunk = null;
  ts.writecb = null;
  if (data != null) // single equals check for both `null` and `undefined`
    this.push(data);
  cb(er);
  var rs = this._readableState;
  rs.reading = false;

  if (rs.needReadable || rs.length < rs.highWaterMark) {
    this._read(rs.highWaterMark);
  }
}

function Transform(options) {
  if (!(this instanceof Transform)) return new Transform(options);
  Duplex.call(this, options);
  this._transformState = {
    afterTransform: afterTransform.bind(this),
    needTransform: false,
    transforming: false,
    writecb: null,
    writechunk: null,
    writeencoding: null
  }; // start out asking for a readable event once data is transformed.

  this._readableState.needReadable = true; // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.

  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function') this._transform = options.transform;
    if (typeof options.flush === 'function') this._flush = options.flush;
  } // When the writable side finishes, then flush out anything remaining.


  this.on('prefinish', prefinish);
}

function prefinish() {
  var _this = this;

  if (typeof this._flush === 'function' && !this._readableState.destroyed) {
    this._flush(function (er, data) {
      done(_this, er, data);
    });
  } else {
    done(this, null, null);
  }
}

Transform.prototype.push = function (chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
}; // This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.


Transform.prototype._transform = function (chunk, encoding, cb) {
  cb(new ERR_METHOD_NOT_IMPLEMENTED('_transform()'));
};

Transform.prototype._write = function (chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;

  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
  }
}; // Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.


Transform.prototype._read = function (n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && !ts.transforming) {
    ts.transforming = true;

    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};

Transform.prototype._destroy = function (err, cb) {
  Duplex.prototype._destroy.call(this, err, function (err2) {
    cb(err2);
  });
};

function done(stream, er, data) {
  if (er) return stream.emit('error', er);
  if (data != null) // single equals check for both `null` and `undefined`
    stream.push(data); // TODO(BridgeAR): Write a test for these two error cases
  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided

  if (stream._writableState.length) throw new ERR_TRANSFORM_WITH_LENGTH_0();
  if (stream._transformState.transforming) throw new ERR_TRANSFORM_ALREADY_TRANSFORMING();
  return stream.push(null);
}
},{"../errors":12,"./_stream_duplex":13,"inherits":138}],17:[function(require,module,exports){
(function (process,global){(function (){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.
'use strict';

module.exports = Writable;
/* <replacement> */

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
} // It seems a linked list but it is not
// there will be only 2 of these for each stream


function CorkedRequest(state) {
  var _this = this;

  this.next = null;
  this.entry = null;

  this.finish = function () {
    onCorkedFinish(_this, state);
  };
}
/* </replacement> */

/*<replacement>*/


var Duplex;
/*</replacement>*/

Writable.WritableState = WritableState;
/*<replacement>*/

var internalUtil = {
  deprecate: require('util-deprecate')
};
/*</replacement>*/

/*<replacement>*/

var Stream = require('./internal/streams/stream');
/*</replacement>*/


var Buffer = require('buffer').Buffer;

var OurUint8Array = global.Uint8Array || function () {};

function _uint8ArrayToBuffer(chunk) {
  return Buffer.from(chunk);
}

function _isUint8Array(obj) {
  return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
}

var destroyImpl = require('./internal/streams/destroy');

var _require = require('./internal/streams/state'),
    getHighWaterMark = _require.getHighWaterMark;

var _require$codes = require('../errors').codes,
    ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
    ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
    ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
    ERR_STREAM_CANNOT_PIPE = _require$codes.ERR_STREAM_CANNOT_PIPE,
    ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED,
    ERR_STREAM_NULL_VALUES = _require$codes.ERR_STREAM_NULL_VALUES,
    ERR_STREAM_WRITE_AFTER_END = _require$codes.ERR_STREAM_WRITE_AFTER_END,
    ERR_UNKNOWN_ENCODING = _require$codes.ERR_UNKNOWN_ENCODING;

var errorOrDestroy = destroyImpl.errorOrDestroy;

require('inherits')(Writable, Stream);

function nop() {}

function WritableState(options, stream, isDuplex) {
  Duplex = Duplex || require('./_stream_duplex');
  options = options || {}; // Duplex streams are both readable and writable, but share
  // the same options object.
  // However, some cases require setting options to different
  // values for the readable and the writable sides of the duplex stream,
  // e.g. options.readableObjectMode vs. options.writableObjectMode, etc.

  if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag to indicate whether or not this stream
  // contains buffers or objects.

  this.objectMode = !!options.objectMode;
  if (isDuplex) this.objectMode = this.objectMode || !!options.writableObjectMode; // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()

  this.highWaterMark = getHighWaterMark(this, options, 'writableHighWaterMark', isDuplex); // if _final has been called

  this.finalCalled = false; // drain event flag.

  this.needDrain = false; // at the start of calling end()

  this.ending = false; // when end() has been called, and returned

  this.ended = false; // when 'finish' is emitted

  this.finished = false; // has it been destroyed

  this.destroyed = false; // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.

  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode; // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.

  this.defaultEncoding = options.defaultEncoding || 'utf8'; // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.

  this.length = 0; // a flag to see when we're in the middle of a write.

  this.writing = false; // when true all writes will be buffered until .uncork() call

  this.corked = 0; // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.

  this.sync = true; // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.

  this.bufferProcessing = false; // the callback that's passed to _write(chunk,cb)

  this.onwrite = function (er) {
    onwrite(stream, er);
  }; // the callback that the user supplies to write(chunk,encoding,cb)


  this.writecb = null; // the amount that is being written when _write is called.

  this.writelen = 0;
  this.bufferedRequest = null;
  this.lastBufferedRequest = null; // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted

  this.pendingcb = 0; // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams

  this.prefinished = false; // True if the error was already emitted and should not be thrown again

  this.errorEmitted = false; // Should close be emitted on destroy. Defaults to true.

  this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'finish' (and potentially 'end')

  this.autoDestroy = !!options.autoDestroy; // count buffered requests

  this.bufferedRequestCount = 0; // allocate the first CorkedRequest, there is always
  // one allocated and free to use, and we maintain at most two

  this.corkedRequestsFree = new CorkedRequest(this);
}

WritableState.prototype.getBuffer = function getBuffer() {
  var current = this.bufferedRequest;
  var out = [];

  while (current) {
    out.push(current);
    current = current.next;
  }

  return out;
};

(function () {
  try {
    Object.defineProperty(WritableState.prototype, 'buffer', {
      get: internalUtil.deprecate(function writableStateBufferGetter() {
        return this.getBuffer();
      }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.', 'DEP0003')
    });
  } catch (_) {}
})(); // Test _writableState for inheritance to account for Duplex streams,
// whose prototype chain only points to Readable.


var realHasInstance;

if (typeof Symbol === 'function' && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === 'function') {
  realHasInstance = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Writable, Symbol.hasInstance, {
    value: function value(object) {
      if (realHasInstance.call(this, object)) return true;
      if (this !== Writable) return false;
      return object && object._writableState instanceof WritableState;
    }
  });
} else {
  realHasInstance = function realHasInstance(object) {
    return object instanceof this;
  };
}

function Writable(options) {
  Duplex = Duplex || require('./_stream_duplex'); // Writable ctor is applied to Duplexes, too.
  // `realHasInstance` is necessary because using plain `instanceof`
  // would return false, as no `_writableState` property is attached.
  // Trying to use the custom `instanceof` for Writable here will also break the
  // Node.js LazyTransform implementation, which has a non-trivial getter for
  // `_writableState` that would lead to infinite recursion.
  // Checking for a Stream.Duplex instance is faster here instead of inside
  // the WritableState constructor, at least with V8 6.5

  var isDuplex = this instanceof Duplex;
  if (!isDuplex && !realHasInstance.call(Writable, this)) return new Writable(options);
  this._writableState = new WritableState(options, this, isDuplex); // legacy.

  this.writable = true;

  if (options) {
    if (typeof options.write === 'function') this._write = options.write;
    if (typeof options.writev === 'function') this._writev = options.writev;
    if (typeof options.destroy === 'function') this._destroy = options.destroy;
    if (typeof options.final === 'function') this._final = options.final;
  }

  Stream.call(this);
} // Otherwise people can pipe Writable streams, which is just wrong.


Writable.prototype.pipe = function () {
  errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
};

function writeAfterEnd(stream, cb) {
  var er = new ERR_STREAM_WRITE_AFTER_END(); // TODO: defer error events consistently everywhere, not just the cb

  errorOrDestroy(stream, er);
  process.nextTick(cb, er);
} // Checks that a user-supplied chunk is valid, especially for the particular
// mode the stream is in. Currently this means that `null` is never accepted
// and undefined/non-string values are only allowed in object mode.


function validChunk(stream, state, chunk, cb) {
  var er;

  if (chunk === null) {
    er = new ERR_STREAM_NULL_VALUES();
  } else if (typeof chunk !== 'string' && !state.objectMode) {
    er = new ERR_INVALID_ARG_TYPE('chunk', ['string', 'Buffer'], chunk);
  }

  if (er) {
    errorOrDestroy(stream, er);
    process.nextTick(cb, er);
    return false;
  }

  return true;
}

Writable.prototype.write = function (chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  var isBuf = !state.objectMode && _isUint8Array(chunk);

  if (isBuf && !Buffer.isBuffer(chunk)) {
    chunk = _uint8ArrayToBuffer(chunk);
  }

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (isBuf) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;
  if (typeof cb !== 'function') cb = nop;
  if (state.ending) writeAfterEnd(this, cb);else if (isBuf || validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
  }
  return ret;
};

Writable.prototype.cork = function () {
  this._writableState.corked++;
};

Writable.prototype.uncork = function () {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;
    if (!state.writing && !state.corked && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string') encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new ERR_UNKNOWN_ENCODING(encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};

Object.defineProperty(Writable.prototype, 'writableBuffer', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._writableState && this._writableState.getBuffer();
  }
});

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
    chunk = Buffer.from(chunk, encoding);
  }

  return chunk;
}

Object.defineProperty(Writable.prototype, 'writableHighWaterMark', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._writableState.highWaterMark;
  }
}); // if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.

function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
  if (!isBuf) {
    var newChunk = decodeChunk(state, chunk, encoding);

    if (chunk !== newChunk) {
      isBuf = true;
      encoding = 'buffer';
      chunk = newChunk;
    }
  }

  var len = state.objectMode ? 1 : chunk.length;
  state.length += len;
  var ret = state.length < state.highWaterMark; // we must ensure that previous needDrain will not be reset to false.

  if (!ret) state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = {
      chunk: chunk,
      encoding: encoding,
      isBuf: isBuf,
      callback: cb,
      next: null
    };

    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }

    state.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED('write'));else if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;

  if (sync) {
    // defer the callback if we are being called synchronously
    // to avoid piling up things on the stack
    process.nextTick(cb, er); // this can emit finish, and it will always happen
    // after error

    process.nextTick(finishMaybe, stream, state);
    stream._writableState.errorEmitted = true;
    errorOrDestroy(stream, er);
  } else {
    // the caller expect this to happen before if
    // it is async
    cb(er);
    stream._writableState.errorEmitted = true;
    errorOrDestroy(stream, er); // this can emit finish, but finish must
    // always follow error

    finishMaybe(stream, state);
  }
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;
  if (typeof cb !== 'function') throw new ERR_MULTIPLE_CALLBACK();
  onwriteStateUpdate(state);
  if (er) onwriteError(stream, state, sync, er, cb);else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state) || stream.destroyed;

    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      process.nextTick(afterWrite, stream, state, finished, cb);
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished) onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
} // Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.


function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
} // if there's something in the buffer waiting, then process it


function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var l = state.bufferedRequestCount;
    var buffer = new Array(l);
    var holder = state.corkedRequestsFree;
    holder.entry = entry;
    var count = 0;
    var allBuffers = true;

    while (entry) {
      buffer[count] = entry;
      if (!entry.isBuf) allBuffers = false;
      entry = entry.next;
      count += 1;
    }

    buffer.allBuffers = allBuffers;
    doWrite(stream, state, true, state.length, buffer, '', holder.finish); // doWrite is almost always async, defer these to save a bit of time
    // as the hot path ends with doWrite

    state.pendingcb++;
    state.lastBufferedRequest = null;

    if (holder.next) {
      state.corkedRequestsFree = holder.next;
      holder.next = null;
    } else {
      state.corkedRequestsFree = new CorkedRequest(state);
    }

    state.bufferedRequestCount = 0;
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;
      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      state.bufferedRequestCount--; // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.

      if (state.writing) {
        break;
      }
    }

    if (entry === null) state.lastBufferedRequest = null;
  }

  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function (chunk, encoding, cb) {
  cb(new ERR_METHOD_NOT_IMPLEMENTED('_write()'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function (chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined) this.write(chunk, encoding); // .end() fully uncorks

  if (state.corked) {
    state.corked = 1;
    this.uncork();
  } // ignore unnecessary end() calls.


  if (!state.ending) endWritable(this, state, cb);
  return this;
};

Object.defineProperty(Writable.prototype, 'writableLength', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    return this._writableState.length;
  }
});

function needFinish(state) {
  return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
}

function callFinal(stream, state) {
  stream._final(function (err) {
    state.pendingcb--;

    if (err) {
      errorOrDestroy(stream, err);
    }

    state.prefinished = true;
    stream.emit('prefinish');
    finishMaybe(stream, state);
  });
}

function prefinish(stream, state) {
  if (!state.prefinished && !state.finalCalled) {
    if (typeof stream._final === 'function' && !state.destroyed) {
      state.pendingcb++;
      state.finalCalled = true;
      process.nextTick(callFinal, stream, state);
    } else {
      state.prefinished = true;
      stream.emit('prefinish');
    }
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);

  if (need) {
    prefinish(stream, state);

    if (state.pendingcb === 0) {
      state.finished = true;
      stream.emit('finish');

      if (state.autoDestroy) {
        // In case of duplex streams we need a way to detect
        // if the readable side is ready for autoDestroy as well
        var rState = stream._readableState;

        if (!rState || rState.autoDestroy && rState.endEmitted) {
          stream.destroy();
        }
      }
    }
  }

  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);

  if (cb) {
    if (state.finished) process.nextTick(cb);else stream.once('finish', cb);
  }

  state.ended = true;
  stream.writable = false;
}

function onCorkedFinish(corkReq, state, err) {
  var entry = corkReq.entry;
  corkReq.entry = null;

  while (entry) {
    var cb = entry.callback;
    state.pendingcb--;
    cb(err);
    entry = entry.next;
  } // reuse the free corkReq.


  state.corkedRequestsFree.next = corkReq;
}

Object.defineProperty(Writable.prototype, 'destroyed', {
  // making it explicit this property is not enumerable
  // because otherwise some prototype manipulation in
  // userland will fail
  enumerable: false,
  get: function get() {
    if (this._writableState === undefined) {
      return false;
    }

    return this._writableState.destroyed;
  },
  set: function set(value) {
    // we ignore the value if the stream
    // has not been initialized yet
    if (!this._writableState) {
      return;
    } // backward compatibility, the user is explicitly
    // managing destroyed


    this._writableState.destroyed = value;
  }
});
Writable.prototype.destroy = destroyImpl.destroy;
Writable.prototype._undestroy = destroyImpl.undestroy;

Writable.prototype._destroy = function (err, cb) {
  cb(err);
};
}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../errors":12,"./_stream_duplex":13,"./internal/streams/destroy":20,"./internal/streams/state":24,"./internal/streams/stream":25,"_process":206,"buffer":52,"inherits":138,"util-deprecate":312}],18:[function(require,module,exports){
(function (process){(function (){
'use strict';

var _Object$setPrototypeO;

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var finished = require('./end-of-stream');

var kLastResolve = Symbol('lastResolve');
var kLastReject = Symbol('lastReject');
var kError = Symbol('error');
var kEnded = Symbol('ended');
var kLastPromise = Symbol('lastPromise');
var kHandlePromise = Symbol('handlePromise');
var kStream = Symbol('stream');

function createIterResult(value, done) {
  return {
    value: value,
    done: done
  };
}

function readAndResolve(iter) {
  var resolve = iter[kLastResolve];

  if (resolve !== null) {
    var data = iter[kStream].read(); // we defer if data is null
    // we can be expecting either 'end' or
    // 'error'

    if (data !== null) {
      iter[kLastPromise] = null;
      iter[kLastResolve] = null;
      iter[kLastReject] = null;
      resolve(createIterResult(data, false));
    }
  }
}

function onReadable(iter) {
  // we wait for the next tick, because it might
  // emit an error with process.nextTick
  process.nextTick(readAndResolve, iter);
}

function wrapForNext(lastPromise, iter) {
  return function (resolve, reject) {
    lastPromise.then(function () {
      if (iter[kEnded]) {
        resolve(createIterResult(undefined, true));
        return;
      }

      iter[kHandlePromise](resolve, reject);
    }, reject);
  };
}

var AsyncIteratorPrototype = Object.getPrototypeOf(function () {});
var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf((_Object$setPrototypeO = {
  get stream() {
    return this[kStream];
  },

  next: function next() {
    var _this = this;

    // if we have detected an error in the meanwhile
    // reject straight away
    var error = this[kError];

    if (error !== null) {
      return Promise.reject(error);
    }

    if (this[kEnded]) {
      return Promise.resolve(createIterResult(undefined, true));
    }

    if (this[kStream].destroyed) {
      // We need to defer via nextTick because if .destroy(err) is
      // called, the error will be emitted via nextTick, and
      // we cannot guarantee that there is no error lingering around
      // waiting to be emitted.
      return new Promise(function (resolve, reject) {
        process.nextTick(function () {
          if (_this[kError]) {
            reject(_this[kError]);
          } else {
            resolve(createIterResult(undefined, true));
          }
        });
      });
    } // if we have multiple next() calls
    // we will wait for the previous Promise to finish
    // this logic is optimized to support for await loops,
    // where next() is only called once at a time


    var lastPromise = this[kLastPromise];
    var promise;

    if (lastPromise) {
      promise = new Promise(wrapForNext(lastPromise, this));
    } else {
      // fast path needed to support multiple this.push()
      // without triggering the next() queue
      var data = this[kStream].read();

      if (data !== null) {
        return Promise.resolve(createIterResult(data, false));
      }

      promise = new Promise(this[kHandlePromise]);
    }

    this[kLastPromise] = promise;
    return promise;
  }
}, _defineProperty(_Object$setPrototypeO, Symbol.asyncIterator, function () {
  return this;
}), _defineProperty(_Object$setPrototypeO, "return", function _return() {
  var _this2 = this;

  // destroy(err, cb) is a private API
  // we can guarantee we have that here, because we control the
  // Readable class this is attached to
  return new Promise(function (resolve, reject) {
    _this2[kStream].destroy(null, function (err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(createIterResult(undefined, true));
    });
  });
}), _Object$setPrototypeO), AsyncIteratorPrototype);

var createReadableStreamAsyncIterator = function createReadableStreamAsyncIterator(stream) {
  var _Object$create;

  var iterator = Object.create(ReadableStreamAsyncIteratorPrototype, (_Object$create = {}, _defineProperty(_Object$create, kStream, {
    value: stream,
    writable: true
  }), _defineProperty(_Object$create, kLastResolve, {
    value: null,
    writable: true
  }), _defineProperty(_Object$create, kLastReject, {
    value: null,
    writable: true
  }), _defineProperty(_Object$create, kError, {
    value: null,
    writable: true
  }), _defineProperty(_Object$create, kEnded, {
    value: stream._readableState.endEmitted,
    writable: true
  }), _defineProperty(_Object$create, kHandlePromise, {
    value: function value(resolve, reject) {
      var data = iterator[kStream].read();

      if (data) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        resolve(createIterResult(data, false));
      } else {
        iterator[kLastResolve] = resolve;
        iterator[kLastReject] = reject;
      }
    },
    writable: true
  }), _Object$create));
  iterator[kLastPromise] = null;
  finished(stream, function (err) {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      var reject = iterator[kLastReject]; // reject if we are waiting for data in the Promise
      // returned by next() and store the error

      if (reject !== null) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        reject(err);
      }

      iterator[kError] = err;
      return;
    }

    var resolve = iterator[kLastResolve];

    if (resolve !== null) {
      iterator[kLastPromise] = null;
      iterator[kLastResolve] = null;
      iterator[kLastReject] = null;
      resolve(createIterResult(undefined, true));
    }

    iterator[kEnded] = true;
  });
  stream.on('readable', onReadable.bind(null, iterator));
  return iterator;
};

module.exports = createReadableStreamAsyncIterator;
}).call(this)}).call(this,require('_process'))
},{"./end-of-stream":21,"_process":206}],19:[function(require,module,exports){
'use strict';

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var _require = require('buffer'),
    Buffer = _require.Buffer;

var _require2 = require('util'),
    inspect = _require2.inspect;

var custom = inspect && inspect.custom || 'inspect';

function copyBuffer(src, target, offset) {
  Buffer.prototype.copy.call(src, target, offset);
}

module.exports =
/*#__PURE__*/
function () {
  function BufferList() {
    _classCallCheck(this, BufferList);

    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  _createClass(BufferList, [{
    key: "push",
    value: function push(v) {
      var entry = {
        data: v,
        next: null
      };
      if (this.length > 0) this.tail.next = entry;else this.head = entry;
      this.tail = entry;
      ++this.length;
    }
  }, {
    key: "unshift",
    value: function unshift(v) {
      var entry = {
        data: v,
        next: this.head
      };
      if (this.length === 0) this.tail = entry;
      this.head = entry;
      ++this.length;
    }
  }, {
    key: "shift",
    value: function shift() {
      if (this.length === 0) return;
      var ret = this.head.data;
      if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
      --this.length;
      return ret;
    }
  }, {
    key: "clear",
    value: function clear() {
      this.head = this.tail = null;
      this.length = 0;
    }
  }, {
    key: "join",
    value: function join(s) {
      if (this.length === 0) return '';
      var p = this.head;
      var ret = '' + p.data;

      while (p = p.next) {
        ret += s + p.data;
      }

      return ret;
    }
  }, {
    key: "concat",
    value: function concat(n) {
      if (this.length === 0) return Buffer.alloc(0);
      var ret = Buffer.allocUnsafe(n >>> 0);
      var p = this.head;
      var i = 0;

      while (p) {
        copyBuffer(p.data, ret, i);
        i += p.data.length;
        p = p.next;
      }

      return ret;
    } // Consumes a specified amount of bytes or characters from the buffered data.

  }, {
    key: "consume",
    value: function consume(n, hasStrings) {
      var ret;

      if (n < this.head.data.length) {
        // `slice` is the same for buffers and strings.
        ret = this.head.data.slice(0, n);
        this.head.data = this.head.data.slice(n);
      } else if (n === this.head.data.length) {
        // First chunk is a perfect match.
        ret = this.shift();
      } else {
        // Result spans more than one buffer.
        ret = hasStrings ? this._getString(n) : this._getBuffer(n);
      }

      return ret;
    }
  }, {
    key: "first",
    value: function first() {
      return this.head.data;
    } // Consumes a specified amount of characters from the buffered data.

  }, {
    key: "_getString",
    value: function _getString(n) {
      var p = this.head;
      var c = 1;
      var ret = p.data;
      n -= ret.length;

      while (p = p.next) {
        var str = p.data;
        var nb = n > str.length ? str.length : n;
        if (nb === str.length) ret += str;else ret += str.slice(0, n);
        n -= nb;

        if (n === 0) {
          if (nb === str.length) {
            ++c;
            if (p.next) this.head = p.next;else this.head = this.tail = null;
          } else {
            this.head = p;
            p.data = str.slice(nb);
          }

          break;
        }

        ++c;
      }

      this.length -= c;
      return ret;
    } // Consumes a specified amount of bytes from the buffered data.

  }, {
    key: "_getBuffer",
    value: function _getBuffer(n) {
      var ret = Buffer.allocUnsafe(n);
      var p = this.head;
      var c = 1;
      p.data.copy(ret);
      n -= p.data.length;

      while (p = p.next) {
        var buf = p.data;
        var nb = n > buf.length ? buf.length : n;
        buf.copy(ret, ret.length - n, 0, nb);
        n -= nb;

        if (n === 0) {
          if (nb === buf.length) {
            ++c;
            if (p.next) this.head = p.next;else this.head = this.tail = null;
          } else {
            this.head = p;
            p.data = buf.slice(nb);
          }

          break;
        }

        ++c;
      }

      this.length -= c;
      return ret;
    } // Make sure the linked list only shows the minimal necessary information.

  }, {
    key: custom,
    value: function value(_, options) {
      return inspect(this, _objectSpread({}, options, {
        // Only inspect one level.
        depth: 0,
        // It should not recurse.
        customInspect: false
      }));
    }
  }]);

  return BufferList;
}();
},{"buffer":52,"util":48}],20:[function(require,module,exports){
(function (process){(function (){
'use strict'; // undocumented cb() API, needed for core, not for public API

function destroy(err, cb) {
  var _this = this;

  var readableDestroyed = this._readableState && this._readableState.destroyed;
  var writableDestroyed = this._writableState && this._writableState.destroyed;

  if (readableDestroyed || writableDestroyed) {
    if (cb) {
      cb(err);
    } else if (err) {
      if (!this._writableState) {
        process.nextTick(emitErrorNT, this, err);
      } else if (!this._writableState.errorEmitted) {
        this._writableState.errorEmitted = true;
        process.nextTick(emitErrorNT, this, err);
      }
    }

    return this;
  } // we set destroyed to true before firing error callbacks in order
  // to make it re-entrance safe in case destroy() is called within callbacks


  if (this._readableState) {
    this._readableState.destroyed = true;
  } // if this is a duplex stream mark the writable part as destroyed as well


  if (this._writableState) {
    this._writableState.destroyed = true;
  }

  this._destroy(err || null, function (err) {
    if (!cb && err) {
      if (!_this._writableState) {
        process.nextTick(emitErrorAndCloseNT, _this, err);
      } else if (!_this._writableState.errorEmitted) {
        _this._writableState.errorEmitted = true;
        process.nextTick(emitErrorAndCloseNT, _this, err);
      } else {
        process.nextTick(emitCloseNT, _this);
      }
    } else if (cb) {
      process.nextTick(emitCloseNT, _this);
      cb(err);
    } else {
      process.nextTick(emitCloseNT, _this);
    }
  });

  return this;
}

function emitErrorAndCloseNT(self, err) {
  emitErrorNT(self, err);
  emitCloseNT(self);
}

function emitCloseNT(self) {
  if (self._writableState && !self._writableState.emitClose) return;
  if (self._readableState && !self._readableState.emitClose) return;
  self.emit('close');
}

function undestroy() {
  if (this._readableState) {
    this._readableState.destroyed = false;
    this._readableState.reading = false;
    this._readableState.ended = false;
    this._readableState.endEmitted = false;
  }

  if (this._writableState) {
    this._writableState.destroyed = false;
    this._writableState.ended = false;
    this._writableState.ending = false;
    this._writableState.finalCalled = false;
    this._writableState.prefinished = false;
    this._writableState.finished = false;
    this._writableState.errorEmitted = false;
  }
}

function emitErrorNT(self, err) {
  self.emit('error', err);
}

function errorOrDestroy(stream, err) {
  // We have tests that rely on errors being emitted
  // in the same tick, so changing this is semver major.
  // For now when you opt-in to autoDestroy we allow
  // the error to be emitted nextTick. In a future
  // semver major update we should change the default to this.
  var rState = stream._readableState;
  var wState = stream._writableState;
  if (rState && rState.autoDestroy || wState && wState.autoDestroy) stream.destroy(err);else stream.emit('error', err);
}

module.exports = {
  destroy: destroy,
  undestroy: undestroy,
  errorOrDestroy: errorOrDestroy
};
}).call(this)}).call(this,require('_process'))
},{"_process":206}],21:[function(require,module,exports){
// Ported from https://github.com/mafintosh/end-of-stream with
// permission from the author, Mathias Buus (@mafintosh).
'use strict';

var ERR_STREAM_PREMATURE_CLOSE = require('../../../errors').codes.ERR_STREAM_PREMATURE_CLOSE;

function once(callback) {
  var called = false;
  return function () {
    if (called) return;
    called = true;

    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    callback.apply(this, args);
  };
}

function noop() {}

function isRequest(stream) {
  return stream.setHeader && typeof stream.abort === 'function';
}

function eos(stream, opts, callback) {
  if (typeof opts === 'function') return eos(stream, null, opts);
  if (!opts) opts = {};
  callback = once(callback || noop);
  var readable = opts.readable || opts.readable !== false && stream.readable;
  var writable = opts.writable || opts.writable !== false && stream.writable;

  var onlegacyfinish = function onlegacyfinish() {
    if (!stream.writable) onfinish();
  };

  var writableEnded = stream._writableState && stream._writableState.finished;

  var onfinish = function onfinish() {
    writable = false;
    writableEnded = true;
    if (!readable) callback.call(stream);
  };

  var readableEnded = stream._readableState && stream._readableState.endEmitted;

  var onend = function onend() {
    readable = false;
    readableEnded = true;
    if (!writable) callback.call(stream);
  };

  var onerror = function onerror(err) {
    callback.call(stream, err);
  };

  var onclose = function onclose() {
    var err;

    if (readable && !readableEnded) {
      if (!stream._readableState || !stream._readableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
      return callback.call(stream, err);
    }

    if (writable && !writableEnded) {
      if (!stream._writableState || !stream._writableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
      return callback.call(stream, err);
    }
  };

  var onrequest = function onrequest() {
    stream.req.on('finish', onfinish);
  };

  if (isRequest(stream)) {
    stream.on('complete', onfinish);
    stream.on('abort', onclose);
    if (stream.req) onrequest();else stream.on('request', onrequest);
  } else if (writable && !stream._writableState) {
    // legacy streams
    stream.on('end', onlegacyfinish);
    stream.on('close', onlegacyfinish);
  }

  stream.on('end', onend);
  stream.on('finish', onfinish);
  if (opts.error !== false) stream.on('error', onerror);
  stream.on('close', onclose);
  return function () {
    stream.removeListener('complete', onfinish);
    stream.removeListener('abort', onclose);
    stream.removeListener('request', onrequest);
    if (stream.req) stream.req.removeListener('finish', onfinish);
    stream.removeListener('end', onlegacyfinish);
    stream.removeListener('close', onlegacyfinish);
    stream.removeListener('finish', onfinish);
    stream.removeListener('end', onend);
    stream.removeListener('error', onerror);
    stream.removeListener('close', onclose);
  };
}

module.exports = eos;
},{"../../../errors":12}],22:[function(require,module,exports){
module.exports = function () {
  throw new Error('Readable.from is not available in the browser')
};

},{}],23:[function(require,module,exports){
// Ported from https://github.com/mafintosh/pump with
// permission from the author, Mathias Buus (@mafintosh).
'use strict';

var eos;

function once(callback) {
  var called = false;
  return function () {
    if (called) return;
    called = true;
    callback.apply(void 0, arguments);
  };
}

var _require$codes = require('../../../errors').codes,
    ERR_MISSING_ARGS = _require$codes.ERR_MISSING_ARGS,
    ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;

function noop(err) {
  // Rethrow the error if it exists to avoid swallowing it
  if (err) throw err;
}

function isRequest(stream) {
  return stream.setHeader && typeof stream.abort === 'function';
}

function destroyer(stream, reading, writing, callback) {
  callback = once(callback);
  var closed = false;
  stream.on('close', function () {
    closed = true;
  });
  if (eos === undefined) eos = require('./end-of-stream');
  eos(stream, {
    readable: reading,
    writable: writing
  }, function (err) {
    if (err) return callback(err);
    closed = true;
    callback();
  });
  var destroyed = false;
  return function (err) {
    if (closed) return;
    if (destroyed) return;
    destroyed = true; // request.destroy just do .end - .abort is what we want

    if (isRequest(stream)) return stream.abort();
    if (typeof stream.destroy === 'function') return stream.destroy();
    callback(err || new ERR_STREAM_DESTROYED('pipe'));
  };
}

function call(fn) {
  fn();
}

function pipe(from, to) {
  return from.pipe(to);
}

function popCallback(streams) {
  if (!streams.length) return noop;
  if (typeof streams[streams.length - 1] !== 'function') return noop;
  return streams.pop();
}

function pipeline() {
  for (var _len = arguments.length, streams = new Array(_len), _key = 0; _key < _len; _key++) {
    streams[_key] = arguments[_key];
  }

  var callback = popCallback(streams);
  if (Array.isArray(streams[0])) streams = streams[0];

  if (streams.length < 2) {
    throw new ERR_MISSING_ARGS('streams');
  }

  var error;
  var destroys = streams.map(function (stream, i) {
    var reading = i < streams.length - 1;
    var writing = i > 0;
    return destroyer(stream, reading, writing, function (err) {
      if (!error) error = err;
      if (err) destroys.forEach(call);
      if (reading) return;
      destroys.forEach(call);
      callback(error);
    });
  });
  return streams.reduce(pipe);
}

module.exports = pipeline;
},{"../../../errors":12,"./end-of-stream":21}],24:[function(require,module,exports){
'use strict';

var ERR_INVALID_OPT_VALUE = require('../../../errors').codes.ERR_INVALID_OPT_VALUE;

function highWaterMarkFrom(options, isDuplex, duplexKey) {
  return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
}

function getHighWaterMark(state, options, duplexKey, isDuplex) {
  var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);

  if (hwm != null) {
    if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
      var name = isDuplex ? duplexKey : 'highWaterMark';
      throw new ERR_INVALID_OPT_VALUE(name, hwm);
    }

    return Math.floor(hwm);
  } // Default value


  return state.objectMode ? 16 : 16 * 1024;
}

module.exports = {
  getHighWaterMark: getHighWaterMark
};
},{"../../../errors":12}],25:[function(require,module,exports){
module.exports = require('events').EventEmitter;

},{"events":117}],26:[function(require,module,exports){
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = exports;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');
exports.finished = require('./lib/internal/streams/end-of-stream.js');
exports.pipeline = require('./lib/internal/streams/pipeline.js');

},{"./lib/_stream_duplex.js":13,"./lib/_stream_passthrough.js":14,"./lib/_stream_readable.js":15,"./lib/_stream_transform.js":16,"./lib/_stream_writable.js":17,"./lib/internal/streams/end-of-stream.js":21,"./lib/internal/streams/pipeline.js":23}],27:[function(require,module,exports){
(function (process,Buffer){(function (){
const debug = require('debug')('bittorrent-tracker:client')
const EventEmitter = require('events')
const once = require('once')
const parallel = require('run-parallel')
const Peer = require('simple-peer')
const queueMicrotask = require('queue-microtask')

const common = require('./lib/common')
const HTTPTracker = require('./lib/client/http-tracker') // empty object in browser
const UDPTracker = require('./lib/client/udp-tracker') // empty object in browser
const WebSocketTracker = require('./lib/client/websocket-tracker')

/**
 * BitTorrent tracker client.
 *
 * Find torrent peers, to help a torrent client participate in a torrent swarm.
 *
 * @param {Object} opts                          options object
 * @param {string|Buffer} opts.infoHash          torrent info hash
 * @param {string|Buffer} opts.peerId            peer id
 * @param {string|Array.<string>} opts.announce  announce
 * @param {number} opts.port                     torrent client listening port
 * @param {function} opts.getAnnounceOpts        callback to provide data to tracker
 * @param {number} opts.rtcConfig                RTCPeerConnection configuration object
 * @param {number} opts.userAgent                User-Agent header for http requests
 * @param {number} opts.wrtc                     custom webrtc impl (useful in node.js)
 */
class Client extends EventEmitter {
  constructor (opts = {}) {
    super()

    if (!opts.peerId) throw new Error('Option `peerId` is required')
    if (!opts.infoHash) throw new Error('Option `infoHash` is required')
    if (!opts.announce) throw new Error('Option `announce` is required')
    if (!process.browser && !opts.port) throw new Error('Option `port` is required')

    this.peerId = typeof opts.peerId === 'string'
      ? opts.peerId
      : opts.peerId.toString('hex')
    this._peerIdBuffer = Buffer.from(this.peerId, 'hex')
    this._peerIdBinary = this._peerIdBuffer.toString('binary')

    this.infoHash = typeof opts.infoHash === 'string'
      ? opts.infoHash.toLowerCase()
      : opts.infoHash.toString('hex')
    this._infoHashBuffer = Buffer.from(this.infoHash, 'hex')
    this._infoHashBinary = this._infoHashBuffer.toString('binary')

    debug('new client %s', this.infoHash)

    this.destroyed = false

    this._port = opts.port
    this._getAnnounceOpts = opts.getAnnounceOpts
    this._rtcConfig = opts.rtcConfig
    this._userAgent = opts.userAgent

    // Support lazy 'wrtc' module initialization
    // See: https://github.com/webtorrent/webtorrent-hybrid/issues/46
    this._wrtc = typeof opts.wrtc === 'function' ? opts.wrtc() : opts.wrtc

    let announce = typeof opts.announce === 'string'
      ? [opts.announce]
      : opts.announce == null ? [] : opts.announce

    // Remove trailing slash from trackers to catch duplicates
    announce = announce.map(announceUrl => {
      announceUrl = announceUrl.toString()
      if (announceUrl[announceUrl.length - 1] === '/') {
        announceUrl = announceUrl.substring(0, announceUrl.length - 1)
      }
      return announceUrl
    })
    // remove duplicates by converting to Set and back
    announce = Array.from(new Set(announce))

    const webrtcSupport = this._wrtc !== false && (!!this._wrtc || Peer.WEBRTC_SUPPORT)

    const nextTickWarn = err => {
      queueMicrotask(() => {
        this.emit('warning', err)
      })
    }

    this._trackers = announce
      .map(announceUrl => {
        let parsedUrl
        try {
          parsedUrl = new URL(announceUrl)
        } catch (err) {
          nextTickWarn(new Error(`Invalid tracker URL: ${announceUrl}`))
          return null
        }

        const port = parsedUrl.port
        if (port < 0 || port > 65535) {
          nextTickWarn(new Error(`Invalid tracker port: ${announceUrl}`))
          return null
        }

        const protocol = parsedUrl.protocol
        if ((protocol === 'http:' || protocol === 'https:') &&
            typeof HTTPTracker === 'function') {
          return new HTTPTracker(this, announceUrl)
        } else if (protocol === 'udp:' && typeof UDPTracker === 'function') {
          return new UDPTracker(this, announceUrl)
        } else if ((protocol === 'ws:' || protocol === 'wss:') && webrtcSupport) {
          // Skip ws:// trackers on https:// sites because they throw SecurityError
          if (protocol === 'ws:' && typeof window !== 'undefined' &&
              window.location.protocol === 'https:') {
            nextTickWarn(new Error(`Unsupported tracker protocol: ${announceUrl}`))
            return null
          }
          return new WebSocketTracker(this, announceUrl)
        } else {
          nextTickWarn(new Error(`Unsupported tracker protocol: ${announceUrl}`))
          return null
        }
      })
      .filter(Boolean)
  }

  /**
   * Send a `start` announce to the trackers.
   * @param {Object} opts
   * @param {number=} opts.uploaded
   * @param {number=} opts.downloaded
   * @param {number=} opts.left (if not set, calculated automatically)
   */
  start (opts) {
    opts = this._defaultAnnounceOpts(opts)
    opts.event = 'started'
    debug('send `start` %o', opts)
    this._announce(opts)

    // start announcing on intervals
    this._trackers.forEach(tracker => {
      tracker.setInterval()
    })
  }

  /**
   * Send a `stop` announce to the trackers.
   * @param {Object} opts
   * @param {number=} opts.uploaded
   * @param {number=} opts.downloaded
   * @param {number=} opts.numwant
   * @param {number=} opts.left (if not set, calculated automatically)
   */
  stop (opts) {
    opts = this._defaultAnnounceOpts(opts)
    opts.event = 'stopped'
    debug('send `stop` %o', opts)
    this._announce(opts)
  }

  /**
   * Send a `complete` announce to the trackers.
   * @param {Object} opts
   * @param {number=} opts.uploaded
   * @param {number=} opts.downloaded
   * @param {number=} opts.numwant
   * @param {number=} opts.left (if not set, calculated automatically)
   */
  complete (opts) {
    if (!opts) opts = {}
    opts = this._defaultAnnounceOpts(opts)
    opts.event = 'completed'
    debug('send `complete` %o', opts)
    this._announce(opts)
  }

  /**
   * Send a `update` announce to the trackers.
   * @param {Object} opts
   * @param {number=} opts.uploaded
   * @param {number=} opts.downloaded
   * @param {number=} opts.numwant
   * @param {number=} opts.left (if not set, calculated automatically)
   */
  update (opts) {
    opts = this._defaultAnnounceOpts(opts)
    if (opts.event) delete opts.event
    debug('send `update` %o', opts)
    this._announce(opts)
  }

  _announce (opts) {
    this._trackers.forEach(tracker => {
      // tracker should not modify `opts` object, it's passed to all trackers
      tracker.announce(opts)
    })
  }

  /**
   * Send a scrape request to the trackers.
   * @param {Object} opts
   */
  scrape (opts) {
    debug('send `scrape`')
    if (!opts) opts = {}
    this._trackers.forEach(tracker => {
      // tracker should not modify `opts` object, it's passed to all trackers
      tracker.scrape(opts)
    })
  }

  setInterval (intervalMs) {
    debug('setInterval %d', intervalMs)
    this._trackers.forEach(tracker => {
      tracker.setInterval(intervalMs)
    })
  }

  destroy (cb) {
    if (this.destroyed) return
    this.destroyed = true
    debug('destroy')

    const tasks = this._trackers.map(tracker => cb => {
      tracker.destroy(cb)
    })

    parallel(tasks, cb)

    this._trackers = []
    this._getAnnounceOpts = null
  }

  _defaultAnnounceOpts (opts = {}) {
    if (opts.numwant == null) opts.numwant = common.DEFAULT_ANNOUNCE_PEERS

    if (opts.uploaded == null) opts.uploaded = 0
    if (opts.downloaded == null) opts.downloaded = 0

    if (this._getAnnounceOpts) opts = Object.assign({}, opts, this._getAnnounceOpts())

    return opts
  }
}

/**
 * Simple convenience function to scrape a tracker for an info hash without needing to
 * create a Client, pass it a parsed torrent, etc. Support scraping a tracker for multiple
 * torrents at the same time.
 * @params {Object} opts
 * @param  {string|Array.<string>} opts.infoHash
 * @param  {string} opts.announce
 * @param  {function} cb
 */
Client.scrape = (opts, cb) => {
  cb = once(cb)

  if (!opts.infoHash) throw new Error('Option `infoHash` is required')
  if (!opts.announce) throw new Error('Option `announce` is required')

  const clientOpts = Object.assign({}, opts, {
    infoHash: Array.isArray(opts.infoHash) ? opts.infoHash[0] : opts.infoHash,
    peerId: Buffer.from('01234567890123456789'), // dummy value
    port: 6881 // dummy value
  })

  const client = new Client(clientOpts)
  client.once('error', cb)
  client.once('warning', cb)

  let len = Array.isArray(opts.infoHash) ? opts.infoHash.length : 1
  const results = {}
  client.on('scrape', data => {
    len -= 1
    results[data.infoHash] = data
    if (len === 0) {
      client.destroy()
      const keys = Object.keys(results)
      if (keys.length === 1) {
        cb(null, results[keys[0]])
      } else {
        cb(null, results)
      }
    }
  })

  opts.infoHash = Array.isArray(opts.infoHash)
    ? opts.infoHash.map(infoHash => {
        return Buffer.from(infoHash, 'hex')
      })
    : Buffer.from(opts.infoHash, 'hex')
  client.scrape({ infoHash: opts.infoHash })
  return client
}

module.exports = Client

}).call(this)}).call(this,require('_process'),require("buffer").Buffer)
},{"./lib/client/http-tracker":48,"./lib/client/udp-tracker":48,"./lib/client/websocket-tracker":29,"./lib/common":30,"_process":206,"buffer":52,"debug":111,"events":117,"once":201,"queue-microtask":212,"run-parallel":234,"simple-peer":239}],28:[function(require,module,exports){
const EventEmitter = require('events')

class Tracker extends EventEmitter {
  constructor (client, announceUrl) {
    super()

    this.client = client
    this.announceUrl = announceUrl

    this.interval = null
    this.destroyed = false
  }

  setInterval (intervalMs) {
    if (intervalMs == null) intervalMs = this.DEFAULT_ANNOUNCE_INTERVAL

    clearInterval(this.interval)

    if (intervalMs) {
      this.interval = setInterval(() => {
        this.announce(this.client._defaultAnnounceOpts())
      }, intervalMs)
      if (this.interval.unref) this.interval.unref()
    }
  }
}

module.exports = Tracker

},{"events":117}],29:[function(require,module,exports){
const debug = require('debug')('bittorrent-tracker:websocket-tracker')
const Peer = require('simple-peer')
const randombytes = require('randombytes')
const Socket = require('simple-websocket')

const common = require('../common')
const Tracker = require('./tracker')

// Use a socket pool, so tracker clients share WebSocket objects for the same server.
// In practice, WebSockets are pretty slow to establish, so this gives a nice performance
// boost, and saves browser resources.
const socketPool = {}

const RECONNECT_MINIMUM = 10 * 1000
const RECONNECT_MAXIMUM = 60 * 60 * 1000
const RECONNECT_VARIANCE = 5 * 60 * 1000
const OFFER_TIMEOUT = 50 * 1000

class WebSocketTracker extends Tracker {
  constructor (client, announceUrl, opts) {
    super(client, announceUrl)
    debug('new websocket tracker %s', announceUrl)

    this.peers = {} // peers (offer id -> peer)
    this.socket = null

    this.reconnecting = false
    this.retries = 0
    this.reconnectTimer = null

    // Simple boolean flag to track whether the socket has received data from
    // the websocket server since the last time socket.send() was called.
    this.expectingResponse = false

    this._openSocket()
  }

  announce (opts) {
    if (this.destroyed || this.reconnecting) return
    if (!this.socket.connected) {
      this.socket.once('connect', () => {
        this.announce(opts)
      })
      return
    }

    const params = Object.assign({}, opts, {
      action: 'announce',
      info_hash: this.client._infoHashBinary,
      peer_id: this.client._peerIdBinary
    })
    if (this._trackerId) params.trackerid = this._trackerId

    if (opts.event === 'stopped' || opts.event === 'completed') {
      // Don't include offers with 'stopped' or 'completed' event
      this._send(params)
    } else {
      // Limit the number of offers that are generated, since it can be slow
      const numwant = Math.min(opts.numwant, 5)

      this._generateOffers(numwant, offers => {
        params.numwant = numwant
        params.offers = offers
        this._send(params)
      })
    }
  }

  scrape (opts) {
    if (this.destroyed || this.reconnecting) return
    if (!this.socket.connected) {
      this.socket.once('connect', () => {
        this.scrape(opts)
      })
      return
    }

    const infoHashes = (Array.isArray(opts.infoHash) && opts.infoHash.length > 0)
      ? opts.infoHash.map(infoHash => {
          return infoHash.toString('binary')
        })
      : (opts.infoHash && opts.infoHash.toString('binary')) || this.client._infoHashBinary
    const params = {
      action: 'scrape',
      info_hash: infoHashes
    }

    this._send(params)
  }

  destroy (cb = noop) {
    if (this.destroyed) return cb(null)

    this.destroyed = true

    clearInterval(this.interval)
    clearTimeout(this.reconnectTimer)

    // Destroy peers
    for (const peerId in this.peers) {
      const peer = this.peers[peerId]
      clearTimeout(peer.trackerTimeout)
      peer.destroy()
    }
    this.peers = null

    if (this.socket) {
      this.socket.removeListener('connect', this._onSocketConnectBound)
      this.socket.removeListener('data', this._onSocketDataBound)
      this.socket.removeListener('close', this._onSocketCloseBound)
      this.socket.removeListener('error', this._onSocketErrorBound)
      this.socket = null
    }

    this._onSocketConnectBound = null
    this._onSocketErrorBound = null
    this._onSocketDataBound = null
    this._onSocketCloseBound = null

    if (socketPool[this.announceUrl]) {
      socketPool[this.announceUrl].consumers -= 1
    }

    // Other instances are using the socket, so there's nothing left to do here
    if (socketPool[this.announceUrl].consumers > 0) return cb()

    let socket = socketPool[this.announceUrl]
    delete socketPool[this.announceUrl]
    socket.on('error', noop) // ignore all future errors
    socket.once('close', cb)

    let timeout

    // If there is no data response expected, destroy immediately.
    if (!this.expectingResponse) return destroyCleanup()

    // Otherwise, wait a short time for potential responses to come in from the
    // server, then force close the socket.
    timeout = setTimeout(destroyCleanup, common.DESTROY_TIMEOUT)

    // But, if a response comes from the server before the timeout fires, do cleanup
    // right away.
    socket.once('data', destroyCleanup)

    function destroyCleanup () {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      socket.removeListener('data', destroyCleanup)
      socket.destroy()
      socket = null
    }
  }

  _openSocket () {
    this.destroyed = false

    if (!this.peers) this.peers = {}

    this._onSocketConnectBound = () => {
      this._onSocketConnect()
    }
    this._onSocketErrorBound = err => {
      this._onSocketError(err)
    }
    this._onSocketDataBound = data => {
      this._onSocketData(data)
    }
    this._onSocketCloseBound = () => {
      this._onSocketClose()
    }

    this.socket = socketPool[this.announceUrl]
    if (this.socket) {
      socketPool[this.announceUrl].consumers += 1
      if (this.socket.connected) {
        this._onSocketConnectBound()
      }
    } else {
      this.socket = socketPool[this.announceUrl] = new Socket(this.announceUrl)
      this.socket.consumers = 1
      this.socket.once('connect', this._onSocketConnectBound)
    }

    this.socket.on('data', this._onSocketDataBound)
    this.socket.once('close', this._onSocketCloseBound)
    this.socket.once('error', this._onSocketErrorBound)
  }

  _onSocketConnect () {
    if (this.destroyed) return

    if (this.reconnecting) {
      this.reconnecting = false
      this.retries = 0
      this.announce(this.client._defaultAnnounceOpts())
    }
  }

  _onSocketData (data) {
    if (this.destroyed) return

    this.expectingResponse = false

    try {
      data = JSON.parse(data)
    } catch (err) {
      this.client.emit('warning', new Error('Invalid tracker response'))
      return
    }

    if (data.action === 'announce') {
      this._onAnnounceResponse(data)
    } else if (data.action === 'scrape') {
      this._onScrapeResponse(data)
    } else {
      this._onSocketError(new Error(`invalid action in WS response: ${data.action}`))
    }
  }

  _onAnnounceResponse (data) {
    if (data.info_hash !== this.client._infoHashBinary) {
      debug(
        'ignoring websocket data from %s for %s (looking for %s: reused socket)',
        this.announceUrl, common.binaryToHex(data.info_hash), this.client.infoHash
      )
      return
    }

    if (data.peer_id && data.peer_id === this.client._peerIdBinary) {
      // ignore offers/answers from this client
      return
    }

    debug(
      'received %s from %s for %s',
      JSON.stringify(data), this.announceUrl, this.client.infoHash
    )

    const failure = data['failure reason']
    if (failure) return this.client.emit('warning', new Error(failure))

    const warning = data['warning message']
    if (warning) this.client.emit('warning', new Error(warning))

    const interval = data.interval || data['min interval']
    if (interval) this.setInterval(interval * 1000)

    const trackerId = data['tracker id']
    if (trackerId) {
      // If absent, do not discard previous trackerId value
      this._trackerId = trackerId
    }

    if (data.complete != null) {
      const response = Object.assign({}, data, {
        announce: this.announceUrl,
        infoHash: common.binaryToHex(data.info_hash)
      })
      this.client.emit('update', response)
    }

    let peer
    if (data.offer && data.peer_id) {
      debug('creating peer (from remote offer)')
      peer = this._createPeer()
      peer.id = common.binaryToHex(data.peer_id)
      peer.once('signal', answer => {
        const params = {
          action: 'announce',
          info_hash: this.client._infoHashBinary,
          peer_id: this.client._peerIdBinary,
          to_peer_id: data.peer_id,
          answer,
          offer_id: data.offer_id
        }
        if (this._trackerId) params.trackerid = this._trackerId
        this._send(params)
      })
      this.client.emit('peer', peer)
      peer.signal(data.offer)
    }

    if (data.answer && data.peer_id) {
      const offerId = common.binaryToHex(data.offer_id)
      peer = this.peers[offerId]
      if (peer) {
        peer.id = common.binaryToHex(data.peer_id)
        this.client.emit('peer', peer)
        peer.signal(data.answer)

        clearTimeout(peer.trackerTimeout)
        peer.trackerTimeout = null
        delete this.peers[offerId]
      } else {
        debug(`got unexpected answer: ${JSON.stringify(data.answer)}`)
      }
    }
  }

  _onScrapeResponse (data) {
    data = data.files || {}

    const keys = Object.keys(data)
    if (keys.length === 0) {
      this.client.emit('warning', new Error('invalid scrape response'))
      return
    }

    keys.forEach(infoHash => {
      // TODO: optionally handle data.flags.min_request_interval
      // (separate from announce interval)
      const response = Object.assign(data[infoHash], {
        announce: this.announceUrl,
        infoHash: common.binaryToHex(infoHash)
      })
      this.client.emit('scrape', response)
    })
  }

  _onSocketClose () {
    if (this.destroyed) return
    this.destroy()
    this._startReconnectTimer()
  }

  _onSocketError (err) {
    if (this.destroyed) return
    this.destroy()
    // errors will often happen if a tracker is offline, so don't treat it as fatal
    this.client.emit('warning', err)
    this._startReconnectTimer()
  }

  _startReconnectTimer () {
    const ms = Math.floor(Math.random() * RECONNECT_VARIANCE) + Math.min(Math.pow(2, this.retries) * RECONNECT_MINIMUM, RECONNECT_MAXIMUM)

    this.reconnecting = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.retries++
      this._openSocket()
    }, ms)
    if (this.reconnectTimer.unref) this.reconnectTimer.unref()

    debug('reconnecting socket in %s ms', ms)
  }

  _send (params) {
    if (this.destroyed) return
    this.expectingResponse = true
    const message = JSON.stringify(params)
    debug('send %s', message)
    this.socket.send(message)
  }

  _generateOffers (numwant, cb) {
    const self = this
    const offers = []
    debug('generating %s offers', numwant)

    for (let i = 0; i < numwant; ++i) {
      generateOffer()
    }
    checkDone()

    function generateOffer () {
      const offerId = randombytes(20).toString('hex')
      debug('creating peer (from _generateOffers)')
      const peer = self.peers[offerId] = self._createPeer({ initiator: true })
      peer.once('signal', offer => {
        offers.push({
          offer,
          offer_id: common.hexToBinary(offerId)
        })
        checkDone()
      })
      peer.trackerTimeout = setTimeout(() => {
        debug('tracker timeout: destroying peer')
        peer.trackerTimeout = null
        delete self.peers[offerId]
        peer.destroy()
      }, OFFER_TIMEOUT)
      if (peer.trackerTimeout.unref) peer.trackerTimeout.unref()
    }

    function checkDone () {
      if (offers.length === numwant) {
        debug('generated %s offers', numwant)
        cb(offers)
      }
    }
  }

  _createPeer (opts) {
    const self = this

    opts = Object.assign({
      trickle: false,
      config: self.client._rtcConfig,
      wrtc: self.client._wrtc
    }, opts)

    const peer = new Peer(opts)

    peer.once('error', onError)
    peer.once('connect', onConnect)

    return peer

    // Handle peer 'error' events that are fired *before* the peer is emitted in
    // a 'peer' event.
    function onError (err) {
      self.client.emit('warning', new Error(`Connection error: ${err.message}`))
      peer.destroy()
    }

    // Once the peer is emitted in a 'peer' event, then it's the consumer's
    // responsibility to listen for errors, so the listeners are removed here.
    function onConnect () {
      peer.removeListener('error', onError)
      peer.removeListener('connect', onConnect)
    }
  }
}

WebSocketTracker.prototype.DEFAULT_ANNOUNCE_INTERVAL = 30 * 1000 // 30 seconds
// Normally this shouldn't be accessed but is occasionally useful
WebSocketTracker._socketPool = socketPool

function noop () {}

module.exports = WebSocketTracker

},{"../common":30,"./tracker":28,"debug":111,"randombytes":214,"simple-peer":239,"simple-websocket":257}],30:[function(require,module,exports){
(function (Buffer){(function (){
/**
 * Functions/constants needed by both the client and server.
 */

exports.DEFAULT_ANNOUNCE_PEERS = 50
exports.MAX_ANNOUNCE_PEERS = 82

exports.binaryToHex = function (str) {
  if (typeof str !== 'string') {
    str = String(str)
  }
  return Buffer.from(str, 'binary').toString('hex')
}

exports.hexToBinary = function (str) {
  if (typeof str !== 'string') {
    str = String(str)
  }
  return Buffer.from(str, 'hex').toString('binary')
}

const config = require('./common-node')
Object.assign(exports, config)

}).call(this)}).call(this,require("buffer").Buffer)
},{"./common-node":48,"buffer":52}],31:[function(require,module,exports){
(function (Buffer){(function (){
/*! blob-to-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
/* global Blob, FileReader */

module.exports = function blobToBuffer (blob, cb) {
  if (typeof Blob === 'undefined' || !(blob instanceof Blob)) {
    throw new Error('first argument must be a Blob')
  }
  if (typeof cb !== 'function') {
    throw new Error('second argument must be a function')
  }

  const reader = new FileReader()

  function onLoadEnd (e) {
    reader.removeEventListener('loadend', onLoadEnd, false)
    if (e.error) cb(e.error)
    else cb(null, Buffer.from(reader.result))
  }

  reader.addEventListener('loadend', onLoadEnd, false)
  reader.readAsArrayBuffer(blob)
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],32:[function(require,module,exports){
(function (Buffer){(function (){
const { Transform } = require('readable-stream')

class Block extends Transform {
  constructor (size, opts = {}) {
    super(opts)

    if (typeof size === 'object') {
      opts = size
      size = opts.size
    }

    this.size = size || 512

    const { nopad, zeroPadding = true } = opts

    if (nopad) this._zeroPadding = false
    else this._zeroPadding = !!zeroPadding

    this._buffered = []
    this._bufferedBytes = 0
  }

  _transform (buf, enc, next) {
    this._bufferedBytes += buf.length
    this._buffered.push(buf)

    while (this._bufferedBytes >= this.size) {
      this._bufferedBytes -= this.size

      // Assemble the buffers that will compose the final block
      const blockBufs = []
      let blockBufsBytes = 0
      while (blockBufsBytes < this.size) {
        const b = this._buffered.shift()

        if (blockBufsBytes + b.length <= this.size) {
          blockBufs.push(b)
          blockBufsBytes += b.length
        } else {
          // If the last buffer is larger than needed for the block, just
          // use the needed part
          const neededSize = this.size - blockBufsBytes
          blockBufs.push(b.slice(0, neededSize))
          blockBufsBytes += neededSize
          this._buffered.unshift(b.slice(neededSize))
        }
      }

      // Then concat just those buffers, leaving the rest untouched in _buffered
      this.push(Buffer.concat(blockBufs, this.size))
    }
    next()
  }

  _flush () {
    if (this._bufferedBytes && this._zeroPadding) {
      const zeroes = Buffer.alloc(this.size - this._bufferedBytes)
      this._buffered.push(zeroes)
      this.push(Buffer.concat(this._buffered))
      this._buffered = null
    } else if (this._bufferedBytes) {
      this.push(Buffer.concat(this._buffered))
      this._buffered = null
    }
    this.push(null)
  }
}

module.exports = Block

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"readable-stream":47}],33:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],34:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":36,"./_stream_writable":38,"_process":206,"dup":13,"inherits":138}],35:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":37,"dup":14,"inherits":138}],36:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":33,"./_stream_duplex":34,"./internal/streams/async_iterator":39,"./internal/streams/buffer_list":40,"./internal/streams/destroy":41,"./internal/streams/from":43,"./internal/streams/state":45,"./internal/streams/stream":46,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],37:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":33,"./_stream_duplex":34,"dup":16,"inherits":138}],38:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":33,"./_stream_duplex":34,"./internal/streams/destroy":41,"./internal/streams/state":45,"./internal/streams/stream":46,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],39:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":42,"_process":206,"dup":18}],40:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],41:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],42:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":33,"dup":21}],43:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],44:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":33,"./end-of-stream":42,"dup":23}],45:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":33,"dup":24}],46:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],47:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":34,"./lib/_stream_passthrough.js":35,"./lib/_stream_readable.js":36,"./lib/_stream_transform.js":37,"./lib/_stream_writable.js":38,"./lib/internal/streams/end-of-stream.js":42,"./lib/internal/streams/pipeline.js":44,"dup":26}],48:[function(require,module,exports){

},{}],49:[function(require,module,exports){
(function (Buffer){(function (){
function allocUnsafe (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  }

  if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }

  if (Buffer.allocUnsafe) {
    return Buffer.allocUnsafe(size)
  } else {
    return new Buffer(size)
  }
}

module.exports = allocUnsafe

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],50:[function(require,module,exports){
(function (Buffer){(function (){
var bufferFill = require('buffer-fill')
var allocUnsafe = require('buffer-alloc-unsafe')

module.exports = function alloc (size, fill, encoding) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  }

  if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }

  if (Buffer.alloc) {
    return Buffer.alloc(size, fill, encoding)
  }

  var buffer = allocUnsafe(size)

  if (size === 0) {
    return buffer
  }

  if (fill === undefined) {
    return bufferFill(buffer, 0)
  }

  if (typeof encoding !== 'string') {
    encoding = undefined
  }

  return bufferFill(buffer, fill, encoding)
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"buffer-alloc-unsafe":49,"buffer-fill":51}],51:[function(require,module,exports){
(function (Buffer){(function (){
/* Node.js 6.4.0 and up has full support */
var hasFullSupport = (function () {
  try {
    if (!Buffer.isEncoding('latin1')) {
      return false
    }

    var buf = Buffer.alloc ? Buffer.alloc(4) : new Buffer(4)

    buf.fill('ab', 'ucs2')

    return (buf.toString('hex') === '61006200')
  } catch (_) {
    return false
  }
}())

function isSingleByte (val) {
  return (val.length === 1 && val.charCodeAt(0) < 256)
}

function fillWithNumber (buffer, val, start, end) {
  if (start < 0 || end > buffer.length) {
    throw new RangeError('Out of range index')
  }

  start = start >>> 0
  end = end === undefined ? buffer.length : end >>> 0

  if (end > start) {
    buffer.fill(val, start, end)
  }

  return buffer
}

function fillWithBuffer (buffer, val, start, end) {
  if (start < 0 || end > buffer.length) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return buffer
  }

  start = start >>> 0
  end = end === undefined ? buffer.length : end >>> 0

  var pos = start
  var len = val.length
  while (pos <= (end - len)) {
    val.copy(buffer, pos)
    pos += len
  }

  if (pos !== end) {
    val.copy(buffer, pos, 0, end - pos)
  }

  return buffer
}

function fill (buffer, val, start, end, encoding) {
  if (hasFullSupport) {
    return buffer.fill(val, start, end, encoding)
  }

  if (typeof val === 'number') {
    return fillWithNumber(buffer, val, start, end)
  }

  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = buffer.length
    } else if (typeof end === 'string') {
      encoding = end
      end = buffer.length
    }

    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }

    if (encoding === 'latin1') {
      encoding = 'binary'
    }

    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }

    if (val === '') {
      return fillWithNumber(buffer, 0, start, end)
    }

    if (isSingleByte(val)) {
      return fillWithNumber(buffer, val.charCodeAt(0), start, end)
    }

    val = new Buffer(val, encoding)
  }

  if (Buffer.isBuffer(val)) {
    return fillWithBuffer(buffer, val, start, end)
  }

  // Other values (e.g. undefined, boolean, object) results in zero-fill
  return fillWithNumber(buffer, 0, start, end)
}

module.exports = fill

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],52:[function(require,module,exports){
(function (Buffer){(function (){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species != null &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"base64-js":4,"buffer":52,"ieee754":136}],53:[function(require,module,exports){
module.exports = {
  "100": "Continue",
  "101": "Switching Protocols",
  "102": "Processing",
  "200": "OK",
  "201": "Created",
  "202": "Accepted",
  "203": "Non-Authoritative Information",
  "204": "No Content",
  "205": "Reset Content",
  "206": "Partial Content",
  "207": "Multi-Status",
  "208": "Already Reported",
  "226": "IM Used",
  "300": "Multiple Choices",
  "301": "Moved Permanently",
  "302": "Found",
  "303": "See Other",
  "304": "Not Modified",
  "305": "Use Proxy",
  "307": "Temporary Redirect",
  "308": "Permanent Redirect",
  "400": "Bad Request",
  "401": "Unauthorized",
  "402": "Payment Required",
  "403": "Forbidden",
  "404": "Not Found",
  "405": "Method Not Allowed",
  "406": "Not Acceptable",
  "407": "Proxy Authentication Required",
  "408": "Request Timeout",
  "409": "Conflict",
  "410": "Gone",
  "411": "Length Required",
  "412": "Precondition Failed",
  "413": "Payload Too Large",
  "414": "URI Too Long",
  "415": "Unsupported Media Type",
  "416": "Range Not Satisfiable",
  "417": "Expectation Failed",
  "418": "I'm a teapot",
  "421": "Misdirected Request",
  "422": "Unprocessable Entity",
  "423": "Locked",
  "424": "Failed Dependency",
  "425": "Unordered Collection",
  "426": "Upgrade Required",
  "428": "Precondition Required",
  "429": "Too Many Requests",
  "431": "Request Header Fields Too Large",
  "451": "Unavailable For Legal Reasons",
  "500": "Internal Server Error",
  "501": "Not Implemented",
  "502": "Bad Gateway",
  "503": "Service Unavailable",
  "504": "Gateway Timeout",
  "505": "HTTP Version Not Supported",
  "506": "Variant Also Negotiates",
  "507": "Insufficient Storage",
  "508": "Loop Detected",
  "509": "Bandwidth Limit Exceeded",
  "510": "Not Extended",
  "511": "Network Authentication Required"
}

},{}],54:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],55:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":57,"./_stream_writable":59,"_process":206,"dup":13,"inherits":138}],56:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":58,"dup":14,"inherits":138}],57:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":54,"./_stream_duplex":55,"./internal/streams/async_iterator":60,"./internal/streams/buffer_list":61,"./internal/streams/destroy":62,"./internal/streams/from":64,"./internal/streams/state":66,"./internal/streams/stream":67,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],58:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":54,"./_stream_duplex":55,"dup":16,"inherits":138}],59:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":54,"./_stream_duplex":55,"./internal/streams/destroy":62,"./internal/streams/state":66,"./internal/streams/stream":67,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],60:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":63,"_process":206,"dup":18}],61:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],62:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],63:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":54,"dup":21}],64:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],65:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":54,"./end-of-stream":63,"dup":23}],66:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":54,"dup":24}],67:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],68:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":55,"./lib/_stream_passthrough.js":56,"./lib/_stream_readable.js":57,"./lib/_stream_transform.js":58,"./lib/_stream_writable.js":59,"./lib/internal/streams/end-of-stream.js":63,"./lib/internal/streams/pipeline.js":65,"dup":26}],69:[function(require,module,exports){
const BlockStream = require('block-stream2')
const stream = require('readable-stream')

class ChunkStoreWriteStream extends stream.Writable {
  constructor (store, chunkLength, opts = {}) {
    super(opts)

    if (!store || !store.put || !store.get) {
      throw new Error('First argument must be an abstract-chunk-store compliant store')
    }
    chunkLength = Number(chunkLength)
    if (!chunkLength) throw new Error('Second argument must be a chunk length')

    const zeroPadding = opts.zeroPadding === undefined ? false : opts.zeroPadding
    this._blockstream = new BlockStream(chunkLength, { ...opts, zeroPadding })
    this._outstandingPuts = 0
    this._storeMaxOutstandingPuts = opts.storeMaxOutstandingPuts || 16

    let index = 0
    const onData = chunk => {
      if (this.destroyed) return

      this._outstandingPuts += 1
      if (this._outstandingPuts >= this._storeMaxOutstandingPuts) {
        this._blockstream.pause()
      }
      store.put(index, chunk, (err) => {
        if (err) return this.destroy(err)
        this._outstandingPuts -= 1
        if (this._outstandingPuts < this._storeMaxOutstandingPuts) {
          this._blockstream.resume()
        }
        if (this._outstandingPuts === 0 && typeof this._finalCb === 'function') {
          this._finalCb(null)
          this._finalCb = null
        }
      })
      index += 1
    }

    this._blockstream
      .on('data', onData)
      .on('error', err => { this.destroy(err) })
  }

  _write (chunk, encoding, callback) {
    this._blockstream.write(chunk, encoding, callback)
  }

  _final (cb) {
    this._blockstream.end()
    this._blockstream.once('end', () => {
      if (this._outstandingPuts === 0) cb(null)
      else this._finalCb = cb
    })
  }

  destroy (err) {
    if (this.destroyed) return
    this.destroyed = true

    if (err) this.emit('error', err)
    this.emit('close')
  }
}

module.exports = ChunkStoreWriteStream

},{"block-stream2":32,"readable-stream":68}],70:[function(require,module,exports){
module.exports = function cpus () {
  var num = navigator.hardwareConcurrency || 1
  var cpus = []
  for (var i = 0; i < num; i++) {
    cpus.push({
      model: '',
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
    })
  }
  return cpus
}

},{}],71:[function(require,module,exports){
(function (global,Buffer){(function (){
/*! create-torrent. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
const bencode = require('bencode')
const BlockStream = require('block-stream2')
const calcPieceLength = require('piece-length')
const corePath = require('path')
const FileReadStream = require('filestream/read')
const isFile = require('is-file')
const junk = require('junk')
const MultiStream = require('multistream')
const once = require('once')
const parallel = require('run-parallel')
const queueMicrotask = require('queue-microtask')
const sha1 = require('simple-sha1')
const stream = require('readable-stream')

const getFiles = require('./get-files') // browser exclude

// TODO: When Node 10 support is dropped, replace this with Array.prototype.flat
function flat (arr1) {
  return arr1.reduce(
    (acc, val) => Array.isArray(val)
      ? acc.concat(flat(val))
      : acc.concat(val),
    []
  )
}

const announceList = [
  ['udp://tracker.leechers-paradise.org:6969'],
  ['udp://tracker.coppersurfer.tk:6969'],
  ['udp://tracker.opentrackr.org:1337'],
  ['udp://explodie.org:6969'],
  ['udp://tracker.empire-js.us:1337'],
  ['wss://tracker.btorrent.xyz'],
  ['wss://tracker.openwebtorrent.com']
]

/**
 * Create a torrent.
 * @param  {string|File|FileList|Buffer|Stream|Array.<string|File|Buffer|Stream>} input
 * @param  {Object} opts
 * @param  {string=} opts.name
 * @param  {Date=} opts.creationDate
 * @param  {string=} opts.comment
 * @param  {string=} opts.createdBy
 * @param  {boolean|number=} opts.private
 * @param  {number=} opts.pieceLength
 * @param  {Array.<Array.<string>>=} opts.announceList
 * @param  {Array.<string>=} opts.urlList
 * @param  {Object=} opts.info
 * @param  {Function} opts.onProgress
 * @param  {function} cb
 * @return {Buffer} buffer of .torrent file data
 */
function createTorrent (input, opts, cb) {
  if (typeof opts === 'function') [opts, cb] = [cb, opts]
  opts = opts ? Object.assign({}, opts) : {}

  _parseInput(input, opts, (err, files, singleFileTorrent) => {
    if (err) return cb(err)
    opts.singleFileTorrent = singleFileTorrent
    onFiles(files, opts, cb)
  })
}

function parseInput (input, opts, cb) {
  if (typeof opts === 'function') [opts, cb] = [cb, opts]
  opts = opts ? Object.assign({}, opts) : {}
  _parseInput(input, opts, cb)
}

/**
 * Parse input file and return file information.
 */
function _parseInput (input, opts, cb) {
  if (isFileList(input)) input = Array.from(input)
  if (!Array.isArray(input)) input = [input]

  if (input.length === 0) throw new Error('invalid input type')

  input.forEach(item => {
    if (item == null) throw new Error(`invalid input type: ${item}`)
  })

  // In Electron, use the true file path
  input = input.map(item => {
    if (isBlob(item) && typeof item.path === 'string' && typeof getFiles === 'function') return item.path
    return item
  })

  // If there's just one file, allow the name to be set by `opts.name`
  if (input.length === 1 && typeof input[0] !== 'string' && !input[0].name) input[0].name = opts.name

  let commonPrefix = null
  input.forEach((item, i) => {
    if (typeof item === 'string') {
      return
    }

    let path = item.fullPath || item.name
    if (!path) {
      path = `Unknown File ${i + 1}`
      item.unknownName = true
    }

    item.path = path.split('/')

    // Remove initial slash
    if (!item.path[0]) {
      item.path.shift()
    }

    if (item.path.length < 2) { // No real prefix
      commonPrefix = null
    } else if (i === 0 && input.length > 1) { // The first file has a prefix
      commonPrefix = item.path[0]
    } else if (item.path[0] !== commonPrefix) { // The prefix doesn't match
      commonPrefix = null
    }
  })

  const filterJunkFiles = opts.filterJunkFiles === undefined ? true : opts.filterJunkFiles
  if (filterJunkFiles) {
    // Remove junk files
    input = input.filter(item => {
      if (typeof item === 'string') {
        return true
      }
      return !isJunkPath(item.path)
    })
  }

  if (commonPrefix) {
    input.forEach(item => {
      const pathless = (Buffer.isBuffer(item) || isReadable(item)) && !item.path
      if (typeof item === 'string' || pathless) return
      item.path.shift()
    })
  }

  if (!opts.name && commonPrefix) {
    opts.name = commonPrefix
  }

  if (!opts.name) {
    // use first user-set file name
    input.some(item => {
      if (typeof item === 'string') {
        opts.name = corePath.basename(item)
        return true
      } else if (!item.unknownName) {
        opts.name = item.path[item.path.length - 1]
        return true
      }
      return false
    })
  }

  if (!opts.name) {
    opts.name = `Unnamed Torrent ${Date.now()}`
  }

  const numPaths = input.reduce((sum, item) => sum + Number(typeof item === 'string'), 0)

  let isSingleFileTorrent = (input.length === 1)

  if (input.length === 1 && typeof input[0] === 'string') {
    if (typeof getFiles !== 'function') {
      throw new Error('filesystem paths do not work in the browser')
    }
    // If there's a single path, verify it's a file before deciding this is a single
    // file torrent
    isFile(input[0], (err, pathIsFile) => {
      if (err) return cb(err)
      isSingleFileTorrent = pathIsFile
      processInput()
    })
  } else {
    queueMicrotask(processInput)
  }

  function processInput () {
    parallel(input.map(item => cb => {
      const file = {}

      if (isBlob(item)) {
        file.getStream = getBlobStream(item)
        file.length = item.size
      } else if (Buffer.isBuffer(item)) {
        file.getStream = getBufferStream(item)
        file.length = item.length
      } else if (isReadable(item)) {
        file.getStream = getStreamStream(item, file)
        file.length = 0
      } else if (typeof item === 'string') {
        if (typeof getFiles !== 'function') {
          throw new Error('filesystem paths do not work in the browser')
        }
        const keepRoot = numPaths > 1 || isSingleFileTorrent
        getFiles(item, keepRoot, cb)
        return // early return!
      } else {
        throw new Error('invalid input type')
      }
      file.path = item.path
      cb(null, file)
    }), (err, files) => {
      if (err) return cb(err)
      files = flat(files)
      cb(null, files, isSingleFileTorrent)
    })
  }
}

const MAX_OUTSTANDING_HASHES = 5

function getPieceList (files, pieceLength, estimatedTorrentLength, opts, cb) {
  cb = once(cb)
  const pieces = []
  let length = 0
  let hashedLength = 0

  const streams = files.map(file => file.getStream)

  let remainingHashes = 0
  let pieceNum = 0
  let ended = false

  const multistream = new MultiStream(streams)
  const blockstream = new BlockStream(pieceLength, { zeroPadding: false })

  multistream.on('error', onError)

  multistream
    .pipe(blockstream)
    .on('data', onData)
    .on('end', onEnd)
    .on('error', onError)

  function onData (chunk) {
    length += chunk.length

    const i = pieceNum
    sha1(chunk, hash => {
      pieces[i] = hash
      remainingHashes -= 1
      if (remainingHashes < MAX_OUTSTANDING_HASHES) {
        blockstream.resume()
      }
      hashedLength += chunk.length
      if (opts.onProgress) opts.onProgress(hashedLength, estimatedTorrentLength)
      maybeDone()
    })
    remainingHashes += 1
    if (remainingHashes >= MAX_OUTSTANDING_HASHES) {
      blockstream.pause()
    }
    pieceNum += 1
  }

  function onEnd () {
    ended = true
    maybeDone()
  }

  function onError (err) {
    cleanup()
    cb(err)
  }

  function cleanup () {
    multistream.removeListener('error', onError)
    blockstream.removeListener('data', onData)
    blockstream.removeListener('end', onEnd)
    blockstream.removeListener('error', onError)
  }

  function maybeDone () {
    if (ended && remainingHashes === 0) {
      cleanup()
      cb(null, Buffer.from(pieces.join(''), 'hex'), length)
    }
  }
}

function onFiles (files, opts, cb) {
  let announceList = opts.announceList

  if (!announceList) {
    if (typeof opts.announce === 'string') announceList = [[opts.announce]]
    else if (Array.isArray(opts.announce)) {
      announceList = opts.announce.map(u => [u])
    }
  }

  if (!announceList) announceList = []

  if (global.WEBTORRENT_ANNOUNCE) {
    if (typeof global.WEBTORRENT_ANNOUNCE === 'string') {
      announceList.push([[global.WEBTORRENT_ANNOUNCE]])
    } else if (Array.isArray(global.WEBTORRENT_ANNOUNCE)) {
      announceList = announceList.concat(global.WEBTORRENT_ANNOUNCE.map(u => [u]))
    }
  }

  // When no trackers specified, use some reasonable defaults
  if (opts.announce === undefined && opts.announceList === undefined) {
    announceList = announceList.concat(module.exports.announceList)
  }

  if (typeof opts.urlList === 'string') opts.urlList = [opts.urlList]

  const torrent = {
    info: {
      name: opts.name
    },
    'creation date': Math.ceil((Number(opts.creationDate) || Date.now()) / 1000),
    encoding: 'UTF-8'
  }

  if (announceList.length !== 0) {
    torrent.announce = announceList[0][0]
    torrent['announce-list'] = announceList
  }

  if (opts.comment !== undefined) torrent.comment = opts.comment

  if (opts.createdBy !== undefined) torrent['created by'] = opts.createdBy

  if (opts.private !== undefined) torrent.info.private = Number(opts.private)

  if (opts.info !== undefined) Object.assign(torrent.info, opts.info)

  // "ssl-cert" key is for SSL torrents, see:
  //   - http://blog.libtorrent.org/2012/01/bittorrent-over-ssl/
  //   - http://www.libtorrent.org/manual-ref.html#ssl-torrents
  //   - http://www.libtorrent.org/reference-Create_Torrents.html
  if (opts.sslCert !== undefined) torrent.info['ssl-cert'] = opts.sslCert

  if (opts.urlList !== undefined) torrent['url-list'] = opts.urlList

  const estimatedTorrentLength = files.reduce(sumLength, 0)
  const pieceLength = opts.pieceLength || calcPieceLength(estimatedTorrentLength)
  torrent.info['piece length'] = pieceLength

  getPieceList(
    files,
    pieceLength,
    estimatedTorrentLength,
    opts,
    (err, pieces, torrentLength) => {
      if (err) return cb(err)
      torrent.info.pieces = pieces

      files.forEach(file => {
        delete file.getStream
      })

      if (opts.singleFileTorrent) {
        torrent.info.length = torrentLength
      } else {
        torrent.info.files = files
      }

      cb(null, bencode.encode(torrent))
    }
  )
}

/**
 * Determine if a a file is junk based on its path
 * (defined as hidden OR recognized by the `junk` package)
 *
 * @param  {string} path
 * @return {boolean}
 */
function isJunkPath (path) {
  const filename = path[path.length - 1]
  return filename[0] === '.' && junk.is(filename)
}

/**
 * Accumulator to sum file lengths
 * @param  {number} sum
 * @param  {Object} file
 * @return {number}
 */
function sumLength (sum, file) {
  return sum + file.length
}

/**
 * Check if `obj` is a W3C `Blob` object (which `File` inherits from)
 * @param  {*} obj
 * @return {boolean}
 */
function isBlob (obj) {
  return typeof Blob !== 'undefined' && obj instanceof Blob
}

/**
 * Check if `obj` is a W3C `FileList` object
 * @param  {*} obj
 * @return {boolean}
 */
function isFileList (obj) {
  return typeof FileList !== 'undefined' && obj instanceof FileList
}

/**
 * Check if `obj` is a node Readable stream
 * @param  {*} obj
 * @return {boolean}
 */
function isReadable (obj) {
  return typeof obj === 'object' && obj != null && typeof obj.pipe === 'function'
}

/**
 * Convert a `File` to a lazy readable stream.
 * @param  {File|Blob} file
 * @return {function}
 */
function getBlobStream (file) {
  return () => new FileReadStream(file)
}

/**
 * Convert a `Buffer` to a lazy readable stream.
 * @param  {Buffer} buffer
 * @return {function}
 */
function getBufferStream (buffer) {
  return () => {
    const s = new stream.PassThrough()
    s.end(buffer)
    return s
  }
}

/**
 * Convert a readable stream to a lazy readable stream. Adds instrumentation to track
 * the number of bytes in the stream and set `file.length`.
 *
 * @param  {Stream} readable
 * @param  {Object} file
 * @return {function}
 */
function getStreamStream (readable, file) {
  return () => {
    const counter = new stream.Transform()
    counter._transform = function (buf, enc, done) {
      file.length += buf.length
      this.push(buf)
      done()
    }
    readable.pipe(counter)
    return counter
  }
}

module.exports = createTorrent
module.exports.parseInput = parseInput
module.exports.announceList = announceList
module.exports.isJunkPath = isJunkPath

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"./get-files":48,"bencode":7,"block-stream2":32,"buffer":52,"filestream/read":133,"is-file":48,"junk":142,"multistream":184,"once":201,"path":203,"piece-length":204,"queue-microtask":212,"readable-stream":86,"run-parallel":234,"simple-sha1":255}],72:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],73:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":75,"./_stream_writable":77,"_process":206,"dup":13,"inherits":138}],74:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":76,"dup":14,"inherits":138}],75:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":72,"./_stream_duplex":73,"./internal/streams/async_iterator":78,"./internal/streams/buffer_list":79,"./internal/streams/destroy":80,"./internal/streams/from":82,"./internal/streams/state":84,"./internal/streams/stream":85,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],76:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":72,"./_stream_duplex":73,"dup":16,"inherits":138}],77:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":72,"./_stream_duplex":73,"./internal/streams/destroy":80,"./internal/streams/state":84,"./internal/streams/stream":85,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],78:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":81,"_process":206,"dup":18}],79:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],80:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],81:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":72,"dup":21}],82:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],83:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":72,"./end-of-stream":81,"dup":23}],84:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":72,"dup":24}],85:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],86:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":73,"./lib/_stream_passthrough.js":74,"./lib/_stream_readable.js":75,"./lib/_stream_transform.js":76,"./lib/_stream_writable.js":77,"./lib/internal/streams/end-of-stream.js":81,"./lib/internal/streams/pipeline.js":83,"dup":26}],87:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = assign;

function assign(target, dirtyObject) {
  if (target == null) {
    throw new TypeError('assign requires that input parameter not be null or undefined');
  }

  dirtyObject = dirtyObject || {};

  for (var property in dirtyObject) {
    if (dirtyObject.hasOwnProperty(property)) {
      target[property] = dirtyObject[property];
    }
  }

  return target;
}

module.exports = exports.default;
},{}],88:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = cloneObject;

var _index = _interopRequireDefault(require("../assign/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function cloneObject(dirtyObject) {
  return (0, _index.default)({}, dirtyObject);
}

module.exports = exports.default;
},{"../assign/index.js":87}],89:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getTimezoneOffsetInMilliseconds;

/**
 * Google Chrome as of 67.0.3396.87 introduced timezones with offset that includes seconds.
 * They usually appear for dates that denote time before the timezones were introduced
 * (e.g. for 'Europe/Prague' timezone the offset is GMT+00:57:44 before 1 October 1891
 * and GMT+01:00:00 after that date)
 *
 * Date#getTimezoneOffset returns the offset in minutes and would return 57 for the example above,
 * which would lead to incorrect calculations.
 *
 * This function returns the timezone offset in milliseconds that takes seconds in account.
 */
function getTimezoneOffsetInMilliseconds(date) {
  var utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()));
  utcDate.setUTCFullYear(date.getFullYear());
  return date.getTime() - utcDate.getTime();
}

module.exports = exports.default;
},{}],90:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = requiredArgs;

function requiredArgs(required, args) {
  if (args.length < required) {
    throw new TypeError(required + ' argument' + (required > 1 ? 's' : '') + ' required, but only ' + args.length + ' present');
  }
}

module.exports = exports.default;
},{}],91:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = compareAsc;

var _index = _interopRequireDefault(require("../toDate/index.js"));

var _index2 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name compareAsc
 * @category Common Helpers
 * @summary Compare the two dates and return -1, 0 or 1.
 *
 * @description
 * Compare the two dates and return 1 if the first date is after the second,
 * -1 if the first date is before the second or 0 if dates are equal.
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} dateLeft - the first date to compare
 * @param {Date|Number} dateRight - the second date to compare
 * @returns {Number} the result of the comparison
 * @throws {TypeError} 2 arguments required
 *
 * @example
 * // Compare 11 February 1987 and 10 July 1989:
 * const result = compareAsc(new Date(1987, 1, 11), new Date(1989, 6, 10))
 * //=> -1
 *
 * @example
 * // Sort the array of dates:
 * const result = [
 *   new Date(1995, 6, 2),
 *   new Date(1987, 1, 11),
 *   new Date(1989, 6, 10)
 * ].sort(compareAsc)
 * //=> [
 * //   Wed Feb 11 1987 00:00:00,
 * //   Mon Jul 10 1989 00:00:00,
 * //   Sun Jul 02 1995 00:00:00
 * // ]
 */
function compareAsc(dirtyDateLeft, dirtyDateRight) {
  (0, _index2.default)(2, arguments);
  var dateLeft = (0, _index.default)(dirtyDateLeft);
  var dateRight = (0, _index.default)(dirtyDateRight);
  var diff = dateLeft.getTime() - dateRight.getTime();

  if (diff < 0) {
    return -1;
  } else if (diff > 0) {
    return 1; // Return 0 if diff is 0; return NaN if diff is NaN
  } else {
    return diff;
  }
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../toDate/index.js":110}],92:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = differenceInCalendarMonths;

var _index = _interopRequireDefault(require("../toDate/index.js"));

var _index2 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name differenceInCalendarMonths
 * @category Month Helpers
 * @summary Get the number of calendar months between the given dates.
 *
 * @description
 * Get the number of calendar months between the given dates.
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} dateLeft - the later date
 * @param {Date|Number} dateRight - the earlier date
 * @returns {Number} the number of calendar months
 * @throws {TypeError} 2 arguments required
 *
 * @example
 * // How many calendar months are between 31 January 2014 and 1 September 2014?
 * var result = differenceInCalendarMonths(
 *   new Date(2014, 8, 1),
 *   new Date(2014, 0, 31)
 * )
 * //=> 8
 */
function differenceInCalendarMonths(dirtyDateLeft, dirtyDateRight) {
  (0, _index2.default)(2, arguments);
  var dateLeft = (0, _index.default)(dirtyDateLeft);
  var dateRight = (0, _index.default)(dirtyDateRight);
  var yearDiff = dateLeft.getFullYear() - dateRight.getFullYear();
  var monthDiff = dateLeft.getMonth() - dateRight.getMonth();
  return yearDiff * 12 + monthDiff;
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../toDate/index.js":110}],93:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = differenceInMilliseconds;

var _index = _interopRequireDefault(require("../toDate/index.js"));

var _index2 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name differenceInMilliseconds
 * @category Millisecond Helpers
 * @summary Get the number of milliseconds between the given dates.
 *
 * @description
 * Get the number of milliseconds between the given dates.
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} dateLeft - the later date
 * @param {Date|Number} dateRight - the earlier date
 * @returns {Number} the number of milliseconds
 * @throws {TypeError} 2 arguments required
 *
 * @example
 * // How many milliseconds are between
 * // 2 July 2014 12:30:20.600 and 2 July 2014 12:30:21.700?
 * const result = differenceInMilliseconds(
 *   new Date(2014, 6, 2, 12, 30, 21, 700),
 *   new Date(2014, 6, 2, 12, 30, 20, 600)
 * )
 * //=> 1100
 */
function differenceInMilliseconds(dirtyDateLeft, dirtyDateRight) {
  (0, _index2.default)(2, arguments);
  var dateLeft = (0, _index.default)(dirtyDateLeft);
  var dateRight = (0, _index.default)(dirtyDateRight);
  return dateLeft.getTime() - dateRight.getTime();
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../toDate/index.js":110}],94:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = differenceInMonths;

var _index = _interopRequireDefault(require("../toDate/index.js"));

var _index2 = _interopRequireDefault(require("../differenceInCalendarMonths/index.js"));

var _index3 = _interopRequireDefault(require("../compareAsc/index.js"));

var _index4 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

var _index5 = _interopRequireDefault(require("../isLastDayOfMonth/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name differenceInMonths
 * @category Month Helpers
 * @summary Get the number of full months between the given dates.
 *
 * @description
 * Get the number of full months between the given dates.
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} dateLeft - the later date
 * @param {Date|Number} dateRight - the earlier date
 * @returns {Number} the number of full months
 * @throws {TypeError} 2 arguments required
 *
 * @example
 * // How many full months are between 31 January 2014 and 1 September 2014?
 * var result = differenceInMonths(new Date(2014, 8, 1), new Date(2014, 0, 31))
 * //=> 7
 */
function differenceInMonths(dirtyDateLeft, dirtyDateRight) {
  (0, _index4.default)(2, arguments);
  var dateLeft = (0, _index.default)(dirtyDateLeft);
  var dateRight = (0, _index.default)(dirtyDateRight);
  var sign = (0, _index3.default)(dateLeft, dateRight);
  var difference = Math.abs((0, _index2.default)(dateLeft, dateRight));
  var result; // Check for the difference of less than month

  if (difference < 1) {
    result = 0;
  } else {
    if (dateLeft.getMonth() === 1 && dateLeft.getDate() > 27) {
      // This will check if the date is end of Feb and assign a higher end of month date
      // to compare it with Jan
      dateLeft.setDate(30);
    }

    dateLeft.setMonth(dateLeft.getMonth() - sign * difference); // Math.abs(diff in full months - diff in calendar months) === 1 if last calendar month is not full
    // If so, result must be decreased by 1 in absolute value

    var isLastMonthNotFull = (0, _index3.default)(dateLeft, dateRight) === -sign; // Check for cases of one full calendar month

    if ((0, _index5.default)((0, _index.default)(dirtyDateLeft)) && difference === 1 && (0, _index3.default)(dirtyDateLeft, dateRight) === 1) {
      isLastMonthNotFull = false;
    }

    result = sign * (difference - Number(isLastMonthNotFull));
  } // Prevent negative zero


  return result === 0 ? 0 : result;
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../compareAsc/index.js":91,"../differenceInCalendarMonths/index.js":92,"../isLastDayOfMonth/index.js":99,"../toDate/index.js":110}],95:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = differenceInSeconds;

var _index = _interopRequireDefault(require("../differenceInMilliseconds/index.js"));

var _index2 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name differenceInSeconds
 * @category Second Helpers
 * @summary Get the number of seconds between the given dates.
 *
 * @description
 * Get the number of seconds between the given dates.
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} dateLeft - the later date
 * @param {Date|Number} dateRight - the earlier date
 * @returns {Number} the number of seconds
 * @throws {TypeError} 2 arguments required
 *
 * @example
 * // How many seconds are between
 * // 2 July 2014 12:30:07.999 and 2 July 2014 12:30:20.000?
 * const result = differenceInSeconds(
 *   new Date(2014, 6, 2, 12, 30, 20, 0),
 *   new Date(2014, 6, 2, 12, 30, 7, 999)
 * )
 * //=> 12
 */
function differenceInSeconds(dirtyDateLeft, dirtyDateRight) {
  (0, _index2.default)(2, arguments);
  var diff = (0, _index.default)(dirtyDateLeft, dirtyDateRight) / 1000;
  return diff > 0 ? Math.floor(diff) : Math.ceil(diff);
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../differenceInMilliseconds/index.js":93}],96:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = endOfDay;

var _index = _interopRequireDefault(require("../toDate/index.js"));

var _index2 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name endOfDay
 * @category Day Helpers
 * @summary Return the end of a day for the given date.
 *
 * @description
 * Return the end of a day for the given date.
 * The result will be in the local timezone.
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} date - the original date
 * @returns {Date} the end of a day
 * @throws {TypeError} 1 argument required
 *
 * @example
 * // The end of a day for 2 September 2014 11:55:00:
 * const result = endOfDay(new Date(2014, 8, 2, 11, 55, 0))
 * //=> Tue Sep 02 2014 23:59:59.999
 */
function endOfDay(dirtyDate) {
  (0, _index2.default)(1, arguments);
  var date = (0, _index.default)(dirtyDate);
  date.setHours(23, 59, 59, 999);
  return date;
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../toDate/index.js":110}],97:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = endOfMonth;

var _index = _interopRequireDefault(require("../toDate/index.js"));

var _index2 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name endOfMonth
 * @category Month Helpers
 * @summary Return the end of a month for the given date.
 *
 * @description
 * Return the end of a month for the given date.
 * The result will be in the local timezone.
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} date - the original date
 * @returns {Date} the end of a month
 * @throws {TypeError} 1 argument required
 *
 * @example
 * // The end of a month for 2 September 2014 11:55:00:
 * const result = endOfMonth(new Date(2014, 8, 2, 11, 55, 0))
 * //=> Tue Sep 30 2014 23:59:59.999
 */
function endOfMonth(dirtyDate) {
  (0, _index2.default)(1, arguments);
  var date = (0, _index.default)(dirtyDate);
  var month = date.getMonth();
  date.setFullYear(date.getFullYear(), month + 1, 0);
  date.setHours(23, 59, 59, 999);
  return date;
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../toDate/index.js":110}],98:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = formatDistance;

var _index = _interopRequireDefault(require("../compareAsc/index.js"));

var _index2 = _interopRequireDefault(require("../differenceInMonths/index.js"));

var _index3 = _interopRequireDefault(require("../differenceInSeconds/index.js"));

var _index4 = _interopRequireDefault(require("../locale/en-US/index.js"));

var _index5 = _interopRequireDefault(require("../toDate/index.js"));

var _index6 = _interopRequireDefault(require("../_lib/cloneObject/index.js"));

var _index7 = _interopRequireDefault(require("../_lib/getTimezoneOffsetInMilliseconds/index.js"));

var _index8 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var MINUTES_IN_DAY = 1440;
var MINUTES_IN_ALMOST_TWO_DAYS = 2520;
var MINUTES_IN_MONTH = 43200;
var MINUTES_IN_TWO_MONTHS = 86400;
/**
 * @name formatDistance
 * @category Common Helpers
 * @summary Return the distance between the given dates in words.
 *
 * @description
 * Return the distance between the given dates in words.
 *
 * | Distance between dates                                            | Result              |
 * |-------------------------------------------------------------------|---------------------|
 * | 0 ... 30 secs                                                     | less than a minute  |
 * | 30 secs ... 1 min 30 secs                                         | 1 minute            |
 * | 1 min 30 secs ... 44 mins 30 secs                                 | [2..44] minutes     |
 * | 44 mins ... 30 secs ... 89 mins 30 secs                           | about 1 hour        |
 * | 89 mins 30 secs ... 23 hrs 59 mins 30 secs                        | about [2..24] hours |
 * | 23 hrs 59 mins 30 secs ... 41 hrs 59 mins 30 secs                 | 1 day               |
 * | 41 hrs 59 mins 30 secs ... 29 days 23 hrs 59 mins 30 secs         | [2..30] days        |
 * | 29 days 23 hrs 59 mins 30 secs ... 44 days 23 hrs 59 mins 30 secs | about 1 month       |
 * | 44 days 23 hrs 59 mins 30 secs ... 59 days 23 hrs 59 mins 30 secs | about 2 months      |
 * | 59 days 23 hrs 59 mins 30 secs ... 1 yr                           | [2..12] months      |
 * | 1 yr ... 1 yr 3 months                                            | about 1 year        |
 * | 1 yr 3 months ... 1 yr 9 month s                                  | over 1 year         |
 * | 1 yr 9 months ... 2 yrs                                           | almost 2 years      |
 * | N yrs ... N yrs 3 months                                          | about N years       |
 * | N yrs 3 months ... N yrs 9 months                                 | over N years        |
 * | N yrs 9 months ... N+1 yrs                                        | almost N+1 years    |
 *
 * With `options.includeSeconds == true`:
 * | Distance between dates | Result               |
 * |------------------------|----------------------|
 * | 0 secs ... 5 secs      | less than 5 seconds  |
 * | 5 secs ... 10 secs     | less than 10 seconds |
 * | 10 secs ... 20 secs    | less than 20 seconds |
 * | 20 secs ... 40 secs    | half a minute        |
 * | 40 secs ... 60 secs    | less than a minute   |
 * | 60 secs ... 90 secs    | 1 minute             |
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * - The function was renamed from `distanceInWords ` to `formatDistance`
 *   to make its name consistent with `format` and `formatRelative`.
 *
 * - The order of arguments is swapped to make the function
 *   consistent with `differenceIn...` functions.
 *
 *   ```javascript
 *   // Before v2.0.0
 *
 *   distanceInWords(
 *     new Date(1986, 3, 4, 10, 32, 0),
 *     new Date(1986, 3, 4, 11, 32, 0),
 *     { addSuffix: true }
 *   ) //=> 'in about 1 hour'
 *
 *   // v2.0.0 onward
 *
 *   formatDistance(
 *     new Date(1986, 3, 4, 11, 32, 0),
 *     new Date(1986, 3, 4, 10, 32, 0),
 *     { addSuffix: true }
 *   ) //=> 'in about 1 hour'
 *   ```
 *
 * @param {Date|Number} date - the date
 * @param {Date|Number} baseDate - the date to compare with
 * @param {Object} [options] - an object with options.
 * @param {Boolean} [options.includeSeconds=false] - distances less than a minute are more detailed
 * @param {Boolean} [options.addSuffix=false] - result indicates if the second date is earlier or later than the first
 * @param {Locale} [options.locale=defaultLocale] - the locale object. See [Locale]{@link https://date-fns.org/docs/Locale}
 * @returns {String} the distance in words
 * @throws {TypeError} 2 arguments required
 * @throws {RangeError} `date` must not be Invalid Date
 * @throws {RangeError} `baseDate` must not be Invalid Date
 * @throws {RangeError} `options.locale` must contain `formatDistance` property
 *
 * @example
 * // What is the distance between 2 July 2014 and 1 January 2015?
 * const result = formatDistance(new Date(2014, 6, 2), new Date(2015, 0, 1))
 * //=> '6 months'
 *
 * @example
 * // What is the distance between 1 January 2015 00:00:15
 * // and 1 January 2015 00:00:00, including seconds?
 * const result = formatDistance(
 *   new Date(2015, 0, 1, 0, 0, 15),
 *   new Date(2015, 0, 1, 0, 0, 0),
 *   { includeSeconds: true }
 * )
 * //=> 'less than 20 seconds'
 *
 * @example
 * // What is the distance from 1 January 2016
 * // to 1 January 2015, with a suffix?
 * const result = formatDistance(new Date(2015, 0, 1), new Date(2016, 0, 1), {
 *   addSuffix: true
 * })
 * //=> 'about 1 year ago'
 *
 * @example
 * // What is the distance between 1 August 2016 and 1 January 2015 in Esperanto?
 * import { eoLocale } from 'date-fns/locale/eo'
 * const result = formatDistance(new Date(2016, 7, 1), new Date(2015, 0, 1), {
 *   locale: eoLocale
 * })
 * //=> 'pli ol 1 jaro'
 */

function formatDistance(dirtyDate, dirtyBaseDate) {
  var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  (0, _index8.default)(2, arguments);
  var locale = options.locale || _index4.default;

  if (!locale.formatDistance) {
    throw new RangeError('locale must contain formatDistance property');
  }

  var comparison = (0, _index.default)(dirtyDate, dirtyBaseDate);

  if (isNaN(comparison)) {
    throw new RangeError('Invalid time value');
  }

  var localizeOptions = (0, _index6.default)(options);
  localizeOptions.addSuffix = Boolean(options.addSuffix);
  localizeOptions.comparison = comparison;
  var dateLeft;
  var dateRight;

  if (comparison > 0) {
    dateLeft = (0, _index5.default)(dirtyBaseDate);
    dateRight = (0, _index5.default)(dirtyDate);
  } else {
    dateLeft = (0, _index5.default)(dirtyDate);
    dateRight = (0, _index5.default)(dirtyBaseDate);
  }

  var seconds = (0, _index3.default)(dateRight, dateLeft);
  var offsetInSeconds = ((0, _index7.default)(dateRight) - (0, _index7.default)(dateLeft)) / 1000;
  var minutes = Math.round((seconds - offsetInSeconds) / 60);
  var months; // 0 up to 2 mins

  if (minutes < 2) {
    if (options.includeSeconds) {
      if (seconds < 5) {
        return locale.formatDistance('lessThanXSeconds', 5, localizeOptions);
      } else if (seconds < 10) {
        return locale.formatDistance('lessThanXSeconds', 10, localizeOptions);
      } else if (seconds < 20) {
        return locale.formatDistance('lessThanXSeconds', 20, localizeOptions);
      } else if (seconds < 40) {
        return locale.formatDistance('halfAMinute', null, localizeOptions);
      } else if (seconds < 60) {
        return locale.formatDistance('lessThanXMinutes', 1, localizeOptions);
      } else {
        return locale.formatDistance('xMinutes', 1, localizeOptions);
      }
    } else {
      if (minutes === 0) {
        return locale.formatDistance('lessThanXMinutes', 1, localizeOptions);
      } else {
        return locale.formatDistance('xMinutes', minutes, localizeOptions);
      }
    } // 2 mins up to 0.75 hrs

  } else if (minutes < 45) {
    return locale.formatDistance('xMinutes', minutes, localizeOptions); // 0.75 hrs up to 1.5 hrs
  } else if (minutes < 90) {
    return locale.formatDistance('aboutXHours', 1, localizeOptions); // 1.5 hrs up to 24 hrs
  } else if (minutes < MINUTES_IN_DAY) {
    var hours = Math.round(minutes / 60);
    return locale.formatDistance('aboutXHours', hours, localizeOptions); // 1 day up to 1.75 days
  } else if (minutes < MINUTES_IN_ALMOST_TWO_DAYS) {
    return locale.formatDistance('xDays', 1, localizeOptions); // 1.75 days up to 30 days
  } else if (minutes < MINUTES_IN_MONTH) {
    var days = Math.round(minutes / MINUTES_IN_DAY);
    return locale.formatDistance('xDays', days, localizeOptions); // 1 month up to 2 months
  } else if (minutes < MINUTES_IN_TWO_MONTHS) {
    months = Math.round(minutes / MINUTES_IN_MONTH);
    return locale.formatDistance('aboutXMonths', months, localizeOptions);
  }

  months = (0, _index2.default)(dateRight, dateLeft); // 2 months up to 12 months

  if (months < 12) {
    var nearestMonth = Math.round(minutes / MINUTES_IN_MONTH);
    return locale.formatDistance('xMonths', nearestMonth, localizeOptions); // 1 year up to max Date
  } else {
    var monthsSinceStartOfYear = months % 12;
    var years = Math.floor(months / 12); // N years up to 1 years 3 months

    if (monthsSinceStartOfYear < 3) {
      return locale.formatDistance('aboutXYears', years, localizeOptions); // N years 3 months up to N years 9 months
    } else if (monthsSinceStartOfYear < 9) {
      return locale.formatDistance('overXYears', years, localizeOptions); // N years 9 months up to N year 12 months
    } else {
      return locale.formatDistance('almostXYears', years + 1, localizeOptions);
    }
  }
}

module.exports = exports.default;
},{"../_lib/cloneObject/index.js":88,"../_lib/getTimezoneOffsetInMilliseconds/index.js":89,"../_lib/requiredArgs/index.js":90,"../compareAsc/index.js":91,"../differenceInMonths/index.js":94,"../differenceInSeconds/index.js":95,"../locale/en-US/index.js":109,"../toDate/index.js":110}],99:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = isLastDayOfMonth;

var _index = _interopRequireDefault(require("../toDate/index.js"));

var _index2 = _interopRequireDefault(require("../endOfDay/index.js"));

var _index3 = _interopRequireDefault(require("../endOfMonth/index.js"));

var _index4 = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name isLastDayOfMonth
 * @category Month Helpers
 * @summary Is the given date the last day of a month?
 *
 * @description
 * Is the given date the last day of a month?
 *
 * ### v2.0.0 breaking changes:
 *
 * - [Changes that are common for the whole library](https://github.com/date-fns/date-fns/blob/master/docs/upgradeGuide.md#Common-Changes).
 *
 * @param {Date|Number} date - the date to check
 * @returns {Boolean} the date is the last day of a month
 * @throws {TypeError} 1 argument required
 *
 * @example
 * // Is 28 February 2014 the last day of a month?
 * var result = isLastDayOfMonth(new Date(2014, 1, 28))
 * //=> true
 */
function isLastDayOfMonth(dirtyDate) {
  (0, _index4.default)(1, arguments);
  var date = (0, _index.default)(dirtyDate);
  return (0, _index2.default)(date).getTime() === (0, _index3.default)(date).getTime();
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90,"../endOfDay/index.js":96,"../endOfMonth/index.js":97,"../toDate/index.js":110}],100:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = buildFormatLongFn;

function buildFormatLongFn(args) {
  return function (dirtyOptions) {
    var options = dirtyOptions || {};
    var width = options.width ? String(options.width) : args.defaultWidth;
    var format = args.formats[width] || args.formats[args.defaultWidth];
    return format;
  };
}

module.exports = exports.default;
},{}],101:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = buildLocalizeFn;

function buildLocalizeFn(args) {
  return function (dirtyIndex, dirtyOptions) {
    var options = dirtyOptions || {};
    var context = options.context ? String(options.context) : 'standalone';
    var valuesArray;

    if (context === 'formatting' && args.formattingValues) {
      var defaultWidth = args.defaultFormattingWidth || args.defaultWidth;
      var width = options.width ? String(options.width) : defaultWidth;
      valuesArray = args.formattingValues[width] || args.formattingValues[defaultWidth];
    } else {
      var _defaultWidth = args.defaultWidth;

      var _width = options.width ? String(options.width) : args.defaultWidth;

      valuesArray = args.values[_width] || args.values[_defaultWidth];
    }

    var index = args.argumentCallback ? args.argumentCallback(dirtyIndex) : dirtyIndex;
    return valuesArray[index];
  };
}

module.exports = exports.default;
},{}],102:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = buildMatchFn;

function buildMatchFn(args) {
  return function (dirtyString, dirtyOptions) {
    var string = String(dirtyString);
    var options = dirtyOptions || {};
    var width = options.width;
    var matchPattern = width && args.matchPatterns[width] || args.matchPatterns[args.defaultMatchWidth];
    var matchResult = string.match(matchPattern);

    if (!matchResult) {
      return null;
    }

    var matchedString = matchResult[0];
    var parsePatterns = width && args.parsePatterns[width] || args.parsePatterns[args.defaultParseWidth];
    var value;

    if (Object.prototype.toString.call(parsePatterns) === '[object Array]') {
      value = findIndex(parsePatterns, function (pattern) {
        return pattern.test(matchedString);
      });
    } else {
      value = findKey(parsePatterns, function (pattern) {
        return pattern.test(matchedString);
      });
    }

    value = args.valueCallback ? args.valueCallback(value) : value;
    value = options.valueCallback ? options.valueCallback(value) : value;
    return {
      value: value,
      rest: string.slice(matchedString.length)
    };
  };
}

function findKey(object, predicate) {
  for (var key in object) {
    if (object.hasOwnProperty(key) && predicate(object[key])) {
      return key;
    }
  }
}

function findIndex(array, predicate) {
  for (var key = 0; key < array.length; key++) {
    if (predicate(array[key])) {
      return key;
    }
  }
}

module.exports = exports.default;
},{}],103:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = buildMatchPatternFn;

function buildMatchPatternFn(args) {
  return function (dirtyString, dirtyOptions) {
    var string = String(dirtyString);
    var options = dirtyOptions || {};
    var matchResult = string.match(args.matchPattern);

    if (!matchResult) {
      return null;
    }

    var matchedString = matchResult[0];
    var parseResult = string.match(args.parsePattern);

    if (!parseResult) {
      return null;
    }

    var value = args.valueCallback ? args.valueCallback(parseResult[0]) : parseResult[0];
    value = options.valueCallback ? options.valueCallback(value) : value;
    return {
      value: value,
      rest: string.slice(matchedString.length)
    };
  };
}

module.exports = exports.default;
},{}],104:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = formatDistance;
var formatDistanceLocale = {
  lessThanXSeconds: {
    one: 'less than a second',
    other: 'less than {{count}} seconds'
  },
  xSeconds: {
    one: '1 second',
    other: '{{count}} seconds'
  },
  halfAMinute: 'half a minute',
  lessThanXMinutes: {
    one: 'less than a minute',
    other: 'less than {{count}} minutes'
  },
  xMinutes: {
    one: '1 minute',
    other: '{{count}} minutes'
  },
  aboutXHours: {
    one: 'about 1 hour',
    other: 'about {{count}} hours'
  },
  xHours: {
    one: '1 hour',
    other: '{{count}} hours'
  },
  xDays: {
    one: '1 day',
    other: '{{count}} days'
  },
  aboutXWeeks: {
    one: 'about 1 week',
    other: 'about {{count}} weeks'
  },
  xWeeks: {
    one: '1 week',
    other: '{{count}} weeks'
  },
  aboutXMonths: {
    one: 'about 1 month',
    other: 'about {{count}} months'
  },
  xMonths: {
    one: '1 month',
    other: '{{count}} months'
  },
  aboutXYears: {
    one: 'about 1 year',
    other: 'about {{count}} years'
  },
  xYears: {
    one: '1 year',
    other: '{{count}} years'
  },
  overXYears: {
    one: 'over 1 year',
    other: 'over {{count}} years'
  },
  almostXYears: {
    one: 'almost 1 year',
    other: 'almost {{count}} years'
  }
};

function formatDistance(token, count, options) {
  options = options || {};
  var result;

  if (typeof formatDistanceLocale[token] === 'string') {
    result = formatDistanceLocale[token];
  } else if (count === 1) {
    result = formatDistanceLocale[token].one;
  } else {
    result = formatDistanceLocale[token].other.replace('{{count}}', count);
  }

  if (options.addSuffix) {
    if (options.comparison > 0) {
      return 'in ' + result;
    } else {
      return result + ' ago';
    }
  }

  return result;
}

module.exports = exports.default;
},{}],105:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _index = _interopRequireDefault(require("../../../_lib/buildFormatLongFn/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var dateFormats = {
  full: 'EEEE, MMMM do, y',
  long: 'MMMM do, y',
  medium: 'MMM d, y',
  short: 'MM/dd/yyyy'
};
var timeFormats = {
  full: 'h:mm:ss a zzzz',
  long: 'h:mm:ss a z',
  medium: 'h:mm:ss a',
  short: 'h:mm a'
};
var dateTimeFormats = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: '{{date}}, {{time}}',
  short: '{{date}}, {{time}}'
};
var formatLong = {
  date: (0, _index.default)({
    formats: dateFormats,
    defaultWidth: 'full'
  }),
  time: (0, _index.default)({
    formats: timeFormats,
    defaultWidth: 'full'
  }),
  dateTime: (0, _index.default)({
    formats: dateTimeFormats,
    defaultWidth: 'full'
  })
};
var _default = formatLong;
exports.default = _default;
module.exports = exports.default;
},{"../../../_lib/buildFormatLongFn/index.js":100}],106:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = formatRelative;
var formatRelativeLocale = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: 'P'
};

function formatRelative(token, _date, _baseDate, _options) {
  return formatRelativeLocale[token];
}

module.exports = exports.default;
},{}],107:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _index = _interopRequireDefault(require("../../../_lib/buildLocalizeFn/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var eraValues = {
  narrow: ['B', 'A'],
  abbreviated: ['BC', 'AD'],
  wide: ['Before Christ', 'Anno Domini']
};
var quarterValues = {
  narrow: ['1', '2', '3', '4'],
  abbreviated: ['Q1', 'Q2', 'Q3', 'Q4'],
  wide: ['1st quarter', '2nd quarter', '3rd quarter', '4th quarter'] // Note: in English, the names of days of the week and months are capitalized.
  // If you are making a new locale based on this one, check if the same is true for the language you're working on.
  // Generally, formatted dates should look like they are in the middle of a sentence,
  // e.g. in Spanish language the weekdays and months should be in the lowercase.

};
var monthValues = {
  narrow: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'],
  abbreviated: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  wide: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};
var dayValues = {
  narrow: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  short: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  abbreviated: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  wide: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};
var dayPeriodValues = {
  narrow: {
    am: 'a',
    pm: 'p',
    midnight: 'mi',
    noon: 'n',
    morning: 'morning',
    afternoon: 'afternoon',
    evening: 'evening',
    night: 'night'
  },
  abbreviated: {
    am: 'AM',
    pm: 'PM',
    midnight: 'midnight',
    noon: 'noon',
    morning: 'morning',
    afternoon: 'afternoon',
    evening: 'evening',
    night: 'night'
  },
  wide: {
    am: 'a.m.',
    pm: 'p.m.',
    midnight: 'midnight',
    noon: 'noon',
    morning: 'morning',
    afternoon: 'afternoon',
    evening: 'evening',
    night: 'night'
  }
};
var formattingDayPeriodValues = {
  narrow: {
    am: 'a',
    pm: 'p',
    midnight: 'mi',
    noon: 'n',
    morning: 'in the morning',
    afternoon: 'in the afternoon',
    evening: 'in the evening',
    night: 'at night'
  },
  abbreviated: {
    am: 'AM',
    pm: 'PM',
    midnight: 'midnight',
    noon: 'noon',
    morning: 'in the morning',
    afternoon: 'in the afternoon',
    evening: 'in the evening',
    night: 'at night'
  },
  wide: {
    am: 'a.m.',
    pm: 'p.m.',
    midnight: 'midnight',
    noon: 'noon',
    morning: 'in the morning',
    afternoon: 'in the afternoon',
    evening: 'in the evening',
    night: 'at night'
  }
};

function ordinalNumber(dirtyNumber, _dirtyOptions) {
  var number = Number(dirtyNumber); // If ordinal numbers depend on context, for example,
  // if they are different for different grammatical genders,
  // use `options.unit`:
  //
  //   var options = dirtyOptions || {}
  //   var unit = String(options.unit)
  //
  // where `unit` can be 'year', 'quarter', 'month', 'week', 'date', 'dayOfYear',
  // 'day', 'hour', 'minute', 'second'

  var rem100 = number % 100;

  if (rem100 > 20 || rem100 < 10) {
    switch (rem100 % 10) {
      case 1:
        return number + 'st';

      case 2:
        return number + 'nd';

      case 3:
        return number + 'rd';
    }
  }

  return number + 'th';
}

var localize = {
  ordinalNumber: ordinalNumber,
  era: (0, _index.default)({
    values: eraValues,
    defaultWidth: 'wide'
  }),
  quarter: (0, _index.default)({
    values: quarterValues,
    defaultWidth: 'wide',
    argumentCallback: function (quarter) {
      return Number(quarter) - 1;
    }
  }),
  month: (0, _index.default)({
    values: monthValues,
    defaultWidth: 'wide'
  }),
  day: (0, _index.default)({
    values: dayValues,
    defaultWidth: 'wide'
  }),
  dayPeriod: (0, _index.default)({
    values: dayPeriodValues,
    defaultWidth: 'wide',
    formattingValues: formattingDayPeriodValues,
    defaultFormattingWidth: 'wide'
  })
};
var _default = localize;
exports.default = _default;
module.exports = exports.default;
},{"../../../_lib/buildLocalizeFn/index.js":101}],108:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _index = _interopRequireDefault(require("../../../_lib/buildMatchPatternFn/index.js"));

var _index2 = _interopRequireDefault(require("../../../_lib/buildMatchFn/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var matchOrdinalNumberPattern = /^(\d+)(th|st|nd|rd)?/i;
var parseOrdinalNumberPattern = /\d+/i;
var matchEraPatterns = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
};
var parseEraPatterns = {
  any: [/^b/i, /^(a|c)/i]
};
var matchQuarterPatterns = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
};
var parseQuarterPatterns = {
  any: [/1/i, /2/i, /3/i, /4/i]
};
var matchMonthPatterns = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
};
var parseMonthPatterns = {
  narrow: [/^j/i, /^f/i, /^m/i, /^a/i, /^m/i, /^j/i, /^j/i, /^a/i, /^s/i, /^o/i, /^n/i, /^d/i],
  any: [/^ja/i, /^f/i, /^mar/i, /^ap/i, /^may/i, /^jun/i, /^jul/i, /^au/i, /^s/i, /^o/i, /^n/i, /^d/i]
};
var matchDayPatterns = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
};
var parseDayPatterns = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
};
var matchDayPeriodPatterns = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
};
var parseDayPeriodPatterns = {
  any: {
    am: /^a/i,
    pm: /^p/i,
    midnight: /^mi/i,
    noon: /^no/i,
    morning: /morning/i,
    afternoon: /afternoon/i,
    evening: /evening/i,
    night: /night/i
  }
};
var match = {
  ordinalNumber: (0, _index.default)({
    matchPattern: matchOrdinalNumberPattern,
    parsePattern: parseOrdinalNumberPattern,
    valueCallback: function (value) {
      return parseInt(value, 10);
    }
  }),
  era: (0, _index2.default)({
    matchPatterns: matchEraPatterns,
    defaultMatchWidth: 'wide',
    parsePatterns: parseEraPatterns,
    defaultParseWidth: 'any'
  }),
  quarter: (0, _index2.default)({
    matchPatterns: matchQuarterPatterns,
    defaultMatchWidth: 'wide',
    parsePatterns: parseQuarterPatterns,
    defaultParseWidth: 'any',
    valueCallback: function (index) {
      return index + 1;
    }
  }),
  month: (0, _index2.default)({
    matchPatterns: matchMonthPatterns,
    defaultMatchWidth: 'wide',
    parsePatterns: parseMonthPatterns,
    defaultParseWidth: 'any'
  }),
  day: (0, _index2.default)({
    matchPatterns: matchDayPatterns,
    defaultMatchWidth: 'wide',
    parsePatterns: parseDayPatterns,
    defaultParseWidth: 'any'
  }),
  dayPeriod: (0, _index2.default)({
    matchPatterns: matchDayPeriodPatterns,
    defaultMatchWidth: 'any',
    parsePatterns: parseDayPeriodPatterns,
    defaultParseWidth: 'any'
  })
};
var _default = match;
exports.default = _default;
module.exports = exports.default;
},{"../../../_lib/buildMatchFn/index.js":102,"../../../_lib/buildMatchPatternFn/index.js":103}],109:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _index = _interopRequireDefault(require("./_lib/formatDistance/index.js"));

var _index2 = _interopRequireDefault(require("./_lib/formatLong/index.js"));

var _index3 = _interopRequireDefault(require("./_lib/formatRelative/index.js"));

var _index4 = _interopRequireDefault(require("./_lib/localize/index.js"));

var _index5 = _interopRequireDefault(require("./_lib/match/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @type {Locale}
 * @category Locales
 * @summary English locale (United States).
 * @language English
 * @iso-639-2 eng
 * @author Sasha Koss [@kossnocorp]{@link https://github.com/kossnocorp}
 * @author Lesha Koss [@leshakoss]{@link https://github.com/leshakoss}
 */
var locale = {
  code: 'en-US',
  formatDistance: _index.default,
  formatLong: _index2.default,
  formatRelative: _index3.default,
  localize: _index4.default,
  match: _index5.default,
  options: {
    weekStartsOn: 0
    /* Sunday */
    ,
    firstWeekContainsDate: 1
  }
};
var _default = locale;
exports.default = _default;
module.exports = exports.default;
},{"./_lib/formatDistance/index.js":104,"./_lib/formatLong/index.js":105,"./_lib/formatRelative/index.js":106,"./_lib/localize/index.js":107,"./_lib/match/index.js":108}],110:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = toDate;

var _index = _interopRequireDefault(require("../_lib/requiredArgs/index.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @name toDate
 * @category Common Helpers
 * @summary Convert the given argument to an instance of Date.
 *
 * @description
 * Convert the given argument to an instance of Date.
 *
 * If the argument is an instance of Date, the function returns its clone.
 *
 * If the argument is a number, it is treated as a timestamp.
 *
 * If the argument is none of the above, the function returns Invalid Date.
 *
 * **Note**: *all* Date arguments passed to any *date-fns* function is processed by `toDate`.
 *
 * @param {Date|Number} argument - the value to convert
 * @returns {Date} the parsed date in the local time zone
 * @throws {TypeError} 1 argument required
 *
 * @example
 * // Clone the date:
 * const result = toDate(new Date(2014, 1, 11, 11, 30, 30))
 * //=> Tue Feb 11 2014 11:30:30
 *
 * @example
 * // Convert the timestamp to date:
 * const result = toDate(1392098430000)
 * //=> Tue Feb 11 2014 11:30:30
 */
function toDate(argument) {
  (0, _index.default)(1, arguments);
  var argStr = Object.prototype.toString.call(argument); // Clone the date

  if (argument instanceof Date || typeof argument === 'object' && argStr === '[object Date]') {
    // Prevent the date to lose the milliseconds when passed to new Date() in IE10
    return new Date(argument.getTime());
  } else if (typeof argument === 'number' || argStr === '[object Number]') {
    return new Date(argument);
  } else {
    if ((typeof argument === 'string' || argStr === '[object String]') && typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn("Starting with v2.0.0-beta.1 date-fns doesn't accept strings as date arguments. Please use `parseISO` to parse strings. See: https://git.io/fjule"); // eslint-disable-next-line no-console

      console.warn(new Error().stack);
    }

    return new Date(NaN);
  }
}

module.exports = exports.default;
},{"../_lib/requiredArgs/index.js":90}],111:[function(require,module,exports){
(function (process){(function (){
/* eslint-env browser */

/**
 * This is the web browser implementation of `debug()`.
 */

exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = localstorage();
exports.destroy = (() => {
	let warned = false;

	return () => {
		if (!warned) {
			warned = true;
			console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
		}
	};
})();

/**
 * Colors.
 */

exports.colors = [
	'#0000CC',
	'#0000FF',
	'#0033CC',
	'#0033FF',
	'#0066CC',
	'#0066FF',
	'#0099CC',
	'#0099FF',
	'#00CC00',
	'#00CC33',
	'#00CC66',
	'#00CC99',
	'#00CCCC',
	'#00CCFF',
	'#3300CC',
	'#3300FF',
	'#3333CC',
	'#3333FF',
	'#3366CC',
	'#3366FF',
	'#3399CC',
	'#3399FF',
	'#33CC00',
	'#33CC33',
	'#33CC66',
	'#33CC99',
	'#33CCCC',
	'#33CCFF',
	'#6600CC',
	'#6600FF',
	'#6633CC',
	'#6633FF',
	'#66CC00',
	'#66CC33',
	'#9900CC',
	'#9900FF',
	'#9933CC',
	'#9933FF',
	'#99CC00',
	'#99CC33',
	'#CC0000',
	'#CC0033',
	'#CC0066',
	'#CC0099',
	'#CC00CC',
	'#CC00FF',
	'#CC3300',
	'#CC3333',
	'#CC3366',
	'#CC3399',
	'#CC33CC',
	'#CC33FF',
	'#CC6600',
	'#CC6633',
	'#CC9900',
	'#CC9933',
	'#CCCC00',
	'#CCCC33',
	'#FF0000',
	'#FF0033',
	'#FF0066',
	'#FF0099',
	'#FF00CC',
	'#FF00FF',
	'#FF3300',
	'#FF3333',
	'#FF3366',
	'#FF3399',
	'#FF33CC',
	'#FF33FF',
	'#FF6600',
	'#FF6633',
	'#FF9900',
	'#FF9933',
	'#FFCC00',
	'#FFCC33'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

// eslint-disable-next-line complexity
function useColors() {
	// NB: In an Electron preload script, document will be defined but not fully
	// initialized. Since we know we're in Chrome, we'll just detect this case
	// explicitly
	if (typeof window !== 'undefined' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
		return true;
	}

	// Internet Explorer and Edge do not support colors.
	if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
		return false;
	}

	// Is webkit? http://stackoverflow.com/a/16459606/376773
	// document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
	return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
		// Is firebug? http://stackoverflow.com/a/398120/376773
		(typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
		// Is firefox >= v31?
		// https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
		// Double check webkit in userAgent just in case we are in a worker
		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
}

/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs(args) {
	args[0] = (this.useColors ? '%c' : '') +
		this.namespace +
		(this.useColors ? ' %c' : ' ') +
		args[0] +
		(this.useColors ? '%c ' : ' ') +
		'+' + module.exports.humanize(this.diff);

	if (!this.useColors) {
		return;
	}

	const c = 'color: ' + this.color;
	args.splice(1, 0, c, 'color: inherit');

	// The final "%c" is somewhat tricky, because there could be other
	// arguments passed either before or after the %c, so we need to
	// figure out the correct index to insert the CSS into
	let index = 0;
	let lastC = 0;
	args[0].replace(/%[a-zA-Z%]/g, match => {
		if (match === '%%') {
			return;
		}
		index++;
		if (match === '%c') {
			// We only are interested in the *last* %c
			// (the user may have provided their own)
			lastC = index;
		}
	});

	args.splice(lastC, 0, c);
}

/**
 * Invokes `console.debug()` when available.
 * No-op when `console.debug` is not a "function".
 * If `console.debug` is not available, falls back
 * to `console.log`.
 *
 * @api public
 */
exports.log = console.debug || console.log || (() => {});

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */
function save(namespaces) {
	try {
		if (namespaces) {
			exports.storage.setItem('debug', namespaces);
		} else {
			exports.storage.removeItem('debug');
		}
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */
function load() {
	let r;
	try {
		r = exports.storage.getItem('debug');
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}

	// If debug isn't set in LS, and we're in Electron, try to load $DEBUG
	if (!r && typeof process !== 'undefined' && 'env' in process) {
		r = process.env.DEBUG;
	}

	return r;
}

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage() {
	try {
		// TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
		// The Browser also has localStorage in the global context.
		return localStorage;
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}
}

module.exports = require('./common')(exports);

const {formatters} = module.exports;

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

formatters.j = function (v) {
	try {
		return JSON.stringify(v);
	} catch (error) {
		return '[UnexpectedJSONParseError]: ' + error.message;
	}
};

}).call(this)}).call(this,require('_process'))
},{"./common":112,"_process":206}],112:[function(require,module,exports){

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 */

function setup(env) {
	createDebug.debug = createDebug;
	createDebug.default = createDebug;
	createDebug.coerce = coerce;
	createDebug.disable = disable;
	createDebug.enable = enable;
	createDebug.enabled = enabled;
	createDebug.humanize = require('ms');
	createDebug.destroy = destroy;

	Object.keys(env).forEach(key => {
		createDebug[key] = env[key];
	});

	/**
	* The currently active debug mode names, and names to skip.
	*/

	createDebug.names = [];
	createDebug.skips = [];

	/**
	* Map of special "%n" handling functions, for the debug "format" argument.
	*
	* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
	*/
	createDebug.formatters = {};

	/**
	* Selects a color for a debug namespace
	* @param {String} namespace The namespace string for the for the debug instance to be colored
	* @return {Number|String} An ANSI color code for the given namespace
	* @api private
	*/
	function selectColor(namespace) {
		let hash = 0;

		for (let i = 0; i < namespace.length; i++) {
			hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
			hash |= 0; // Convert to 32bit integer
		}

		return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
	}
	createDebug.selectColor = selectColor;

	/**
	* Create a debugger with the given `namespace`.
	*
	* @param {String} namespace
	* @return {Function}
	* @api public
	*/
	function createDebug(namespace) {
		let prevTime;
		let enableOverride = null;

		function debug(...args) {
			// Disabled?
			if (!debug.enabled) {
				return;
			}

			const self = debug;

			// Set `diff` timestamp
			const curr = Number(new Date());
			const ms = curr - (prevTime || curr);
			self.diff = ms;
			self.prev = prevTime;
			self.curr = curr;
			prevTime = curr;

			args[0] = createDebug.coerce(args[0]);

			if (typeof args[0] !== 'string') {
				// Anything else let's inspect with %O
				args.unshift('%O');
			}

			// Apply any `formatters` transformations
			let index = 0;
			args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
				// If we encounter an escaped % then don't increase the array index
				if (match === '%%') {
					return '%';
				}
				index++;
				const formatter = createDebug.formatters[format];
				if (typeof formatter === 'function') {
					const val = args[index];
					match = formatter.call(self, val);

					// Now we need to remove `args[index]` since it's inlined in the `format`
					args.splice(index, 1);
					index--;
				}
				return match;
			});

			// Apply env-specific formatting (colors, etc.)
			createDebug.formatArgs.call(self, args);

			const logFn = self.log || createDebug.log;
			logFn.apply(self, args);
		}

		debug.namespace = namespace;
		debug.useColors = createDebug.useColors();
		debug.color = createDebug.selectColor(namespace);
		debug.extend = extend;
		debug.destroy = createDebug.destroy; // XXX Temporary. Will be removed in the next major release.

		Object.defineProperty(debug, 'enabled', {
			enumerable: true,
			configurable: false,
			get: () => enableOverride === null ? createDebug.enabled(namespace) : enableOverride,
			set: v => {
				enableOverride = v;
			}
		});

		// Env-specific initialization logic for debug instances
		if (typeof createDebug.init === 'function') {
			createDebug.init(debug);
		}

		return debug;
	}

	function extend(namespace, delimiter) {
		const newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
		newDebug.log = this.log;
		return newDebug;
	}

	/**
	* Enables a debug mode by namespaces. This can include modes
	* separated by a colon and wildcards.
	*
	* @param {String} namespaces
	* @api public
	*/
	function enable(namespaces) {
		createDebug.save(namespaces);

		createDebug.names = [];
		createDebug.skips = [];

		let i;
		const split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
		const len = split.length;

		for (i = 0; i < len; i++) {
			if (!split[i]) {
				// ignore empty strings
				continue;
			}

			namespaces = split[i].replace(/\*/g, '.*?');

			if (namespaces[0] === '-') {
				createDebug.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
			} else {
				createDebug.names.push(new RegExp('^' + namespaces + '$'));
			}
		}
	}

	/**
	* Disable debug output.
	*
	* @return {String} namespaces
	* @api public
	*/
	function disable() {
		const namespaces = [
			...createDebug.names.map(toNamespace),
			...createDebug.skips.map(toNamespace).map(namespace => '-' + namespace)
		].join(',');
		createDebug.enable('');
		return namespaces;
	}

	/**
	* Returns true if the given mode name is enabled, false otherwise.
	*
	* @param {String} name
	* @return {Boolean}
	* @api public
	*/
	function enabled(name) {
		if (name[name.length - 1] === '*') {
			return true;
		}

		let i;
		let len;

		for (i = 0, len = createDebug.skips.length; i < len; i++) {
			if (createDebug.skips[i].test(name)) {
				return false;
			}
		}

		for (i = 0, len = createDebug.names.length; i < len; i++) {
			if (createDebug.names[i].test(name)) {
				return true;
			}
		}

		return false;
	}

	/**
	* Convert regexp to namespace
	*
	* @param {RegExp} regxep
	* @return {String} namespace
	* @api private
	*/
	function toNamespace(regexp) {
		return regexp.toString()
			.substring(2, regexp.toString().length - 2)
			.replace(/\.\*\?$/, '*');
	}

	/**
	* Coerce `val`.
	*
	* @param {Mixed} val
	* @return {Mixed}
	* @api private
	*/
	function coerce(val) {
		if (val instanceof Error) {
			return val.stack || val.message;
		}
		return val;
	}

	/**
	* XXX DO NOT USE. This is a temporary stub function.
	* XXX It WILL be removed in the next major release.
	*/
	function destroy() {
		console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
	}

	createDebug.enable(createDebug.load());

	return createDebug;
}

module.exports = setup;

},{"ms":183}],113:[function(require,module,exports){
/*! drag-drop. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = dragDrop

const parallel = require('run-parallel')

function dragDrop (elem, listeners) {
  if (typeof elem === 'string') {
    const selector = elem
    elem = window.document.querySelector(elem)
    if (!elem) {
      throw new Error(`"${selector}" does not match any HTML elements`)
    }
  }

  if (!elem) {
    throw new Error(`"${elem}" is not a valid HTML element`)
  }

  if (typeof listeners === 'function') {
    listeners = { onDrop: listeners }
  }

  elem.addEventListener('dragenter', onDragEnter, false)
  elem.addEventListener('dragover', onDragOver, false)
  elem.addEventListener('dragleave', onDragLeave, false)
  elem.addEventListener('drop', onDrop, false)

  let isEntered = false
  let numIgnoredEnters = 0

  // Function to remove drag-drop listeners
  return function cleanup () {
    removeDragClass()
    elem.removeEventListener('dragenter', onDragEnter, false)
    elem.removeEventListener('dragover', onDragOver, false)
    elem.removeEventListener('dragleave', onDragLeave, false)
    elem.removeEventListener('drop', onDrop, false)
  }

  function isEventHandleable (event) {
    if (event.dataTransfer.items || event.dataTransfer.types) {
      // Only add "drag" class when `items` contains items that are able to be
      // handled by the registered listeners (files vs. text)
      const items = Array.from(event.dataTransfer.items)
      const types = Array.from(event.dataTransfer.types)

      let fileItems
      let textItems
      if (items.length) {
        fileItems = items.filter(item => { return item.kind === 'file' })
        textItems = items.filter(item => { return item.kind === 'string' })
      } else if (types.length) {
        // event.dataTransfer.items is empty during 'dragover' in Safari, so use
        // event.dataTransfer.types as a fallback
        fileItems = types.filter(item => item === 'Files')
        textItems = types.filter(item => item.startsWith('text/'))
      } else {
        return false
      }

      if (fileItems.length === 0 && !listeners.onDropText) return false
      if (textItems.length === 0 && !listeners.onDrop) return false
      if (fileItems.length === 0 && textItems.length === 0) return false

      return true
    }
    return false
  }

  function onDragEnter (event) {
    event.stopPropagation()
    event.preventDefault()

    if (!isEventHandleable(event)) return

    if (isEntered) {
      numIgnoredEnters += 1
      return false // early return
    }

    isEntered = true

    if (listeners.onDragEnter) {
      listeners.onDragEnter(event)
    }

    addDragClass()

    return false
  }

  function onDragOver (event) {
    event.stopPropagation()
    event.preventDefault()

    if (!isEventHandleable(event)) return

    if (listeners.onDragOver) {
      listeners.onDragOver(event)
    }

    event.dataTransfer.dropEffect = 'copy'

    return false
  }

  function onDragLeave (event) {
    event.stopPropagation()
    event.preventDefault()

    if (!isEventHandleable(event)) return

    if (numIgnoredEnters > 0) {
      numIgnoredEnters -= 1
      return false
    }

    isEntered = false

    if (listeners.onDragLeave) {
      listeners.onDragLeave(event)
    }

    removeDragClass()

    return false
  }

  function onDrop (event) {
    event.stopPropagation()
    event.preventDefault()

    if (listeners.onDragLeave) {
      listeners.onDragLeave(event)
    }

    removeDragClass()

    isEntered = false
    numIgnoredEnters = 0

    const pos = {
      x: event.clientX,
      y: event.clientY
    }

    // text drop support
    const text = event.dataTransfer.getData('text')
    if (text && listeners.onDropText) {
      listeners.onDropText(text, pos)
    }

    // File drop support. The `dataTransfer.items` API supports directories, so we
    // use it instead of `dataTransfer.files`, even though it's much more
    // complicated to use.
    // See: https://github.com/feross/drag-drop/issues/39
    if (listeners.onDrop && event.dataTransfer.items) {
      const fileList = event.dataTransfer.files

      // Handle directories in Chrome using the proprietary FileSystem API
      const items = Array.from(event.dataTransfer.items).filter(item => {
        return item.kind === 'file'
      })

      if (items.length === 0) return

      parallel(items.map(item => {
        return cb => {
          processEntry(item.webkitGetAsEntry(), cb)
        }
      }), (err, results) => {
        // This catches permission errors with file:// in Chrome. This should never
        // throw in production code, so the user does not need to use try-catch.
        if (err) throw err

        const entries = results.flat(Infinity)

        const files = entries.filter(item => {
          return item.isFile
        })

        const directories = entries.filter(item => {
          return item.isDirectory
        })

        listeners.onDrop(files, pos, fileList, directories)
      })
    }

    return false
  }

  function addDragClass () {
    elem.classList.add('drag')
  }

  function removeDragClass () {
    elem.classList.remove('drag')
  }
}

function processEntry (entry, cb) {
  let entries = []

  if (entry.isFile) {
    entry.file(file => {
      file.fullPath = entry.fullPath // preserve path for consumer
      file.isFile = true
      file.isDirectory = false
      cb(null, file)
    }, err => {
      cb(err)
    })
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    readEntries(reader)
  }

  function readEntries (reader) {
    reader.readEntries(currentEntries => {
      if (currentEntries.length > 0) {
        entries = entries.concat(Array.from(currentEntries))
        readEntries(reader) // continue reading entries until `readEntries` returns no more
      } else {
        doneEntries()
      }
    })
  }

  function doneEntries () {
    parallel(entries.map(entry => {
      return cb => {
        processEntry(entry, cb)
      }
    }), (err, results) => {
      if (err) {
        cb(err)
      } else {
        results.push({
          fullPath: entry.fullPath,
          name: entry.name,
          isFile: false,
          isDirectory: true
        })
        cb(null, results)
      }
    })
  }
}

},{"run-parallel":234}],114:[function(require,module,exports){
(function (process){(function (){
var once = require('once');

var noop = function() {};

var isRequest = function(stream) {
	return stream.setHeader && typeof stream.abort === 'function';
};

var isChildProcess = function(stream) {
	return stream.stdio && Array.isArray(stream.stdio) && stream.stdio.length === 3
};

var eos = function(stream, opts, callback) {
	if (typeof opts === 'function') return eos(stream, null, opts);
	if (!opts) opts = {};

	callback = once(callback || noop);

	var ws = stream._writableState;
	var rs = stream._readableState;
	var readable = opts.readable || (opts.readable !== false && stream.readable);
	var writable = opts.writable || (opts.writable !== false && stream.writable);
	var cancelled = false;

	var onlegacyfinish = function() {
		if (!stream.writable) onfinish();
	};

	var onfinish = function() {
		writable = false;
		if (!readable) callback.call(stream);
	};

	var onend = function() {
		readable = false;
		if (!writable) callback.call(stream);
	};

	var onexit = function(exitCode) {
		callback.call(stream, exitCode ? new Error('exited with error code: ' + exitCode) : null);
	};

	var onerror = function(err) {
		callback.call(stream, err);
	};

	var onclose = function() {
		process.nextTick(onclosenexttick);
	};

	var onclosenexttick = function() {
		if (cancelled) return;
		if (readable && !(rs && (rs.ended && !rs.destroyed))) return callback.call(stream, new Error('premature close'));
		if (writable && !(ws && (ws.ended && !ws.destroyed))) return callback.call(stream, new Error('premature close'));
	};

	var onrequest = function() {
		stream.req.on('finish', onfinish);
	};

	if (isRequest(stream)) {
		stream.on('complete', onfinish);
		stream.on('abort', onclose);
		if (stream.req) onrequest();
		else stream.on('request', onrequest);
	} else if (writable && !ws) { // legacy streams
		stream.on('end', onlegacyfinish);
		stream.on('close', onlegacyfinish);
	}

	if (isChildProcess(stream)) stream.on('exit', onexit);

	stream.on('end', onend);
	stream.on('finish', onfinish);
	if (opts.error !== false) stream.on('error', onerror);
	stream.on('close', onclose);

	return function() {
		cancelled = true;
		stream.removeListener('complete', onfinish);
		stream.removeListener('abort', onclose);
		stream.removeListener('request', onrequest);
		if (stream.req) stream.req.removeListener('finish', onfinish);
		stream.removeListener('end', onlegacyfinish);
		stream.removeListener('close', onlegacyfinish);
		stream.removeListener('finish', onfinish);
		stream.removeListener('exit', onexit);
		stream.removeListener('end', onend);
		stream.removeListener('error', onerror);
		stream.removeListener('close', onclose);
	};
};

module.exports = eos;

}).call(this)}).call(this,require('_process'))
},{"_process":206,"once":201}],115:[function(require,module,exports){
'use strict';

/**
 * @typedef {{ [key: string]: any }} Extensions
 * @typedef {Error} Err
 * @property {string} message
 */

/**
 *
 * @param {Error} obj
 * @param {Extensions} props
 * @returns {Error & Extensions}
 */
function assign(obj, props) {
    for (const key in props) {
        Object.defineProperty(obj, key, {
            value: props[key],
            enumerable: true,
            configurable: true,
        });
    }

    return obj;
}

/**
 *
 * @param {any} err - An Error
 * @param {string|Extensions} code - A string code or props to set on the error
 * @param {Extensions} [props] - Props to set on the error
 * @returns {Error & Extensions}
 */
function createError(err, code, props) {
    if (!err || typeof err === 'string') {
        throw new TypeError('Please pass an Error to err-code');
    }

    if (!props) {
        props = {};
    }

    if (typeof code === 'object') {
        props = code;
        code = '';
    }

    if (code) {
        props.code = code;
    }

    try {
        return assign(err, props);
    } catch (_) {
        props.message = err.message;
        props.stack = err.stack;

        const ErrClass = function () {};

        ErrClass.prototype = Object.create(Object.getPrototypeOf(err));

        // @ts-ignore
        const output = assign(new ErrClass(), props);

        return output;
    }
}

module.exports = createError;

},{}],116:[function(require,module,exports){
/*!
 * escape-html
 * Copyright(c) 2012-2013 TJ Holowaychuk
 * Copyright(c) 2015 Andreas Lubbe
 * Copyright(c) 2015 Tiancheng "Timothy" Gu
 * MIT Licensed
 */

'use strict';

/**
 * Module variables.
 * @private
 */

var matchHtmlRegExp = /["'&<>]/;

/**
 * Module exports.
 * @public
 */

module.exports = escapeHtml;

/**
 * Escape special characters in the given string of html.
 *
 * @param  {string} string The string to escape for inserting into HTML
 * @return {string}
 * @public
 */

function escapeHtml(string) {
  var str = '' + string;
  var match = matchHtmlRegExp.exec(str);

  if (!match) {
    return str;
  }

  var escape;
  var html = '';
  var index = 0;
  var lastIndex = 0;

  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escape = '&quot;';
        break;
      case 38: // &
        escape = '&amp;';
        break;
      case 39: // '
        escape = '&#39;';
        break;
      case 60: // <
        escape = '&lt;';
        break;
      case 62: // >
        escape = '&gt;';
        break;
      default:
        continue;
    }

    if (lastIndex !== index) {
      html += str.substring(lastIndex, index);
    }

    lastIndex = index + 1;
    html += escape;
  }

  return lastIndex !== index
    ? html + str.substring(lastIndex, index)
    : html;
}

},{}],117:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var R = typeof Reflect === 'object' ? Reflect : null
var ReflectApply = R && typeof R.apply === 'function'
  ? R.apply
  : function ReflectApply(target, receiver, args) {
    return Function.prototype.apply.call(target, receiver, args);
  }

var ReflectOwnKeys
if (R && typeof R.ownKeys === 'function') {
  ReflectOwnKeys = R.ownKeys
} else if (Object.getOwnPropertySymbols) {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target)
      .concat(Object.getOwnPropertySymbols(target));
  };
} else {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target);
  };
}

function ProcessEmitWarning(warning) {
  if (console && console.warn) console.warn(warning);
}

var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
  return value !== value;
}

function EventEmitter() {
  EventEmitter.init.call(this);
}
module.exports = EventEmitter;
module.exports.once = once;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._eventsCount = 0;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

function checkListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}

Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
  enumerable: true,
  get: function() {
    return defaultMaxListeners;
  },
  set: function(arg) {
    if (typeof arg !== 'number' || arg < 0 || NumberIsNaN(arg)) {
      throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + '.');
    }
    defaultMaxListeners = arg;
  }
});

EventEmitter.init = function() {

  if (this._events === undefined ||
      this._events === Object.getPrototypeOf(this)._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
};

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || NumberIsNaN(n)) {
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + '.');
  }
  this._maxListeners = n;
  return this;
};

function _getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return _getMaxListeners(this);
};

EventEmitter.prototype.emit = function emit(type) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  var doError = (type === 'error');

  var events = this._events;
  if (events !== undefined)
    doError = (doError && events.error === undefined);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    var er;
    if (args.length > 0)
      er = args[0];
    if (er instanceof Error) {
      // Note: The comments on the `throw` lines are intentional, they show
      // up in Node's output if this results in an unhandled exception.
      throw er; // Unhandled 'error' event
    }
    // At least give some kind of context to the user
    var err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
    err.context = er;
    throw err; // Unhandled 'error' event
  }

  var handler = events[type];

  if (handler === undefined)
    return false;

  if (typeof handler === 'function') {
    ReflectApply(handler, this, args);
  } else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      ReflectApply(listeners[i], this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  checkListener(listener);

  events = target._events;
  if (events === undefined) {
    events = target._events = Object.create(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener !== undefined) {
      target.emit('newListener', type,
                  listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (existing === undefined) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
        prepend ? [listener, existing] : [existing, listener];
      // If we've already got an array, just append.
    } else if (prepend) {
      existing.unshift(listener);
    } else {
      existing.push(listener);
    }

    // Check for listener leak
    m = _getMaxListeners(target);
    if (m > 0 && existing.length > m && !existing.warned) {
      existing.warned = true;
      // No error code for this since it is a Warning
      // eslint-disable-next-line no-restricted-syntax
      var w = new Error('Possible EventEmitter memory leak detected. ' +
                          existing.length + ' ' + String(type) + ' listeners ' +
                          'added. Use emitter.setMaxListeners() to ' +
                          'increase limit');
      w.name = 'MaxListenersExceededWarning';
      w.emitter = target;
      w.type = type;
      w.count = existing.length;
      ProcessEmitWarning(w);
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    if (arguments.length === 0)
      return this.listener.call(this.target);
    return this.listener.apply(this.target, arguments);
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  checkListener(listener);
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      checkListener(listener);

      events = this._events;
      if (events === undefined)
        return this;

      list = events[type];
      if (list === undefined)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener !== undefined)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (events === undefined)
        return this;

      // not listening for removeListener, no need to emit
      if (events.removeListener === undefined) {
        if (arguments.length === 0) {
          this._events = Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== undefined) {
          if (--this._eventsCount === 0)
            this._events = Object.create(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = Object.create(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners !== undefined) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (events === undefined)
    return [];

  var evlistener = events[type];
  if (evlistener === undefined)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ?
    unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events !== undefined) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener !== undefined) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
};

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function spliceOne(list, index) {
  for (; index + 1 < list.length; index++)
    list[index] = list[index + 1];
  list.pop();
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function once(emitter, name) {
  return new Promise(function (resolve, reject) {
    function errorListener(err) {
      emitter.removeListener(name, resolver);
      reject(err);
    }

    function resolver() {
      if (typeof emitter.removeListener === 'function') {
        emitter.removeListener('error', errorListener);
      }
      resolve([].slice.call(arguments));
    };

    eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
    if (name !== 'error') {
      addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
    }
  });
}

function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
  if (typeof emitter.on === 'function') {
    eventTargetAgnosticAddListener(emitter, 'error', handler, flags);
  }
}

function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
  if (typeof emitter.on === 'function') {
    if (flags.once) {
      emitter.once(name, listener);
    } else {
      emitter.on(name, listener);
    }
  } else if (typeof emitter.addEventListener === 'function') {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we do not listen for `error` events here.
    emitter.addEventListener(name, function wrapListener(arg) {
      // IE does not have builtin `{ once: true }` support so we
      // have to do it manually.
      if (flags.once) {
        emitter.removeEventListener(name, wrapListener);
      }
      listener(arg);
    });
  } else {
    throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
  }
}

},{}],118:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],119:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":121,"./_stream_writable":123,"_process":206,"dup":13,"inherits":138}],120:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":122,"dup":14,"inherits":138}],121:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":118,"./_stream_duplex":119,"./internal/streams/async_iterator":124,"./internal/streams/buffer_list":125,"./internal/streams/destroy":126,"./internal/streams/from":128,"./internal/streams/state":130,"./internal/streams/stream":131,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],122:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":118,"./_stream_duplex":119,"dup":16,"inherits":138}],123:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":118,"./_stream_duplex":119,"./internal/streams/destroy":126,"./internal/streams/state":130,"./internal/streams/stream":131,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],124:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":127,"_process":206,"dup":18}],125:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],126:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],127:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":118,"dup":21}],128:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],129:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":118,"./end-of-stream":127,"dup":23}],130:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":118,"dup":24}],131:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],132:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":119,"./lib/_stream_passthrough.js":120,"./lib/_stream_readable.js":121,"./lib/_stream_transform.js":122,"./lib/_stream_writable.js":123,"./lib/internal/streams/end-of-stream.js":127,"./lib/internal/streams/pipeline.js":129,"dup":26}],133:[function(require,module,exports){
/* global FileReader */

const { Readable } = require('readable-stream')
const toBuffer = require('typedarray-to-buffer')

class FileReadStream extends Readable {
  constructor (file, opts = {}) {
    super(opts)

    // save the read offset
    this._offset = 0
    this._ready = false
    this._file = file
    this._size = file.size
    this._chunkSize = opts.chunkSize || Math.max(this._size / 1000, 200 * 1024)

    // create the reader
    const reader = new FileReader()

    reader.onload = () => {
      // get the data chunk
      this.push(toBuffer(reader.result))
    }
    reader.onerror = () => {
      this.emit('error', reader.error)
    }

    this.reader = reader

    // generate the header blocks that we will send as part of the initial payload
    this._generateHeaderBlocks(file, opts, (err, blocks) => {
      // if we encountered an error, emit it
      if (err) {
        return this.emit('error', err)
      }

      // push the header blocks out to the stream
      if (Array.isArray(blocks)) {
        blocks.forEach(block => this.push(block))
      }

      this._ready = true
      this.emit('_ready')
    })
  }

  _generateHeaderBlocks (file, opts, callback) {
    callback(null, [])
  }

  _read () {
    if (!this._ready) {
      this.once('_ready', this._read.bind(this))
      return
    }

    const startOffset = this._offset
    let endOffset = this._offset + this._chunkSize
    if (endOffset > this._size) endOffset = this._size

    if (startOffset === this._size) {
      this.destroy()
      this.push(null)
      return
    }

    this.reader.readAsArrayBuffer(this._file.slice(startOffset, endOffset))

    // update the stream offset
    this._offset = endOffset
  }

  destroy () {
    this._file = null
    if (this.reader) {
      this.reader.onload = null
      this.reader.onerror = null
      try { this.reader.abort() } catch (e) {};
    }
    this.reader = null
  }
}

module.exports = FileReadStream

},{"readable-stream":132,"typedarray-to-buffer":305}],134:[function(require,module,exports){
// originally pulled out of simple-peer

module.exports = function getBrowserRTC () {
  if (typeof globalThis === 'undefined') return null
  var wrtc = {
    RTCPeerConnection: globalThis.RTCPeerConnection || globalThis.mozRTCPeerConnection ||
      globalThis.webkitRTCPeerConnection,
    RTCSessionDescription: globalThis.RTCSessionDescription ||
      globalThis.mozRTCSessionDescription || globalThis.webkitRTCSessionDescription,
    RTCIceCandidate: globalThis.RTCIceCandidate || globalThis.mozRTCIceCandidate ||
      globalThis.webkitRTCIceCandidate
  }
  if (!wrtc.RTCPeerConnection) return null
  return wrtc
}

},{}],135:[function(require,module,exports){
var http = require('http')
var url = require('url')

var https = module.exports

for (var key in http) {
  if (http.hasOwnProperty(key)) https[key] = http[key]
}

https.request = function (params, cb) {
  params = validateParams(params)
  return http.request.call(this, params, cb)
}

https.get = function (params, cb) {
  params = validateParams(params)
  return http.get.call(this, params, cb)
}

function validateParams (params) {
  if (typeof params === 'string') {
    params = url.parse(params)
  }
  if (!params.protocol) {
    params.protocol = 'https:'
  }
  if (params.protocol !== 'https:') {
    throw new Error('Protocol "' + params.protocol + '" not supported. Expected "https:"')
  }
  return params
}

},{"http":274,"url":309}],136:[function(require,module,exports){
/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],137:[function(require,module,exports){
/*! immediate-chunk-store. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
// TODO: remove when window.queueMicrotask() is well supported
const queueMicrotask = require('queue-microtask')

class ImmediateStore {
  constructor (store) {
    this.store = store
    this.chunkLength = store.chunkLength

    if (!this.store || !this.store.get || !this.store.put) {
      throw new Error('First argument must be abstract-chunk-store compliant')
    }

    this.mem = []
  }

  put (index, buf, cb) {
    this.mem[index] = buf
    this.store.put(index, buf, err => {
      this.mem[index] = null
      if (cb) cb(err)
    })
  }

  get (index, opts, cb) {
    if (typeof opts === 'function') return this.get(index, null, opts)

    let memoryBuffer = this.mem[index]

    // if the chunk isn't in the immediate memory cache
    if (!memoryBuffer) {
      return this.store.get(index, opts, cb)
    }

    if (opts) {
      const start = opts.offset || 0
      const end = opts.length ? (start + opts.length) : memoryBuffer.length

      memoryBuffer = memoryBuffer.slice(start, end)
    }

    // queueMicrotask to ensure the function is async
    queueMicrotask(() => {
      if (cb) cb(null, memoryBuffer)
    })
  }

  close (cb) {
    this.store.close(cb)
  }

  destroy (cb) {
    this.store.destroy(cb)
  }
}

module.exports = ImmediateStore

},{"queue-microtask":212}],138:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      })
    }
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      var TempCtor = function () {}
      TempCtor.prototype = superCtor.prototype
      ctor.prototype = new TempCtor()
      ctor.prototype.constructor = ctor
    }
  }
}

},{}],139:[function(require,module,exports){
/* (c) 2016 Ari Porad (@ariporad) <http://ariporad.com>. License: ariporad.mit-license.org */

// Partially from http://stackoverflow.com/a/94049/1928484, and from another SO answer, which told me that the highest
// char code that's ascii is 127, but I can't find the link for. Sorry.

var MAX_ASCII_CHAR_CODE = 127;

module.exports = function isAscii(str) {
  for (var i = 0, strLen = str.length; i < strLen; ++i) {
    if (str.charCodeAt(i) > MAX_ASCII_CHAR_CODE) return false;
  }
  return true;
};

},{}],140:[function(require,module,exports){
module.exports      = isTypedArray
isTypedArray.strict = isStrictTypedArray
isTypedArray.loose  = isLooseTypedArray

var toString = Object.prototype.toString
var names = {
    '[object Int8Array]': true
  , '[object Int16Array]': true
  , '[object Int32Array]': true
  , '[object Uint8Array]': true
  , '[object Uint8ClampedArray]': true
  , '[object Uint16Array]': true
  , '[object Uint32Array]': true
  , '[object Float32Array]': true
  , '[object Float64Array]': true
}

function isTypedArray(arr) {
  return (
       isStrictTypedArray(arr)
    || isLooseTypedArray(arr)
  )
}

function isStrictTypedArray(arr) {
  return (
       arr instanceof Int8Array
    || arr instanceof Int16Array
    || arr instanceof Int32Array
    || arr instanceof Uint8Array
    || arr instanceof Uint8ClampedArray
    || arr instanceof Uint16Array
    || arr instanceof Uint32Array
    || arr instanceof Float32Array
    || arr instanceof Float64Array
  )
}

function isLooseTypedArray(arr) {
  return names[toString.call(arr)]
}

},{}],141:[function(require,module,exports){
(function (global,Buffer,setImmediate){(function (){
/*!

JSZip v3.6.0 - A JavaScript class for generating and reading zip files
<http://stuartk.com/jszip>

(c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/master/LICENSE.markdown.

JSZip uses the library pako released under the MIT license :
https://github.com/nodeca/pako/blob/master/LICENSE
*/

!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).JSZip=e()}}(function(){return function s(a,o,u){function h(r,e){if(!o[r]){if(!a[r]){var t="function"==typeof require&&require;if(!e&&t)return t(r,!0);if(f)return f(r,!0);var n=new Error("Cannot find module '"+r+"'");throw n.code="MODULE_NOT_FOUND",n}var i=o[r]={exports:{}};a[r][0].call(i.exports,function(e){var t=a[r][1][e];return h(t||e)},i,i.exports,s,a,o,u)}return o[r].exports}for(var f="function"==typeof require&&require,e=0;e<u.length;e++)h(u[e]);return h}({1:[function(l,t,n){(function(r){!function(e){"object"==typeof n&&void 0!==t?t.exports=e():("undefined"!=typeof window?window:void 0!==r?r:"undefined"!=typeof self?self:this).JSZip=e()}(function(){return function s(a,o,u){function h(t,e){if(!o[t]){if(!a[t]){var r="function"==typeof l&&l;if(!e&&r)return r(t,!0);if(f)return f(t,!0);var n=new Error("Cannot find module '"+t+"'");throw n.code="MODULE_NOT_FOUND",n}var i=o[t]={exports:{}};a[t][0].call(i.exports,function(e){return h(a[t][1][e]||e)},i,i.exports,s,a,o,u)}return o[t].exports}for(var f="function"==typeof l&&l,e=0;e<u.length;e++)h(u[e]);return h}({1:[function(l,t,n){(function(r){!function(e){"object"==typeof n&&void 0!==t?t.exports=e():("undefined"!=typeof window?window:void 0!==r?r:"undefined"!=typeof self?self:this).JSZip=e()}(function(){return function s(a,o,u){function h(t,e){if(!o[t]){if(!a[t]){var r="function"==typeof l&&l;if(!e&&r)return r(t,!0);if(f)return f(t,!0);var n=new Error("Cannot find module '"+t+"'");throw n.code="MODULE_NOT_FOUND",n}var i=o[t]={exports:{}};a[t][0].call(i.exports,function(e){return h(a[t][1][e]||e)},i,i.exports,s,a,o,u)}return o[t].exports}for(var f="function"==typeof l&&l,e=0;e<u.length;e++)h(u[e]);return h}({1:[function(l,t,n){(function(r){!function(e){"object"==typeof n&&void 0!==t?t.exports=e():("undefined"!=typeof window?window:void 0!==r?r:"undefined"!=typeof self?self:this).JSZip=e()}(function(){return function s(a,o,u){function h(t,e){if(!o[t]){if(!a[t]){var r="function"==typeof l&&l;if(!e&&r)return r(t,!0);if(f)return f(t,!0);var n=new Error("Cannot find module '"+t+"'");throw n.code="MODULE_NOT_FOUND",n}var i=o[t]={exports:{}};a[t][0].call(i.exports,function(e){return h(a[t][1][e]||e)},i,i.exports,s,a,o,u)}return o[t].exports}for(var f="function"==typeof l&&l,e=0;e<u.length;e++)h(u[e]);return h}({1:[function(l,t,n){(function(r){!function(e){"object"==typeof n&&void 0!==t?t.exports=e():("undefined"!=typeof window?window:void 0!==r?r:"undefined"!=typeof self?self:this).JSZip=e()}(function(){return function s(a,o,u){function h(t,e){if(!o[t]){if(!a[t]){var r="function"==typeof l&&l;if(!e&&r)return r(t,!0);if(f)return f(t,!0);var n=new Error("Cannot find module '"+t+"'");throw n.code="MODULE_NOT_FOUND",n}var i=o[t]={exports:{}};a[t][0].call(i.exports,function(e){return h(a[t][1][e]||e)},i,i.exports,s,a,o,u)}return o[t].exports}for(var f="function"==typeof l&&l,e=0;e<u.length;e++)h(u[e]);return h}({1:[function(l,t,n){(function(r){!function(e){"object"==typeof n&&void 0!==t?t.exports=e():("undefined"!=typeof window?window:void 0!==r?r:"undefined"!=typeof self?self:this).JSZip=e()}(function(){return function s(a,o,u){function h(t,e){if(!o[t]){if(!a[t]){var r="function"==typeof l&&l;if(!e&&r)return r(t,!0);if(f)return f(t,!0);var n=new Error("Cannot find module '"+t+"'");throw n.code="MODULE_NOT_FOUND",n}var i=o[t]={exports:{}};a[t][0].call(i.exports,function(e){return h(a[t][1][e]||e)},i,i.exports,s,a,o,u)}return o[t].exports}for(var f="function"==typeof l&&l,e=0;e<u.length;e++)h(u[e]);return h}({1:[function(e,t,r){"use strict";var c=e("./utils"),l=e("./support"),p="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";r.encode=function(e){for(var t,r,n,i,s,a,o,u=[],h=0,f=e.length,l=f,d="string"!==c.getTypeOf(e);h<e.length;)l=f-h,n=d?(t=e[h++],r=h<f?e[h++]:0,h<f?e[h++]:0):(t=e.charCodeAt(h++),r=h<f?e.charCodeAt(h++):0,h<f?e.charCodeAt(h++):0),i=t>>2,s=(3&t)<<4|r>>4,a=1<l?(15&r)<<2|n>>6:64,o=2<l?63&n:64,u.push(p.charAt(i)+p.charAt(s)+p.charAt(a)+p.charAt(o));return u.join("")},r.decode=function(e){var t,r,n,i,s,a,o=0,u=0;if("data:"===e.substr(0,"data:".length))throw new Error("Invalid base64 input, it looks like a data url.");var h,f=3*(e=e.replace(/[^A-Za-z0-9\+\/\=]/g,"")).length/4;if(e.charAt(e.length-1)===p.charAt(64)&&f--,e.charAt(e.length-2)===p.charAt(64)&&f--,f%1!=0)throw new Error("Invalid base64 input, bad content length.");for(h=l.uint8array?new Uint8Array(0|f):new Array(0|f);o<e.length;)t=p.indexOf(e.charAt(o++))<<2|(i=p.indexOf(e.charAt(o++)))>>4,r=(15&i)<<4|(s=p.indexOf(e.charAt(o++)))>>2,n=(3&s)<<6|(a=p.indexOf(e.charAt(o++))),h[u++]=t,64!==s&&(h[u++]=r),64!==a&&(h[u++]=n);return h}},{"./support":30,"./utils":32}],2:[function(e,t,r){"use strict";var n=e("./external"),i=e("./stream/DataWorker"),s=e("./stream/Crc32Probe"),a=e("./stream/DataLengthProbe");function o(e,t,r,n,i){this.compressedSize=e,this.uncompressedSize=t,this.crc32=r,this.compression=n,this.compressedContent=i}o.prototype={getContentWorker:function(){var e=new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")),t=this;return e.on("end",function(){if(this.streamInfo.data_length!==t.uncompressedSize)throw new Error("Bug : uncompressed data size mismatch")}),e},getCompressedWorker:function(){return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize",this.compressedSize).withStreamInfo("uncompressedSize",this.uncompressedSize).withStreamInfo("crc32",this.crc32).withStreamInfo("compression",this.compression)}},o.createWorkerFrom=function(e,t,r){return e.pipe(new s).pipe(new a("uncompressedSize")).pipe(t.compressWorker(r)).pipe(new a("compressedSize")).withStreamInfo("compression",t)},t.exports=o},{"./external":6,"./stream/Crc32Probe":25,"./stream/DataLengthProbe":26,"./stream/DataWorker":27}],3:[function(e,t,r){"use strict";var n=e("./stream/GenericWorker");r.STORE={magic:"\0\0",compressWorker:function(e){return new n("STORE compression")},uncompressWorker:function(){return new n("STORE decompression")}},r.DEFLATE=e("./flate")},{"./flate":7,"./stream/GenericWorker":28}],4:[function(e,t,r){"use strict";var n=e("./utils"),a=function(){for(var e,t=[],r=0;r<256;r++){e=r;for(var n=0;n<8;n++)e=1&e?3988292384^e>>>1:e>>>1;t[r]=e}return t}();t.exports=function(e,t){return void 0!==e&&e.length?"string"!==n.getTypeOf(e)?function(e,t,r){var n=a,i=0+r;e^=-1;for(var s=0;s<i;s++)e=e>>>8^n[255&(e^t[s])];return-1^e}(0|t,e,e.length):function(e,t,r){var n=a,i=0+r;e^=-1;for(var s=0;s<i;s++)e=e>>>8^n[255&(e^t.charCodeAt(s))];return-1^e}(0|t,e,e.length):0}},{"./utils":32}],5:[function(e,t,r){"use strict";r.base64=!1,r.binary=!1,r.dir=!1,r.createFolders=!0,r.date=null,r.compression=null,r.compressionOptions=null,r.comment=null,r.unixPermissions=null,r.dosPermissions=null},{}],6:[function(e,t,r){"use strict";var n;n="undefined"!=typeof Promise?Promise:e("lie"),t.exports={Promise:n}},{lie:37}],7:[function(e,t,r){"use strict";var n="undefined"!=typeof Uint8Array&&"undefined"!=typeof Uint16Array&&"undefined"!=typeof Uint32Array,i=e("pako"),s=e("./utils"),a=e("./stream/GenericWorker"),o=n?"uint8array":"array";function u(e,t){a.call(this,"FlateWorker/"+e),this._pako=null,this._pakoAction=e,this._pakoOptions=t,this.meta={}}r.magic="\b\0",s.inherits(u,a),u.prototype.processChunk=function(e){this.meta=e.meta,null===this._pako&&this._createPako(),this._pako.push(s.transformTo(o,e.data),!1)},u.prototype.flush=function(){a.prototype.flush.call(this),null===this._pako&&this._createPako(),this._pako.push([],!0)},u.prototype.cleanUp=function(){a.prototype.cleanUp.call(this),this._pako=null},u.prototype._createPako=function(){this._pako=new i[this._pakoAction]({raw:!0,level:this._pakoOptions.level||-1});var t=this;this._pako.onData=function(e){t.push({data:e,meta:t.meta})}},r.compressWorker=function(e){return new u("Deflate",e)},r.uncompressWorker=function(){return new u("Inflate",{})}},{"./stream/GenericWorker":28,"./utils":32,pako:38}],8:[function(e,t,r){"use strict";function I(e,t){var r,n="";for(r=0;r<t;r++)n+=String.fromCharCode(255&e),e>>>=8;return n}function i(e,t,r,n,i,s){var a,o,u=e.file,h=e.compression,f=s!==B.utf8encode,l=O.transformTo("string",s(u.name)),d=O.transformTo("string",B.utf8encode(u.name)),c=u.comment,p=O.transformTo("string",s(c)),m=O.transformTo("string",B.utf8encode(c)),_=d.length!==u.name.length,g=m.length!==c.length,v="",b="",w="",y=u.dir,k=u.date,x={crc32:0,compressedSize:0,uncompressedSize:0};t&&!r||(x.crc32=e.crc32,x.compressedSize=e.compressedSize,x.uncompressedSize=e.uncompressedSize);var S=0;t&&(S|=8),f||!_&&!g||(S|=2048);var z,E=0,C=0;y&&(E|=16),"UNIX"===i?(C=798,E|=((z=u.unixPermissions)||(z=y?16893:33204),(65535&z)<<16)):(C=20,E|=63&(u.dosPermissions||0)),a=k.getUTCHours(),a<<=6,a|=k.getUTCMinutes(),a<<=5,a|=k.getUTCSeconds()/2,o=k.getUTCFullYear()-1980,o<<=4,o|=k.getUTCMonth()+1,o<<=5,o|=k.getUTCDate(),_&&(v+="up"+I((b=I(1,1)+I(T(l),4)+d).length,2)+b),g&&(v+="uc"+I((w=I(1,1)+I(T(p),4)+m).length,2)+w);var A="";return A+="\n\0",A+=I(S,2),A+=h.magic,A+=I(a,2),A+=I(o,2),A+=I(x.crc32,4),A+=I(x.compressedSize,4),A+=I(x.uncompressedSize,4),A+=I(l.length,2),A+=I(v.length,2),{fileRecord:R.LOCAL_FILE_HEADER+A+l+v,dirRecord:R.CENTRAL_FILE_HEADER+I(C,2)+A+I(p.length,2)+"\0\0\0\0"+I(E,4)+I(n,4)+l+v+p}}var O=e("../utils"),s=e("../stream/GenericWorker"),B=e("../utf8"),T=e("../crc32"),R=e("../signature");function n(e,t,r,n){s.call(this,"ZipFileWorker"),this.bytesWritten=0,this.zipComment=t,this.zipPlatform=r,this.encodeFileName=n,this.streamFiles=e,this.accumulate=!1,this.contentBuffer=[],this.dirRecords=[],this.currentSourceOffset=0,this.entriesCount=0,this.currentFile=null,this._sources=[]}O.inherits(n,s),n.prototype.push=function(e){var t=e.meta.percent||0,r=this.entriesCount,n=this._sources.length;this.accumulate?this.contentBuffer.push(e):(this.bytesWritten+=e.data.length,s.prototype.push.call(this,{data:e.data,meta:{currentFile:this.currentFile,percent:r?(t+100*(r-n-1))/r:100}}))},n.prototype.openedSource=function(e){this.currentSourceOffset=this.bytesWritten,this.currentFile=e.file.name;var t=this.streamFiles&&!e.file.dir;if(t){var r=i(e,t,!1,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);this.push({data:r.fileRecord,meta:{percent:0}})}else this.accumulate=!0},n.prototype.closedSource=function(e){this.accumulate=!1;var t,r=this.streamFiles&&!e.file.dir,n=i(e,r,!0,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);if(this.dirRecords.push(n.dirRecord),r)this.push({data:(t=e,R.DATA_DESCRIPTOR+I(t.crc32,4)+I(t.compressedSize,4)+I(t.uncompressedSize,4)),meta:{percent:100}});else for(this.push({data:n.fileRecord,meta:{percent:0}});this.contentBuffer.length;)this.push(this.contentBuffer.shift());this.currentFile=null},n.prototype.flush=function(){for(var e=this.bytesWritten,t=0;t<this.dirRecords.length;t++)this.push({data:this.dirRecords[t],meta:{percent:100}});var r,n,i,s,a,o,u=this.bytesWritten-e,h=(r=this.dirRecords.length,n=u,i=e,s=this.zipComment,a=this.encodeFileName,o=O.transformTo("string",a(s)),R.CENTRAL_DIRECTORY_END+"\0\0\0\0"+I(r,2)+I(r,2)+I(n,4)+I(i,4)+I(o.length,2)+o);this.push({data:h,meta:{percent:100}})},n.prototype.prepareNextSource=function(){this.previous=this._sources.shift(),this.openedSource(this.previous.streamInfo),this.isPaused?this.previous.pause():this.previous.resume()},n.prototype.registerPrevious=function(e){this._sources.push(e);var t=this;return e.on("data",function(e){t.processChunk(e)}),e.on("end",function(){t.closedSource(t.previous.streamInfo),t._sources.length?t.prepareNextSource():t.end()}),e.on("error",function(e){t.error(e)}),this},n.prototype.resume=function(){return!!s.prototype.resume.call(this)&&(!this.previous&&this._sources.length?(this.prepareNextSource(),!0):this.previous||this._sources.length||this.generatedError?void 0:(this.end(),!0))},n.prototype.error=function(e){var t=this._sources;if(!s.prototype.error.call(this,e))return!1;for(var r=0;r<t.length;r++)try{t[r].error(e)}catch(e){}return!0},n.prototype.lock=function(){s.prototype.lock.call(this);for(var e=this._sources,t=0;t<e.length;t++)e[t].lock()},t.exports=n},{"../crc32":4,"../signature":23,"../stream/GenericWorker":28,"../utf8":31,"../utils":32}],9:[function(e,t,r){"use strict";var h=e("../compressions"),n=e("./ZipFileWorker");r.generateWorker=function(e,a,t){var o=new n(a.streamFiles,t,a.platform,a.encodeFileName),u=0;try{e.forEach(function(e,t){u++;var r=function(e,t){var r=e||t,n=h[r];if(!n)throw new Error(r+" is not a valid compression method !");return n}(t.options.compression,a.compression),n=t.options.compressionOptions||a.compressionOptions||{},i=t.dir,s=t.date;t._compressWorker(r,n).withStreamInfo("file",{name:e,dir:i,date:s,comment:t.comment||"",unixPermissions:t.unixPermissions,dosPermissions:t.dosPermissions}).pipe(o)}),o.entriesCount=u}catch(e){o.error(e)}return o}},{"../compressions":3,"./ZipFileWorker":8}],10:[function(e,t,r){"use strict";function n(){if(!(this instanceof n))return new n;if(arguments.length)throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");this.files={},this.comment=null,this.root="",this.clone=function(){var e=new n;for(var t in this)"function"!=typeof this[t]&&(e[t]=this[t]);return e}}(n.prototype=e("./object")).loadAsync=e("./load"),n.support=e("./support"),n.defaults=e("./defaults"),n.version="3.5.0",n.loadAsync=function(e,t){return(new n).loadAsync(e,t)},n.external=e("./external"),t.exports=n},{"./defaults":5,"./external":6,"./load":11,"./object":15,"./support":30}],11:[function(e,t,r){"use strict";var n=e("./utils"),i=e("./external"),o=e("./utf8"),u=e("./zipEntries"),s=e("./stream/Crc32Probe"),h=e("./nodejsUtils");function f(n){return new i.Promise(function(e,t){var r=n.decompressed.getContentWorker().pipe(new s);r.on("error",function(e){t(e)}).on("end",function(){r.streamInfo.crc32!==n.decompressed.crc32?t(new Error("Corrupted zip : CRC32 mismatch")):e()}).resume()})}t.exports=function(e,s){var a=this;return s=n.extend(s||{},{base64:!1,checkCRC32:!1,optimizedBinaryString:!1,createFolders:!1,decodeFileName:o.utf8decode}),h.isNode&&h.isStream(e)?i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")):n.prepareContent("the loaded zip file",e,!0,s.optimizedBinaryString,s.base64).then(function(e){var t=new u(s);return t.load(e),t}).then(function(e){var t=[i.Promise.resolve(e)],r=e.files;if(s.checkCRC32)for(var n=0;n<r.length;n++)t.push(f(r[n]));return i.Promise.all(t)}).then(function(e){for(var t=e.shift(),r=t.files,n=0;n<r.length;n++){var i=r[n];a.file(i.fileNameStr,i.decompressed,{binary:!0,optimizedBinaryString:!0,date:i.date,dir:i.dir,comment:i.fileCommentStr.length?i.fileCommentStr:null,unixPermissions:i.unixPermissions,dosPermissions:i.dosPermissions,createFolders:s.createFolders})}return t.zipComment.length&&(a.comment=t.zipComment),a})}},{"./external":6,"./nodejsUtils":14,"./stream/Crc32Probe":25,"./utf8":31,"./utils":32,"./zipEntries":33}],12:[function(e,t,r){"use strict";var n=e("../utils"),i=e("../stream/GenericWorker");function s(e,t){i.call(this,"Nodejs stream input adapter for "+e),this._upstreamEnded=!1,this._bindStream(t)}n.inherits(s,i),s.prototype._bindStream=function(e){var t=this;(this._stream=e).pause(),e.on("data",function(e){t.push({data:e,meta:{percent:0}})}).on("error",function(e){t.isPaused?this.generatedError=e:t.error(e)}).on("end",function(){t.isPaused?t._upstreamEnded=!0:t.end()})},s.prototype.pause=function(){return!!i.prototype.pause.call(this)&&(this._stream.pause(),!0)},s.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(this._upstreamEnded?this.end():this._stream.resume(),!0)},t.exports=s},{"../stream/GenericWorker":28,"../utils":32}],13:[function(e,t,r){"use strict";var i=e("readable-stream").Readable;function n(e,t,r){i.call(this,t),this._helper=e;var n=this;e.on("data",function(e,t){n.push(e)||n._helper.pause(),r&&r(t)}).on("error",function(e){n.emit("error",e)}).on("end",function(){n.push(null)})}e("../utils").inherits(n,i),n.prototype._read=function(){this._helper.resume()},t.exports=n},{"../utils":32,"readable-stream":16}],14:[function(e,t,r){"use strict";t.exports={isNode:"undefined"!=typeof Buffer,newBufferFrom:function(e,t){if(Buffer.from&&Buffer.from!==Uint8Array.from)return Buffer.from(e,t);if("number"==typeof e)throw new Error('The "data" argument must not be a number');return new Buffer(e,t)},allocBuffer:function(e){if(Buffer.alloc)return Buffer.alloc(e);var t=new Buffer(e);return t.fill(0),t},isBuffer:function(e){return Buffer.isBuffer(e)},isStream:function(e){return e&&"function"==typeof e.on&&"function"==typeof e.pause&&"function"==typeof e.resume}}},{}],15:[function(e,t,r){"use strict";function s(e,t,r){var n,i=f.getTypeOf(t),s=f.extend(r||{},d);s.date=s.date||new Date,null!==s.compression&&(s.compression=s.compression.toUpperCase()),"string"==typeof s.unixPermissions&&(s.unixPermissions=parseInt(s.unixPermissions,8)),s.unixPermissions&&16384&s.unixPermissions&&(s.dir=!0),s.dosPermissions&&16&s.dosPermissions&&(s.dir=!0),s.dir&&(e=h(e)),s.createFolders&&(n=function(e){"/"===e.slice(-1)&&(e=e.substring(0,e.length-1));var t=e.lastIndexOf("/");return 0<t?e.substring(0,t):""}(e))&&g.call(this,n,!0);var a,o="string"===i&&!1===s.binary&&!1===s.base64;r&&void 0!==r.binary||(s.binary=!o),(t instanceof c&&0===t.uncompressedSize||s.dir||!t||0===t.length)&&(s.base64=!1,s.binary=!0,t="",s.compression="STORE",i="string"),a=t instanceof c||t instanceof l?t:m.isNode&&m.isStream(t)?new _(e,t):f.prepareContent(e,t,s.binary,s.optimizedBinaryString,s.base64);var u=new p(e,a,s);this.files[e]=u}function h(e){return"/"!==e.slice(-1)&&(e+="/"),e}var i=e("./utf8"),f=e("./utils"),l=e("./stream/GenericWorker"),a=e("./stream/StreamHelper"),d=e("./defaults"),c=e("./compressedObject"),p=e("./zipObject"),o=e("./generate"),m=e("./nodejsUtils"),_=e("./nodejs/NodejsStreamInputAdapter"),g=function(e,t){return t=void 0!==t?t:d.createFolders,e=h(e),this.files[e]||s.call(this,e,null,{dir:!0,createFolders:t}),this.files[e]};function u(e){return"[object RegExp]"===Object.prototype.toString.call(e)}var n={load:function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},forEach:function(e){var t,r,n;for(t in this.files)this.files.hasOwnProperty(t)&&(n=this.files[t],(r=t.slice(this.root.length,t.length))&&t.slice(0,this.root.length)===this.root&&e(r,n))},filter:function(r){var n=[];return this.forEach(function(e,t){r(e,t)&&n.push(t)}),n},file:function(e,t,r){if(1!==arguments.length)return e=this.root+e,s.call(this,e,t,r),this;if(u(e)){var n=e;return this.filter(function(e,t){return!t.dir&&n.test(e)})}var i=this.files[this.root+e];return i&&!i.dir?i:null},folder:function(r){if(!r)return this;if(u(r))return this.filter(function(e,t){return t.dir&&r.test(e)});var e=this.root+r,t=g.call(this,e),n=this.clone();return n.root=t.name,n},remove:function(r){r=this.root+r;var e=this.files[r];if(e||("/"!==r.slice(-1)&&(r+="/"),e=this.files[r]),e&&!e.dir)delete this.files[r];else for(var t=this.filter(function(e,t){return t.name.slice(0,r.length)===r}),n=0;n<t.length;n++)delete this.files[t[n].name];return this},generate:function(e){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},generateInternalStream:function(e){var t,r={};try{if((r=f.extend(e||{},{streamFiles:!1,compression:"STORE",compressionOptions:null,type:"",platform:"DOS",comment:null,mimeType:"application/zip",encodeFileName:i.utf8encode})).type=r.type.toLowerCase(),r.compression=r.compression.toUpperCase(),"binarystring"===r.type&&(r.type="string"),!r.type)throw new Error("No output type specified.");f.checkSupport(r.type),"darwin"!==r.platform&&"freebsd"!==r.platform&&"linux"!==r.platform&&"sunos"!==r.platform||(r.platform="UNIX"),"win32"===r.platform&&(r.platform="DOS");var n=r.comment||this.comment||"";t=o.generateWorker(this,r,n)}catch(e){(t=new l("error")).error(e)}return new a(t,r.type||"string",r.mimeType)},generateAsync:function(e,t){return this.generateInternalStream(e).accumulate(t)},generateNodeStream:function(e,t){return(e=e||{}).type||(e.type="nodebuffer"),this.generateInternalStream(e).toNodejsStream(t)}};t.exports=n},{"./compressedObject":2,"./defaults":5,"./generate":9,"./nodejs/NodejsStreamInputAdapter":12,"./nodejsUtils":14,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31,"./utils":32,"./zipObject":35}],16:[function(e,t,r){t.exports=e("stream")},{stream:void 0}],17:[function(e,t,r){"use strict";var n=e("./DataReader");function i(e){n.call(this,e);for(var t=0;t<this.data.length;t++)e[t]=255&e[t]}e("../utils").inherits(i,n),i.prototype.byteAt=function(e){return this.data[this.zero+e]},i.prototype.lastIndexOfSignature=function(e){for(var t=e.charCodeAt(0),r=e.charCodeAt(1),n=e.charCodeAt(2),i=e.charCodeAt(3),s=this.length-4;0<=s;--s)if(this.data[s]===t&&this.data[s+1]===r&&this.data[s+2]===n&&this.data[s+3]===i)return s-this.zero;return-1},i.prototype.readAndCheckSignature=function(e){var t=e.charCodeAt(0),r=e.charCodeAt(1),n=e.charCodeAt(2),i=e.charCodeAt(3),s=this.readData(4);return t===s[0]&&r===s[1]&&n===s[2]&&i===s[3]},i.prototype.readData=function(e){if(this.checkOffset(e),0===e)return[];var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./DataReader":18}],18:[function(e,t,r){"use strict";var n=e("../utils");function i(e){this.data=e,this.length=e.length,this.index=0,this.zero=0}i.prototype={checkOffset:function(e){this.checkIndex(this.index+e)},checkIndex:function(e){if(this.length<this.zero+e||e<0)throw new Error("End of data reached (data length = "+this.length+", asked index = "+e+"). Corrupted zip ?")},setIndex:function(e){this.checkIndex(e),this.index=e},skip:function(e){this.setIndex(this.index+e)},byteAt:function(e){},readInt:function(e){var t,r=0;for(this.checkOffset(e),t=this.index+e-1;t>=this.index;t--)r=(r<<8)+this.byteAt(t);return this.index+=e,r},readString:function(e){return n.transformTo("string",this.readData(e))},readData:function(e){},lastIndexOfSignature:function(e){},readAndCheckSignature:function(e){},readDate:function(){var e=this.readInt(4);return new Date(Date.UTC(1980+(e>>25&127),(e>>21&15)-1,e>>16&31,e>>11&31,e>>5&63,(31&e)<<1))}},t.exports=i},{"../utils":32}],19:[function(e,t,r){"use strict";var n=e("./Uint8ArrayReader");function i(e){n.call(this,e)}e("../utils").inherits(i,n),i.prototype.readData=function(e){this.checkOffset(e);var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./Uint8ArrayReader":21}],20:[function(e,t,r){"use strict";var n=e("./DataReader");function i(e){n.call(this,e)}e("../utils").inherits(i,n),i.prototype.byteAt=function(e){return this.data.charCodeAt(this.zero+e)},i.prototype.lastIndexOfSignature=function(e){return this.data.lastIndexOf(e)-this.zero},i.prototype.readAndCheckSignature=function(e){return e===this.readData(4)},i.prototype.readData=function(e){this.checkOffset(e);var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./DataReader":18}],21:[function(e,t,r){"use strict";var n=e("./ArrayReader");function i(e){n.call(this,e)}e("../utils").inherits(i,n),i.prototype.readData=function(e){if(this.checkOffset(e),0===e)return new Uint8Array(0);var t=this.data.subarray(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./ArrayReader":17}],22:[function(e,t,r){"use strict";var n=e("../utils"),i=e("../support"),s=e("./ArrayReader"),a=e("./StringReader"),o=e("./NodeBufferReader"),u=e("./Uint8ArrayReader");t.exports=function(e){var t=n.getTypeOf(e);return n.checkSupport(t),"string"!==t||i.uint8array?"nodebuffer"===t?new o(e):i.uint8array?new u(n.transformTo("uint8array",e)):new s(n.transformTo("array",e)):new a(e)}},{"../support":30,"../utils":32,"./ArrayReader":17,"./NodeBufferReader":19,"./StringReader":20,"./Uint8ArrayReader":21}],23:[function(e,t,r){"use strict";r.LOCAL_FILE_HEADER="PK",r.CENTRAL_FILE_HEADER="PK",r.CENTRAL_DIRECTORY_END="PK",r.ZIP64_CENTRAL_DIRECTORY_LOCATOR="PK",r.ZIP64_CENTRAL_DIRECTORY_END="PK",r.DATA_DESCRIPTOR="PK\b"},{}],24:[function(e,t,r){"use strict";var n=e("./GenericWorker"),i=e("../utils");function s(e){n.call(this,"ConvertWorker to "+e),this.destType=e}i.inherits(s,n),s.prototype.processChunk=function(e){this.push({data:i.transformTo(this.destType,e.data),meta:e.meta})},t.exports=s},{"../utils":32,"./GenericWorker":28}],25:[function(e,t,r){"use strict";var n=e("./GenericWorker"),i=e("../crc32");function s(){n.call(this,"Crc32Probe"),this.withStreamInfo("crc32",0)}e("../utils").inherits(s,n),s.prototype.processChunk=function(e){this.streamInfo.crc32=i(e.data,this.streamInfo.crc32||0),this.push(e)},t.exports=s},{"../crc32":4,"../utils":32,"./GenericWorker":28}],26:[function(e,t,r){"use strict";var n=e("../utils"),i=e("./GenericWorker");function s(e){i.call(this,"DataLengthProbe for "+e),this.propName=e,this.withStreamInfo(e,0)}n.inherits(s,i),s.prototype.processChunk=function(e){if(e){var t=this.streamInfo[this.propName]||0;this.streamInfo[this.propName]=t+e.data.length}i.prototype.processChunk.call(this,e)},t.exports=s},{"../utils":32,"./GenericWorker":28}],27:[function(e,t,r){"use strict";var n=e("../utils"),i=e("./GenericWorker");function s(e){i.call(this,"DataWorker");var t=this;this.dataIsReady=!1,this.index=0,this.max=0,this.data=null,this.type="",this._tickScheduled=!1,e.then(function(e){t.dataIsReady=!0,t.data=e,t.max=e&&e.length||0,t.type=n.getTypeOf(e),t.isPaused||t._tickAndRepeat()},function(e){t.error(e)})}n.inherits(s,i),s.prototype.cleanUp=function(){i.prototype.cleanUp.call(this),this.data=null},s.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(!this._tickScheduled&&this.dataIsReady&&(this._tickScheduled=!0,n.delay(this._tickAndRepeat,[],this)),!0)},s.prototype._tickAndRepeat=function(){this._tickScheduled=!1,this.isPaused||this.isFinished||(this._tick(),this.isFinished||(n.delay(this._tickAndRepeat,[],this),this._tickScheduled=!0))},s.prototype._tick=function(){if(this.isPaused||this.isFinished)return!1;var e=null,t=Math.min(this.max,this.index+16384);if(this.index>=this.max)return this.end();switch(this.type){case"string":e=this.data.substring(this.index,t);break;case"uint8array":e=this.data.subarray(this.index,t);break;case"array":case"nodebuffer":e=this.data.slice(this.index,t)}return this.index=t,this.push({data:e,meta:{percent:this.max?this.index/this.max*100:0}})},t.exports=s},{"../utils":32,"./GenericWorker":28}],28:[function(e,t,r){"use strict";function n(e){this.name=e||"default",this.streamInfo={},this.generatedError=null,this.extraStreamInfo={},this.isPaused=!0,this.isFinished=!1,this.isLocked=!1,this._listeners={data:[],end:[],error:[]},this.previous=null}n.prototype={push:function(e){this.emit("data",e)},end:function(){if(this.isFinished)return!1;this.flush();try{this.emit("end"),this.cleanUp(),this.isFinished=!0}catch(e){this.emit("error",e)}return!0},error:function(e){return!this.isFinished&&(this.isPaused?this.generatedError=e:(this.isFinished=!0,this.emit("error",e),this.previous&&this.previous.error(e),this.cleanUp()),!0)},on:function(e,t){return this._listeners[e].push(t),this},cleanUp:function(){this.streamInfo=this.generatedError=this.extraStreamInfo=null,this._listeners=[]},emit:function(e,t){if(this._listeners[e])for(var r=0;r<this._listeners[e].length;r++)this._listeners[e][r].call(this,t)},pipe:function(e){return e.registerPrevious(this)},registerPrevious:function(e){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.streamInfo=e.streamInfo,this.mergeStreamInfo(),this.previous=e;var t=this;return e.on("data",function(e){t.processChunk(e)}),e.on("end",function(){t.end()}),e.on("error",function(e){t.error(e)}),this},pause:function(){return!this.isPaused&&!this.isFinished&&(this.isPaused=!0,this.previous&&this.previous.pause(),!0)},resume:function(){if(!this.isPaused||this.isFinished)return!1;var e=this.isPaused=!1;return this.generatedError&&(this.error(this.generatedError),e=!0),this.previous&&this.previous.resume(),!e},flush:function(){},processChunk:function(e){this.push(e)},withStreamInfo:function(e,t){return this.extraStreamInfo[e]=t,this.mergeStreamInfo(),this},mergeStreamInfo:function(){for(var e in this.extraStreamInfo)this.extraStreamInfo.hasOwnProperty(e)&&(this.streamInfo[e]=this.extraStreamInfo[e])},lock:function(){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.isLocked=!0,this.previous&&this.previous.lock()},toString:function(){var e="Worker "+this.name;return this.previous?this.previous+" -> "+e:e}},t.exports=n},{}],29:[function(e,t,r){"use strict";var h=e("../utils"),i=e("./ConvertWorker"),s=e("./GenericWorker"),f=e("../base64"),n=e("../support"),a=e("../external"),o=null;if(n.nodestream)try{o=e("../nodejs/NodejsStreamOutputAdapter")}catch(e){}function u(e,t,r){var n=t;switch(t){case"blob":case"arraybuffer":n="uint8array";break;case"base64":n="string"}try{this._internalType=n,this._outputType=t,this._mimeType=r,h.checkSupport(n),this._worker=e.pipe(new i(n)),e.lock()}catch(e){this._worker=new s("error"),this._worker.error(e)}}u.prototype={accumulate:function(e){return o=this,u=e,new a.Promise(function(t,r){var n=[],i=o._internalType,s=o._outputType,a=o._mimeType;o.on("data",function(e,t){n.push(e),u&&u(t)}).on("error",function(e){n=[],r(e)}).on("end",function(){try{var e=function(e,t,r){switch(e){case"blob":return h.newBlob(h.transformTo("arraybuffer",t),r);case"base64":return f.encode(t);default:return h.transformTo(e,t)}}(s,function(e,t){var r,n=0,i=null,s=0;for(r=0;r<t.length;r++)s+=t[r].length;switch(e){case"string":return t.join("");case"array":return Array.prototype.concat.apply([],t);case"uint8array":for(i=new Uint8Array(s),r=0;r<t.length;r++)i.set(t[r],n),n+=t[r].length;return i;case"nodebuffer":return Buffer.concat(t);default:throw new Error("concat : unsupported type '"+e+"'")}}(i,n),a);t(e)}catch(e){r(e)}n=[]}).resume()});var o,u},on:function(e,t){var r=this;return"data"===e?this._worker.on(e,function(e){t.call(r,e.data,e.meta)}):this._worker.on(e,function(){h.delay(t,arguments,r)}),this},resume:function(){return h.delay(this._worker.resume,[],this._worker),this},pause:function(){return this._worker.pause(),this},toNodejsStream:function(e){if(h.checkSupport("nodestream"),"nodebuffer"!==this._outputType)throw new Error(this._outputType+" is not supported by this method");return new o(this,{objectMode:"nodebuffer"!==this._outputType},e)}},t.exports=u},{"../base64":1,"../external":6,"../nodejs/NodejsStreamOutputAdapter":13,"../support":30,"../utils":32,"./ConvertWorker":24,"./GenericWorker":28}],30:[function(e,t,r){"use strict";if(r.base64=!0,r.array=!0,r.string=!0,r.arraybuffer="undefined"!=typeof ArrayBuffer&&"undefined"!=typeof Uint8Array,r.nodebuffer="undefined"!=typeof Buffer,r.uint8array="undefined"!=typeof Uint8Array,"undefined"==typeof ArrayBuffer)r.blob=!1;else{var n=new ArrayBuffer(0);try{r.blob=0===new Blob([n],{type:"application/zip"}).size}catch(e){try{var i=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);i.append(n),r.blob=0===i.getBlob("application/zip").size}catch(e){r.blob=!1}}}try{r.nodestream=!!e("readable-stream").Readable}catch(e){r.nodestream=!1}},{"readable-stream":16}],31:[function(e,t,s){"use strict";for(var o=e("./utils"),u=e("./support"),r=e("./nodejsUtils"),n=e("./stream/GenericWorker"),h=new Array(256),i=0;i<256;i++)h[i]=252<=i?6:248<=i?5:240<=i?4:224<=i?3:192<=i?2:1;function a(){n.call(this,"utf-8 decode"),this.leftOver=null}function f(){n.call(this,"utf-8 encode")}h[254]=h[254]=1,s.utf8encode=function(e){return u.nodebuffer?r.newBufferFrom(e,"utf-8"):function(e){var t,r,n,i,s,a=e.length,o=0;for(i=0;i<a;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),o+=r<128?1:r<2048?2:r<65536?3:4;for(t=u.uint8array?new Uint8Array(o):new Array(o),i=s=0;s<o;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),r<128?t[s++]=r:(r<2048?t[s++]=192|r>>>6:(r<65536?t[s++]=224|r>>>12:(t[s++]=240|r>>>18,t[s++]=128|r>>>12&63),t[s++]=128|r>>>6&63),t[s++]=128|63&r);return t}(e)},s.utf8decode=function(e){return u.nodebuffer?o.transformTo("nodebuffer",e).toString("utf-8"):function(e){var t,r,n,i,s=e.length,a=new Array(2*s);for(t=r=0;t<s;)if((n=e[t++])<128)a[r++]=n;else if(4<(i=h[n]))a[r++]=65533,t+=i-1;else{for(n&=2===i?31:3===i?15:7;1<i&&t<s;)n=n<<6|63&e[t++],i--;1<i?a[r++]=65533:n<65536?a[r++]=n:(n-=65536,a[r++]=55296|n>>10&1023,a[r++]=56320|1023&n)}return a.length!==r&&(a.subarray?a=a.subarray(0,r):a.length=r),o.applyFromCharCode(a)}(e=o.transformTo(u.uint8array?"uint8array":"array",e))},o.inherits(a,n),a.prototype.processChunk=function(e){var t=o.transformTo(u.uint8array?"uint8array":"array",e.data);if(this.leftOver&&this.leftOver.length){if(u.uint8array){var r=t;(t=new Uint8Array(r.length+this.leftOver.length)).set(this.leftOver,0),t.set(r,this.leftOver.length)}else t=this.leftOver.concat(t);this.leftOver=null}var n=function(e,t){var r;for((t=t||e.length)>e.length&&(t=e.length),r=t-1;0<=r&&128==(192&e[r]);)r--;return r<0?t:0===r?t:r+h[e[r]]>t?r:t}(t),i=t;n!==t.length&&(u.uint8array?(i=t.subarray(0,n),this.leftOver=t.subarray(n,t.length)):(i=t.slice(0,n),this.leftOver=t.slice(n,t.length))),this.push({data:s.utf8decode(i),meta:e.meta})},a.prototype.flush=function(){this.leftOver&&this.leftOver.length&&(this.push({data:s.utf8decode(this.leftOver),meta:{}}),this.leftOver=null)},s.Utf8DecodeWorker=a,o.inherits(f,n),f.prototype.processChunk=function(e){this.push({data:s.utf8encode(e.data),meta:e.meta})},s.Utf8EncodeWorker=f},{"./nodejsUtils":14,"./stream/GenericWorker":28,"./support":30,"./utils":32}],32:[function(e,t,o){"use strict";var u=e("./support"),h=e("./base64"),r=e("./nodejsUtils"),n=e("set-immediate-shim"),f=e("./external");function i(e){return e}function l(e,t){for(var r=0;r<e.length;++r)t[r]=255&e.charCodeAt(r);return t}o.newBlob=function(t,r){o.checkSupport("blob");try{return new Blob([t],{type:r})}catch(e){try{var n=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);return n.append(t),n.getBlob(r)}catch(e){throw new Error("Bug : can't construct the Blob.")}}};var s={stringifyByChunk:function(e,t,r){var n=[],i=0,s=e.length;if(s<=r)return String.fromCharCode.apply(null,e);for(;i<s;)"array"===t||"nodebuffer"===t?n.push(String.fromCharCode.apply(null,e.slice(i,Math.min(i+r,s)))):n.push(String.fromCharCode.apply(null,e.subarray(i,Math.min(i+r,s)))),i+=r;return n.join("")},stringifyByChar:function(e){for(var t="",r=0;r<e.length;r++)t+=String.fromCharCode(e[r]);return t},applyCanBeUsed:{uint8array:function(){try{return u.uint8array&&1===String.fromCharCode.apply(null,new Uint8Array(1)).length}catch(e){return!1}}(),nodebuffer:function(){try{return u.nodebuffer&&1===String.fromCharCode.apply(null,r.allocBuffer(1)).length}catch(e){return!1}}()}};function a(e){var t=65536,r=o.getTypeOf(e),n=!0;if("uint8array"===r?n=s.applyCanBeUsed.uint8array:"nodebuffer"===r&&(n=s.applyCanBeUsed.nodebuffer),n)for(;1<t;)try{return s.stringifyByChunk(e,r,t)}catch(e){t=Math.floor(t/2)}return s.stringifyByChar(e)}function d(e,t){for(var r=0;r<e.length;r++)t[r]=e[r];return t}o.applyFromCharCode=a;var c={};c.string={string:i,array:function(e){return l(e,new Array(e.length))},arraybuffer:function(e){return c.string.uint8array(e).buffer},uint8array:function(e){return l(e,new Uint8Array(e.length))},nodebuffer:function(e){return l(e,r.allocBuffer(e.length))}},c.array={string:a,array:i,arraybuffer:function(e){return new Uint8Array(e).buffer},uint8array:function(e){return new Uint8Array(e)},nodebuffer:function(e){return r.newBufferFrom(e)}},c.arraybuffer={string:function(e){return a(new Uint8Array(e))},array:function(e){return d(new Uint8Array(e),new Array(e.byteLength))},arraybuffer:i,uint8array:function(e){return new Uint8Array(e)},nodebuffer:function(e){return r.newBufferFrom(new Uint8Array(e))}},c.uint8array={string:a,array:function(e){return d(e,new Array(e.length))},arraybuffer:function(e){return e.buffer},uint8array:i,nodebuffer:function(e){return r.newBufferFrom(e)}},c.nodebuffer={string:a,array:function(e){return d(e,new Array(e.length))},arraybuffer:function(e){return c.nodebuffer.uint8array(e).buffer},uint8array:function(e){return d(e,new Uint8Array(e.length))},nodebuffer:i},o.transformTo=function(e,t){if(t=t||"",!e)return t;o.checkSupport(e);var r=o.getTypeOf(t);return c[r][e](t)},o.getTypeOf=function(e){return"string"==typeof e?"string":"[object Array]"===Object.prototype.toString.call(e)?"array":u.nodebuffer&&r.isBuffer(e)?"nodebuffer":u.uint8array&&e instanceof Uint8Array?"uint8array":u.arraybuffer&&e instanceof ArrayBuffer?"arraybuffer":void 0},o.checkSupport=function(e){if(!u[e.toLowerCase()])throw new Error(e+" is not supported by this platform")},o.MAX_VALUE_16BITS=65535,o.MAX_VALUE_32BITS=-1,o.pretty=function(e){var t,r,n="";for(r=0;r<(e||"").length;r++)n+="\\x"+((t=e.charCodeAt(r))<16?"0":"")+t.toString(16).toUpperCase();return n},o.delay=function(e,t,r){n(function(){e.apply(r||null,t||[])})},o.inherits=function(e,t){function r(){}r.prototype=t.prototype,e.prototype=new r},o.extend=function(){var e,t,r={};for(e=0;e<arguments.length;e++)for(t in arguments[e])arguments[e].hasOwnProperty(t)&&void 0===r[t]&&(r[t]=arguments[e][t]);return r},o.prepareContent=function(n,e,i,s,a){return f.Promise.resolve(e).then(function(n){return u.blob&&(n instanceof Blob||-1!==["[object File]","[object Blob]"].indexOf(Object.prototype.toString.call(n)))&&"undefined"!=typeof FileReader?new f.Promise(function(t,r){var e=new FileReader;e.onload=function(e){t(e.target.result)},e.onerror=function(e){r(e.target.error)},e.readAsArrayBuffer(n)}):n}).then(function(e){var t,r=o.getTypeOf(e);return r?("arraybuffer"===r?e=o.transformTo("uint8array",e):"string"===r&&(a?e=h.decode(e):i&&!0!==s&&(e=l(t=e,u.uint8array?new Uint8Array(t.length):new Array(t.length)))),e):f.Promise.reject(new Error("Can't read the data of '"+n+"'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"))})}},{"./base64":1,"./external":6,"./nodejsUtils":14,"./support":30,"set-immediate-shim":54}],33:[function(e,t,r){"use strict";var n=e("./reader/readerFor"),i=e("./utils"),s=e("./signature"),a=e("./zipEntry"),o=(e("./utf8"),e("./support"));function u(e){this.files=[],this.loadOptions=e}u.prototype={checkSignature:function(e){if(!this.reader.readAndCheckSignature(e)){this.reader.index-=4;var t=this.reader.readString(4);throw new Error("Corrupted zip or bug: unexpected signature ("+i.pretty(t)+", expected "+i.pretty(e)+")")}},isSignature:function(e,t){var r=this.reader.index;this.reader.setIndex(e);var n=this.reader.readString(4)===t;return this.reader.setIndex(r),n},readBlockEndOfCentral:function(){this.diskNumber=this.reader.readInt(2),this.diskWithCentralDirStart=this.reader.readInt(2),this.centralDirRecordsOnThisDisk=this.reader.readInt(2),this.centralDirRecords=this.reader.readInt(2),this.centralDirSize=this.reader.readInt(4),this.centralDirOffset=this.reader.readInt(4),this.zipCommentLength=this.reader.readInt(2);var e=this.reader.readData(this.zipCommentLength),t=o.uint8array?"uint8array":"array",r=i.transformTo(t,e);this.zipComment=this.loadOptions.decodeFileName(r)},readBlockZip64EndOfCentral:function(){this.zip64EndOfCentralSize=this.reader.readInt(8),this.reader.skip(4),this.diskNumber=this.reader.readInt(4),this.diskWithCentralDirStart=this.reader.readInt(4),this.centralDirRecordsOnThisDisk=this.reader.readInt(8),this.centralDirRecords=this.reader.readInt(8),this.centralDirSize=this.reader.readInt(8),this.centralDirOffset=this.reader.readInt(8),this.zip64ExtensibleData={};for(var e,t,r,n=this.zip64EndOfCentralSize-44;0<n;)e=this.reader.readInt(2),t=this.reader.readInt(4),r=this.reader.readData(t),this.zip64ExtensibleData[e]={id:e,length:t,value:r}},readBlockZip64EndOfCentralLocator:function(){if(this.diskWithZip64CentralDirStart=this.reader.readInt(4),this.relativeOffsetEndOfZip64CentralDir=this.reader.readInt(8),this.disksCount=this.reader.readInt(4),1<this.disksCount)throw new Error("Multi-volumes zip are not supported")},readLocalFiles:function(){var e,t;for(e=0;e<this.files.length;e++)t=this.files[e],this.reader.setIndex(t.localHeaderOffset),this.checkSignature(s.LOCAL_FILE_HEADER),t.readLocalPart(this.reader),t.handleUTF8(),t.processAttributes()},readCentralDir:function(){var e;for(this.reader.setIndex(this.centralDirOffset);this.reader.readAndCheckSignature(s.CENTRAL_FILE_HEADER);)(e=new a({zip64:this.zip64},this.loadOptions)).readCentralPart(this.reader),this.files.push(e);if(this.centralDirRecords!==this.files.length&&0!==this.centralDirRecords&&0===this.files.length)throw new Error("Corrupted zip or bug: expected "+this.centralDirRecords+" records in central dir, got "+this.files.length)},readEndOfCentral:function(){var e=this.reader.lastIndexOfSignature(s.CENTRAL_DIRECTORY_END);if(e<0)throw this.isSignature(0,s.LOCAL_FILE_HEADER)?new Error("Corrupted zip: can't find end of central directory"):new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html");this.reader.setIndex(e);var t=e;if(this.checkSignature(s.CENTRAL_DIRECTORY_END),this.readBlockEndOfCentral(),this.diskNumber===i.MAX_VALUE_16BITS||this.diskWithCentralDirStart===i.MAX_VALUE_16BITS||this.centralDirRecordsOnThisDisk===i.MAX_VALUE_16BITS||this.centralDirRecords===i.MAX_VALUE_16BITS||this.centralDirSize===i.MAX_VALUE_32BITS||this.centralDirOffset===i.MAX_VALUE_32BITS){if(this.zip64=!0,(e=this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR))<0)throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");if(this.reader.setIndex(e),this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR),this.readBlockZip64EndOfCentralLocator(),!this.isSignature(this.relativeOffsetEndOfZip64CentralDir,s.ZIP64_CENTRAL_DIRECTORY_END)&&(this.relativeOffsetEndOfZip64CentralDir=this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_END),this.relativeOffsetEndOfZip64CentralDir<0))throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir),this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_END),this.readBlockZip64EndOfCentral()}var r=this.centralDirOffset+this.centralDirSize;this.zip64&&(r+=20,r+=12+this.zip64EndOfCentralSize);var n=t-r;if(0<n)this.isSignature(t,s.CENTRAL_FILE_HEADER)||(this.reader.zero=n);else if(n<0)throw new Error("Corrupted zip: missing "+Math.abs(n)+" bytes.")},prepareReader:function(e){this.reader=n(e)},load:function(e){this.prepareReader(e),this.readEndOfCentral(),this.readCentralDir(),this.readLocalFiles()}},t.exports=u},{"./reader/readerFor":22,"./signature":23,"./support":30,"./utf8":31,"./utils":32,"./zipEntry":34}],34:[function(e,t,r){"use strict";var n=e("./reader/readerFor"),s=e("./utils"),i=e("./compressedObject"),a=e("./crc32"),o=e("./utf8"),u=e("./compressions"),h=e("./support");function f(e,t){this.options=e,this.loadOptions=t}f.prototype={isEncrypted:function(){return 1==(1&this.bitFlag)},useUTF8:function(){return 2048==(2048&this.bitFlag)},readLocalPart:function(e){var t,r;if(e.skip(22),this.fileNameLength=e.readInt(2),r=e.readInt(2),this.fileName=e.readData(this.fileNameLength),e.skip(r),-1===this.compressedSize||-1===this.uncompressedSize)throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");if(null===(t=function(e){for(var t in u)if(u.hasOwnProperty(t)&&u[t].magic===e)return u[t];return null}(this.compressionMethod)))throw new Error("Corrupted zip : compression "+s.pretty(this.compressionMethod)+" unknown (inner file : "+s.transformTo("string",this.fileName)+")");this.decompressed=new i(this.compressedSize,this.uncompressedSize,this.crc32,t,e.readData(this.compressedSize))},readCentralPart:function(e){this.versionMadeBy=e.readInt(2),e.skip(2),this.bitFlag=e.readInt(2),this.compressionMethod=e.readString(2),this.date=e.readDate(),this.crc32=e.readInt(4),this.compressedSize=e.readInt(4),this.uncompressedSize=e.readInt(4);var t=e.readInt(2);if(this.extraFieldsLength=e.readInt(2),this.fileCommentLength=e.readInt(2),this.diskNumberStart=e.readInt(2),this.internalFileAttributes=e.readInt(2),this.externalFileAttributes=e.readInt(4),this.localHeaderOffset=e.readInt(4),this.isEncrypted())throw new Error("Encrypted zip are not supported");e.skip(t),this.readExtraFields(e),this.parseZIP64ExtraField(e),this.fileComment=e.readData(this.fileCommentLength)},processAttributes:function(){this.unixPermissions=null,this.dosPermissions=null;var e=this.versionMadeBy>>8;this.dir=!!(16&this.externalFileAttributes),0==e&&(this.dosPermissions=63&this.externalFileAttributes),3==e&&(this.unixPermissions=this.externalFileAttributes>>16&65535),this.dir||"/"!==this.fileNameStr.slice(-1)||(this.dir=!0)},parseZIP64ExtraField:function(e){if(this.extraFields[1]){var t=n(this.extraFields[1].value);this.uncompressedSize===s.MAX_VALUE_32BITS&&(this.uncompressedSize=t.readInt(8)),this.compressedSize===s.MAX_VALUE_32BITS&&(this.compressedSize=t.readInt(8)),this.localHeaderOffset===s.MAX_VALUE_32BITS&&(this.localHeaderOffset=t.readInt(8)),this.diskNumberStart===s.MAX_VALUE_32BITS&&(this.diskNumberStart=t.readInt(4))}},readExtraFields:function(e){var t,r,n,i=e.index+this.extraFieldsLength;for(this.extraFields||(this.extraFields={});e.index+4<i;)t=e.readInt(2),r=e.readInt(2),n=e.readData(r),this.extraFields[t]={id:t,length:r,value:n};e.setIndex(i)},handleUTF8:function(){var e=h.uint8array?"uint8array":"array";if(this.useUTF8())this.fileNameStr=o.utf8decode(this.fileName),this.fileCommentStr=o.utf8decode(this.fileComment);else{var t=this.findExtraFieldUnicodePath();if(null!==t)this.fileNameStr=t;else{var r=s.transformTo(e,this.fileName);this.fileNameStr=this.loadOptions.decodeFileName(r)}var n=this.findExtraFieldUnicodeComment();if(null!==n)this.fileCommentStr=n;else{var i=s.transformTo(e,this.fileComment);this.fileCommentStr=this.loadOptions.decodeFileName(i)}}},findExtraFieldUnicodePath:function(){var e=this.extraFields[28789];if(e){var t=n(e.value);return 1!==t.readInt(1)?null:a(this.fileName)!==t.readInt(4)?null:o.utf8decode(t.readData(e.length-5))}return null},findExtraFieldUnicodeComment:function(){var e=this.extraFields[25461];if(e){var t=n(e.value);return 1!==t.readInt(1)?null:a(this.fileComment)!==t.readInt(4)?null:o.utf8decode(t.readData(e.length-5))}return null}},t.exports=f},{"./compressedObject":2,"./compressions":3,"./crc32":4,"./reader/readerFor":22,"./support":30,"./utf8":31,"./utils":32}],35:[function(e,t,r){"use strict";function n(e,t,r){this.name=e,this.dir=r.dir,this.date=r.date,this.comment=r.comment,this.unixPermissions=r.unixPermissions,this.dosPermissions=r.dosPermissions,this._data=t,this._dataBinary=r.binary,this.options={compression:r.compression,compressionOptions:r.compressionOptions}}var s=e("./stream/StreamHelper"),i=e("./stream/DataWorker"),a=e("./utf8"),o=e("./compressedObject"),u=e("./stream/GenericWorker");n.prototype={internalStream:function(e){var t=null,r="string";try{if(!e)throw new Error("No output type specified.");var n="string"===(r=e.toLowerCase())||"text"===r;"binarystring"!==r&&"text"!==r||(r="string"),t=this._decompressWorker();var i=!this._dataBinary;i&&!n&&(t=t.pipe(new a.Utf8EncodeWorker)),!i&&n&&(t=t.pipe(new a.Utf8DecodeWorker))}catch(e){(t=new u("error")).error(e)}return new s(t,r,"")},async:function(e,t){return this.internalStream(e).accumulate(t)},nodeStream:function(e,t){return this.internalStream(e||"nodebuffer").toNodejsStream(t)},_compressWorker:function(e,t){if(this._data instanceof o&&this._data.compression.magic===e.magic)return this._data.getCompressedWorker();var r=this._decompressWorker();return this._dataBinary||(r=r.pipe(new a.Utf8EncodeWorker)),o.createWorkerFrom(r,e,t)},_decompressWorker:function(){return this._data instanceof o?this._data.getContentWorker():this._data instanceof u?this._data:new i(this._data)}};for(var h=["asText","asBinary","asNodeBuffer","asUint8Array","asArrayBuffer"],f=function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},l=0;l<h.length;l++)n.prototype[h[l]]=f;t.exports=n},{"./compressedObject":2,"./stream/DataWorker":27,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31}],36:[function(e,f,t){(function(t){"use strict";var r,n,e=t.MutationObserver||t.WebKitMutationObserver;if(e){var i=0,s=new e(h),a=t.document.createTextNode("");s.observe(a,{characterData:!0}),r=function(){a.data=i=++i%2}}else if(t.setImmediate||void 0===t.MessageChannel)r="document"in t&&"onreadystatechange"in t.document.createElement("script")?function(){var e=t.document.createElement("script");e.onreadystatechange=function(){h(),e.onreadystatechange=null,e.parentNode.removeChild(e),e=null},t.document.documentElement.appendChild(e)}:function(){setTimeout(h,0)};else{var o=new t.MessageChannel;o.port1.onmessage=h,r=function(){o.port2.postMessage(0)}}var u=[];function h(){var e,t;n=!0;for(var r=u.length;r;){for(t=u,u=[],e=-1;++e<r;)t[e]();r=u.length}n=!1}f.exports=function(e){1!==u.push(e)||n||r()}}).call(this,void 0!==r?r:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],37:[function(e,t,r){"use strict";var i=e("immediate");function h(){}var f={},s=["REJECTED"],a=["FULFILLED"],n=["PENDING"];function o(e){if("function"!=typeof e)throw new TypeError("resolver must be a function");this.state=n,this.queue=[],this.outcome=void 0,e!==h&&c(this,e)}function u(e,t,r){this.promise=e,"function"==typeof t&&(this.onFulfilled=t,this.callFulfilled=this.otherCallFulfilled),"function"==typeof r&&(this.onRejected=r,this.callRejected=this.otherCallRejected)}function l(t,r,n){i(function(){var e;try{e=r(n)}catch(e){return f.reject(t,e)}e===t?f.reject(t,new TypeError("Cannot resolve promise with itself")):f.resolve(t,e)})}function d(e){var t=e&&e.then;if(e&&("object"==typeof e||"function"==typeof e)&&"function"==typeof t)return function(){t.apply(e,arguments)}}function c(t,e){var r=!1;function n(e){r||(r=!0,f.reject(t,e))}function i(e){r||(r=!0,f.resolve(t,e))}var s=p(function(){e(i,n)});"error"===s.status&&n(s.value)}function p(e,t){var r={};try{r.value=e(t),r.status="success"}catch(e){r.status="error",r.value=e}return r}(t.exports=o).prototype.finally=function(t){if("function"!=typeof t)return this;var r=this.constructor;return this.then(function(e){return r.resolve(t()).then(function(){return e})},function(e){return r.resolve(t()).then(function(){throw e})})},o.prototype.catch=function(e){return this.then(null,e)},o.prototype.then=function(e,t){if("function"!=typeof e&&this.state===a||"function"!=typeof t&&this.state===s)return this;var r=new this.constructor(h);return this.state!==n?l(r,this.state===a?e:t,this.outcome):this.queue.push(new u(r,e,t)),r},u.prototype.callFulfilled=function(e){f.resolve(this.promise,e)},u.prototype.otherCallFulfilled=function(e){l(this.promise,this.onFulfilled,e)},u.prototype.callRejected=function(e){f.reject(this.promise,e)},u.prototype.otherCallRejected=function(e){l(this.promise,this.onRejected,e)},f.resolve=function(e,t){var r=p(d,t);if("error"===r.status)return f.reject(e,r.value);var n=r.value;if(n)c(e,n);else{e.state=a,e.outcome=t;for(var i=-1,s=e.queue.length;++i<s;)e.queue[i].callFulfilled(t)}return e},f.reject=function(e,t){e.state=s,e.outcome=t;for(var r=-1,n=e.queue.length;++r<n;)e.queue[r].callRejected(t);return e},o.resolve=function(e){return e instanceof this?e:f.resolve(new this(h),e)},o.reject=function(e){var t=new this(h);return f.reject(t,e)},o.all=function(e){var r=this;if("[object Array]"!==Object.prototype.toString.call(e))return this.reject(new TypeError("must be an array"));var n=e.length,i=!1;if(!n)return this.resolve([]);for(var s=new Array(n),a=0,t=-1,o=new this(h);++t<n;)u(e[t],t);return o;function u(e,t){r.resolve(e).then(function(e){s[t]=e,++a!==n||i||(i=!0,f.resolve(o,s))},function(e){i||(i=!0,f.reject(o,e))})}},o.race=function(e){if("[object Array]"!==Object.prototype.toString.call(e))return this.reject(new TypeError("must be an array"));var t=e.length,r=!1;if(!t)return this.resolve([]);for(var n,i=-1,s=new this(h);++i<t;)n=e[i],this.resolve(n).then(function(e){r||(r=!0,f.resolve(s,e))},function(e){r||(r=!0,f.reject(s,e))});return s}},{immediate:36}],38:[function(e,t,r){"use strict";var n={};(0,e("./lib/utils/common").assign)(n,e("./lib/deflate"),e("./lib/inflate"),e("./lib/zlib/constants")),t.exports=n},{"./lib/deflate":39,"./lib/inflate":40,"./lib/utils/common":41,"./lib/zlib/constants":44}],39:[function(e,t,r){"use strict";var a=e("./zlib/deflate"),o=e("./utils/common"),u=e("./utils/strings"),i=e("./zlib/messages"),s=e("./zlib/zstream"),h=Object.prototype.toString,f=0,l=-1,d=0,c=8;function p(e){if(!(this instanceof p))return new p(e);this.options=o.assign({level:l,method:c,chunkSize:16384,windowBits:15,memLevel:8,strategy:d,to:""},e||{});var t=this.options;t.raw&&0<t.windowBits?t.windowBits=-t.windowBits:t.gzip&&0<t.windowBits&&t.windowBits<16&&(t.windowBits+=16),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new s,this.strm.avail_out=0;var r=a.deflateInit2(this.strm,t.level,t.method,t.windowBits,t.memLevel,t.strategy);if(r!==f)throw new Error(i[r]);if(t.header&&a.deflateSetHeader(this.strm,t.header),t.dictionary){var n;if(n="string"==typeof t.dictionary?u.string2buf(t.dictionary):"[object ArrayBuffer]"===h.call(t.dictionary)?new Uint8Array(t.dictionary):t.dictionary,(r=a.deflateSetDictionary(this.strm,n))!==f)throw new Error(i[r]);this._dict_set=!0}}function n(e,t){var r=new p(t);if(r.push(e,!0),r.err)throw r.msg||i[r.err];return r.result}p.prototype.push=function(e,t){var r,n,i=this.strm,s=this.options.chunkSize;if(this.ended)return!1;n=t===~~t?t:!0===t?4:0,"string"==typeof e?i.input=u.string2buf(e):"[object ArrayBuffer]"===h.call(e)?i.input=new Uint8Array(e):i.input=e,i.next_in=0,i.avail_in=i.input.length;do{if(0===i.avail_out&&(i.output=new o.Buf8(s),i.next_out=0,i.avail_out=s),1!==(r=a.deflate(i,n))&&r!==f)return this.onEnd(r),!(this.ended=!0);0!==i.avail_out&&(0!==i.avail_in||4!==n&&2!==n)||("string"===this.options.to?this.onData(u.buf2binstring(o.shrinkBuf(i.output,i.next_out))):this.onData(o.shrinkBuf(i.output,i.next_out)))}while((0<i.avail_in||0===i.avail_out)&&1!==r);return 4===n?(r=a.deflateEnd(this.strm),this.onEnd(r),this.ended=!0,r===f):2!==n||(this.onEnd(f),!(i.avail_out=0))},p.prototype.onData=function(e){this.chunks.push(e)},p.prototype.onEnd=function(e){e===f&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=o.flattenChunks(this.chunks)),this.chunks=[],this.err=e,this.msg=this.strm.msg},r.Deflate=p,r.deflate=n,r.deflateRaw=function(e,t){return(t=t||{}).raw=!0,n(e,t)},r.gzip=function(e,t){return(t=t||{}).gzip=!0,n(e,t)}},{"./utils/common":41,"./utils/strings":42,"./zlib/deflate":46,"./zlib/messages":51,"./zlib/zstream":53}],40:[function(e,t,r){"use strict";var d=e("./zlib/inflate"),c=e("./utils/common"),p=e("./utils/strings"),m=e("./zlib/constants"),n=e("./zlib/messages"),i=e("./zlib/zstream"),s=e("./zlib/gzheader"),_=Object.prototype.toString;function a(e){if(!(this instanceof a))return new a(e);this.options=c.assign({chunkSize:16384,windowBits:0,to:""},e||{});var t=this.options;t.raw&&0<=t.windowBits&&t.windowBits<16&&(t.windowBits=-t.windowBits,0===t.windowBits&&(t.windowBits=-15)),!(0<=t.windowBits&&t.windowBits<16)||e&&e.windowBits||(t.windowBits+=32),15<t.windowBits&&t.windowBits<48&&0==(15&t.windowBits)&&(t.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new i,this.strm.avail_out=0;var r=d.inflateInit2(this.strm,t.windowBits);if(r!==m.Z_OK)throw new Error(n[r]);this.header=new s,d.inflateGetHeader(this.strm,this.header)}function o(e,t){var r=new a(t);if(r.push(e,!0),r.err)throw r.msg||n[r.err];return r.result}a.prototype.push=function(e,t){var r,n,i,s,a,o,u=this.strm,h=this.options.chunkSize,f=this.options.dictionary,l=!1;if(this.ended)return!1;n=t===~~t?t:!0===t?m.Z_FINISH:m.Z_NO_FLUSH,"string"==typeof e?u.input=p.binstring2buf(e):"[object ArrayBuffer]"===_.call(e)?u.input=new Uint8Array(e):u.input=e,u.next_in=0,u.avail_in=u.input.length;do{if(0===u.avail_out&&(u.output=new c.Buf8(h),u.next_out=0,u.avail_out=h),(r=d.inflate(u,m.Z_NO_FLUSH))===m.Z_NEED_DICT&&f&&(o="string"==typeof f?p.string2buf(f):"[object ArrayBuffer]"===_.call(f)?new Uint8Array(f):f,r=d.inflateSetDictionary(this.strm,o)),r===m.Z_BUF_ERROR&&!0===l&&(r=m.Z_OK,l=!1),r!==m.Z_STREAM_END&&r!==m.Z_OK)return this.onEnd(r),!(this.ended=!0);u.next_out&&(0!==u.avail_out&&r!==m.Z_STREAM_END&&(0!==u.avail_in||n!==m.Z_FINISH&&n!==m.Z_SYNC_FLUSH)||("string"===this.options.to?(i=p.utf8border(u.output,u.next_out),s=u.next_out-i,a=p.buf2string(u.output,i),u.next_out=s,u.avail_out=h-s,s&&c.arraySet(u.output,u.output,i,s,0),this.onData(a)):this.onData(c.shrinkBuf(u.output,u.next_out)))),0===u.avail_in&&0===u.avail_out&&(l=!0)}while((0<u.avail_in||0===u.avail_out)&&r!==m.Z_STREAM_END);return r===m.Z_STREAM_END&&(n=m.Z_FINISH),n===m.Z_FINISH?(r=d.inflateEnd(this.strm),this.onEnd(r),this.ended=!0,r===m.Z_OK):n!==m.Z_SYNC_FLUSH||(this.onEnd(m.Z_OK),!(u.avail_out=0))},a.prototype.onData=function(e){this.chunks.push(e)},a.prototype.onEnd=function(e){e===m.Z_OK&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=c.flattenChunks(this.chunks)),this.chunks=[],this.err=e,this.msg=this.strm.msg},r.Inflate=a,r.inflate=o,r.inflateRaw=function(e,t){return(t=t||{}).raw=!0,o(e,t)},r.ungzip=o},{"./utils/common":41,"./utils/strings":42,"./zlib/constants":44,"./zlib/gzheader":47,"./zlib/inflate":49,"./zlib/messages":51,"./zlib/zstream":53}],41:[function(e,t,r){"use strict";var n="undefined"!=typeof Uint8Array&&"undefined"!=typeof Uint16Array&&"undefined"!=typeof Int32Array;r.assign=function(e){for(var t=Array.prototype.slice.call(arguments,1);t.length;){var r=t.shift();if(r){if("object"!=typeof r)throw new TypeError(r+"must be non-object");for(var n in r)r.hasOwnProperty(n)&&(e[n]=r[n])}}return e},r.shrinkBuf=function(e,t){return e.length===t?e:e.subarray?e.subarray(0,t):(e.length=t,e)};var i={arraySet:function(e,t,r,n,i){if(t.subarray&&e.subarray)e.set(t.subarray(r,r+n),i);else for(var s=0;s<n;s++)e[i+s]=t[r+s]},flattenChunks:function(e){var t,r,n,i,s,a;for(t=n=0,r=e.length;t<r;t++)n+=e[t].length;for(a=new Uint8Array(n),t=i=0,r=e.length;t<r;t++)s=e[t],a.set(s,i),i+=s.length;return a}},s={arraySet:function(e,t,r,n,i){for(var s=0;s<n;s++)e[i+s]=t[r+s]},flattenChunks:function(e){return[].concat.apply([],e)}};r.setTyped=function(e){e?(r.Buf8=Uint8Array,r.Buf16=Uint16Array,r.Buf32=Int32Array,r.assign(r,i)):(r.Buf8=Array,r.Buf16=Array,r.Buf32=Array,r.assign(r,s))},r.setTyped(n)},{}],42:[function(e,t,r){"use strict";var u=e("./common"),i=!0,s=!0;try{String.fromCharCode.apply(null,[0])}catch(e){i=!1}try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(e){s=!1}for(var h=new u.Buf8(256),n=0;n<256;n++)h[n]=252<=n?6:248<=n?5:240<=n?4:224<=n?3:192<=n?2:1;function f(e,t){if(t<65537&&(e.subarray&&s||!e.subarray&&i))return String.fromCharCode.apply(null,u.shrinkBuf(e,t));for(var r="",n=0;n<t;n++)r+=String.fromCharCode(e[n]);return r}h[254]=h[254]=1,r.string2buf=function(e){var t,r,n,i,s,a=e.length,o=0;for(i=0;i<a;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),o+=r<128?1:r<2048?2:r<65536?3:4;for(t=new u.Buf8(o),i=s=0;s<o;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),r<128?t[s++]=r:(r<2048?t[s++]=192|r>>>6:(r<65536?t[s++]=224|r>>>12:(t[s++]=240|r>>>18,t[s++]=128|r>>>12&63),t[s++]=128|r>>>6&63),t[s++]=128|63&r);return t},r.buf2binstring=function(e){return f(e,e.length)},r.binstring2buf=function(e){for(var t=new u.Buf8(e.length),r=0,n=t.length;r<n;r++)t[r]=e.charCodeAt(r);return t},r.buf2string=function(e,t){var r,n,i,s,a=t||e.length,o=new Array(2*a);for(r=n=0;r<a;)if((i=e[r++])<128)o[n++]=i;else if(4<(s=h[i]))o[n++]=65533,r+=s-1;else{for(i&=2===s?31:3===s?15:7;1<s&&r<a;)i=i<<6|63&e[r++],s--;1<s?o[n++]=65533:i<65536?o[n++]=i:(i-=65536,o[n++]=55296|i>>10&1023,o[n++]=56320|1023&i)}return f(o,n)},r.utf8border=function(e,t){var r;for((t=t||e.length)>e.length&&(t=e.length),r=t-1;0<=r&&128==(192&e[r]);)r--;return r<0?t:0===r?t:r+h[e[r]]>t?r:t}},{"./common":41}],43:[function(e,t,r){"use strict";t.exports=function(e,t,r,n){for(var i=65535&e|0,s=e>>>16&65535|0,a=0;0!==r;){for(r-=a=2e3<r?2e3:r;s=s+(i=i+t[n++]|0)|0,--a;);i%=65521,s%=65521}return i|s<<16|0}},{}],44:[function(e,t,r){"use strict";t.exports={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8}},{}],45:[function(e,t,r){"use strict";var o=function(){for(var e,t=[],r=0;r<256;r++){e=r;for(var n=0;n<8;n++)e=1&e?3988292384^e>>>1:e>>>1;t[r]=e}return t}();t.exports=function(e,t,r,n){var i=o,s=n+r;e^=-1;for(var a=n;a<s;a++)e=e>>>8^i[255&(e^t[a])];return-1^e}},{}],46:[function(e,t,r){"use strict";var u,d=e("../utils/common"),h=e("./trees"),c=e("./adler32"),p=e("./crc32"),n=e("./messages"),f=0,l=0,m=-2,i=2,_=8,s=286,a=30,o=19,g=2*s+1,v=15,b=3,w=258,y=w+b+1,k=42,x=113;function S(e,t){return e.msg=n[t],t}function z(e){return(e<<1)-(4<e?9:0)}function E(e){for(var t=e.length;0<=--t;)e[t]=0}function C(e){var t=e.state,r=t.pending;r>e.avail_out&&(r=e.avail_out),0!==r&&(d.arraySet(e.output,t.pending_buf,t.pending_out,r,e.next_out),e.next_out+=r,t.pending_out+=r,e.total_out+=r,e.avail_out-=r,t.pending-=r,0===t.pending&&(t.pending_out=0))}function A(e,t){h._tr_flush_block(e,0<=e.block_start?e.block_start:-1,e.strstart-e.block_start,t),e.block_start=e.strstart,C(e.strm)}function I(e,t){e.pending_buf[e.pending++]=t}function O(e,t){e.pending_buf[e.pending++]=t>>>8&255,e.pending_buf[e.pending++]=255&t}function B(e,t){var r,n,i=e.max_chain_length,s=e.strstart,a=e.prev_length,o=e.nice_match,u=e.strstart>e.w_size-y?e.strstart-(e.w_size-y):0,h=e.window,f=e.w_mask,l=e.prev,d=e.strstart+w,c=h[s+a-1],p=h[s+a];e.prev_length>=e.good_match&&(i>>=2),o>e.lookahead&&(o=e.lookahead);do{if(h[(r=t)+a]===p&&h[r+a-1]===c&&h[r]===h[s]&&h[++r]===h[s+1]){s+=2,r++;do{}while(h[++s]===h[++r]&&h[++s]===h[++r]&&h[++s]===h[++r]&&h[++s]===h[++r]&&h[++s]===h[++r]&&h[++s]===h[++r]&&h[++s]===h[++r]&&h[++s]===h[++r]&&s<d);if(n=w-(d-s),s=d-w,a<n){if(e.match_start=t,o<=(a=n))break;c=h[s+a-1],p=h[s+a]}}}while((t=l[t&f])>u&&0!=--i);return a<=e.lookahead?a:e.lookahead}function T(e){var t,r,n,i,s,a,o,u,h,f,l=e.w_size;do{if(i=e.window_size-e.lookahead-e.strstart,e.strstart>=l+(l-y)){for(d.arraySet(e.window,e.window,l,l,0),e.match_start-=l,e.strstart-=l,e.block_start-=l,t=r=e.hash_size;n=e.head[--t],e.head[t]=l<=n?n-l:0,--r;);for(t=r=l;n=e.prev[--t],e.prev[t]=l<=n?n-l:0,--r;);i+=l}if(0===e.strm.avail_in)break;if(a=e.strm,o=e.window,u=e.strstart+e.lookahead,f=void 0,(h=i)<(f=a.avail_in)&&(f=h),r=0===f?0:(a.avail_in-=f,d.arraySet(o,a.input,a.next_in,f,u),1===a.state.wrap?a.adler=c(a.adler,o,f,u):2===a.state.wrap&&(a.adler=p(a.adler,o,f,u)),a.next_in+=f,a.total_in+=f,f),e.lookahead+=r,e.lookahead+e.insert>=b)for(s=e.strstart-e.insert,e.ins_h=e.window[s],e.ins_h=(e.ins_h<<e.hash_shift^e.window[s+1])&e.hash_mask;e.insert&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[s+b-1])&e.hash_mask,e.prev[s&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=s,s++,e.insert--,!(e.lookahead+e.insert<b)););}while(e.lookahead<y&&0!==e.strm.avail_in)}function R(e,t){for(var r,n;;){if(e.lookahead<y){if(T(e),e.lookahead<y&&t===f)return 1;if(0===e.lookahead)break}if(r=0,e.lookahead>=b&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+b-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),0!==r&&e.strstart-r<=e.w_size-y&&(e.match_length=B(e,r)),e.match_length>=b)if(n=h._tr_tally(e,e.strstart-e.match_start,e.match_length-b),e.lookahead-=e.match_length,e.match_length<=e.max_lazy_match&&e.lookahead>=b){for(e.match_length--;e.strstart++,e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+b-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart,0!=--e.match_length;);e.strstart++}else e.strstart+=e.match_length,e.match_length=0,e.ins_h=e.window[e.strstart],e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+1])&e.hash_mask;else n=h._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++;if(n&&(A(e,!1),0===e.strm.avail_out))return 1}return e.insert=e.strstart<b-1?e.strstart:b-1,4===t?(A(e,!0),0===e.strm.avail_out?3:4):e.last_lit&&(A(e,!1),0===e.strm.avail_out)?1:2}function D(e,t){for(var r,n,i;;){if(e.lookahead<y){if(T(e),e.lookahead<y&&t===f)return 1;if(0===e.lookahead)break}if(r=0,e.lookahead>=b&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+b-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),e.prev_length=e.match_length,e.prev_match=e.match_start,e.match_length=b-1,0!==r&&e.prev_length<e.max_lazy_match&&e.strstart-r<=e.w_size-y&&(e.match_length=B(e,r),e.match_length<=5&&(1===e.strategy||e.match_length===b&&4096<e.strstart-e.match_start)&&(e.match_length=b-1)),e.prev_length>=b&&e.match_length<=e.prev_length){for(i=e.strstart+e.lookahead-b,n=h._tr_tally(e,e.strstart-1-e.prev_match,e.prev_length-b),e.lookahead-=e.prev_length-1,e.prev_length-=2;++e.strstart<=i&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+b-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),0!=--e.prev_length;);if(e.match_available=0,e.match_length=b-1,e.strstart++,n&&(A(e,!1),0===e.strm.avail_out))return 1}else if(e.match_available){if((n=h._tr_tally(e,0,e.window[e.strstart-1]))&&A(e,!1),e.strstart++,e.lookahead--,0===e.strm.avail_out)return 1}else e.match_available=1,e.strstart++,e.lookahead--}return e.match_available&&(n=h._tr_tally(e,0,e.window[e.strstart-1]),e.match_available=0),e.insert=e.strstart<b-1?e.strstart:b-1,4===t?(A(e,!0),0===e.strm.avail_out?3:4):e.last_lit&&(A(e,!1),0===e.strm.avail_out)?1:2}function F(e,t,r,n,i){this.good_length=e,this.max_lazy=t,this.nice_length=r,this.max_chain=n,this.func=i}function N(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=_,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new d.Buf16(2*g),this.dyn_dtree=new d.Buf16(2*(2*a+1)),this.bl_tree=new d.Buf16(2*(2*o+1)),E(this.dyn_ltree),E(this.dyn_dtree),E(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new d.Buf16(v+1),this.heap=new d.Buf16(2*s+1),E(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new d.Buf16(2*s+1),E(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}function U(e){var t;return e&&e.state?(e.total_in=e.total_out=0,e.data_type=i,(t=e.state).pending=0,t.pending_out=0,t.wrap<0&&(t.wrap=-t.wrap),t.status=t.wrap?k:x,e.adler=2===t.wrap?0:1,t.last_flush=f,h._tr_init(t),l):S(e,m)}function P(e){var t,r=U(e);return r===l&&((t=e.state).window_size=2*t.w_size,E(t.head),t.max_lazy_match=u[t.level].max_lazy,t.good_match=u[t.level].good_length,t.nice_match=u[t.level].nice_length,t.max_chain_length=u[t.level].max_chain,t.strstart=0,t.block_start=0,t.lookahead=0,t.insert=0,t.match_length=t.prev_length=b-1,t.match_available=0,t.ins_h=0),r}function L(e,t,r,n,i,s){if(!e)return m;var a=1;if(-1===t&&(t=6),n<0?(a=0,n=-n):15<n&&(a=2,n-=16),i<1||9<i||r!==_||n<8||15<n||t<0||9<t||s<0||4<s)return S(e,m);8===n&&(n=9);var o=new N;return(e.state=o).strm=e,o.wrap=a,o.gzhead=null,o.w_bits=n,o.w_size=1<<o.w_bits,o.w_mask=o.w_size-1,o.hash_bits=i+7,o.hash_size=1<<o.hash_bits,o.hash_mask=o.hash_size-1,o.hash_shift=~~((o.hash_bits+b-1)/b),o.window=new d.Buf8(2*o.w_size),o.head=new d.Buf16(o.hash_size),o.prev=new d.Buf16(o.w_size),o.lit_bufsize=1<<i+6,o.pending_buf_size=4*o.lit_bufsize,o.pending_buf=new d.Buf8(o.pending_buf_size),o.d_buf=1*o.lit_bufsize,o.l_buf=3*o.lit_bufsize,o.level=t,o.strategy=s,o.method=r,P(e)}u=[new F(0,0,0,0,function(e,t){var r=65535;for(r>e.pending_buf_size-5&&(r=e.pending_buf_size-5);;){if(e.lookahead<=1){if(T(e),0===e.lookahead&&t===f)return 1;if(0===e.lookahead)break}e.strstart+=e.lookahead,e.lookahead=0;var n=e.block_start+r;if((0===e.strstart||e.strstart>=n)&&(e.lookahead=e.strstart-n,e.strstart=n,A(e,!1),0===e.strm.avail_out))return 1;if(e.strstart-e.block_start>=e.w_size-y&&(A(e,!1),0===e.strm.avail_out))return 1}return e.insert=0,4===t?(A(e,!0),0===e.strm.avail_out?3:4):(e.strstart>e.block_start&&(A(e,!1),e.strm.avail_out),1)}),new F(4,4,8,4,R),new F(4,5,16,8,R),new F(4,6,32,32,R),new F(4,4,16,16,D),new F(8,16,32,32,D),new F(8,16,128,128,D),new F(8,32,128,256,D),new F(32,128,258,1024,D),new F(32,258,258,4096,D)],r.deflateInit=function(e,t){return L(e,t,_,15,8,0)},r.deflateInit2=L,r.deflateReset=P,r.deflateResetKeep=U,r.deflateSetHeader=function(e,t){return e&&e.state?2!==e.state.wrap?m:(e.state.gzhead=t,l):m},r.deflate=function(e,t){var r,n,i,s;if(!e||!e.state||5<t||t<0)return e?S(e,m):m;if(n=e.state,!e.output||!e.input&&0!==e.avail_in||666===n.status&&4!==t)return S(e,0===e.avail_out?-5:m);if(n.strm=e,r=n.last_flush,n.last_flush=t,n.status===k)if(2===n.wrap)e.adler=0,I(n,31),I(n,139),I(n,8),n.gzhead?(I(n,(n.gzhead.text?1:0)+(n.gzhead.hcrc?2:0)+(n.gzhead.extra?4:0)+(n.gzhead.name?8:0)+(n.gzhead.comment?16:0)),I(n,255&n.gzhead.time),I(n,n.gzhead.time>>8&255),I(n,n.gzhead.time>>16&255),I(n,n.gzhead.time>>24&255),I(n,9===n.level?2:2<=n.strategy||n.level<2?4:0),I(n,255&n.gzhead.os),n.gzhead.extra&&n.gzhead.extra.length&&(I(n,255&n.gzhead.extra.length),I(n,n.gzhead.extra.length>>8&255)),n.gzhead.hcrc&&(e.adler=p(e.adler,n.pending_buf,n.pending,0)),n.gzindex=0,n.status=69):(I(n,0),I(n,0),I(n,0),I(n,0),I(n,0),I(n,9===n.level?2:2<=n.strategy||n.level<2?4:0),I(n,3),n.status=x);else{var a=_+(n.w_bits-8<<4)<<8;a|=(2<=n.strategy||n.level<2?0:n.level<6?1:6===n.level?2:3)<<6,0!==n.strstart&&(a|=32),a+=31-a%31,n.status=x,O(n,a),0!==n.strstart&&(O(n,e.adler>>>16),O(n,65535&e.adler)),e.adler=1}if(69===n.status)if(n.gzhead.extra){for(i=n.pending;n.gzindex<(65535&n.gzhead.extra.length)&&(n.pending!==n.pending_buf_size||(n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),C(e),i=n.pending,n.pending!==n.pending_buf_size));)I(n,255&n.gzhead.extra[n.gzindex]),n.gzindex++;n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),n.gzindex===n.gzhead.extra.length&&(n.gzindex=0,n.status=73)}else n.status=73;if(73===n.status)if(n.gzhead.name){i=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),C(e),i=n.pending,n.pending===n.pending_buf_size)){s=1;break}s=n.gzindex<n.gzhead.name.length?255&n.gzhead.name.charCodeAt(n.gzindex++):0,I(n,s)}while(0!==s);n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),0===s&&(n.gzindex=0,n.status=91)}else n.status=91;if(91===n.status)if(n.gzhead.comment){i=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),C(e),i=n.pending,n.pending===n.pending_buf_size)){s=1;break}s=n.gzindex<n.gzhead.comment.length?255&n.gzhead.comment.charCodeAt(n.gzindex++):0,I(n,s)}while(0!==s);n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),0===s&&(n.status=103)}else n.status=103;if(103===n.status&&(n.gzhead.hcrc?(n.pending+2>n.pending_buf_size&&C(e),n.pending+2<=n.pending_buf_size&&(I(n,255&e.adler),I(n,e.adler>>8&255),e.adler=0,n.status=x)):n.status=x),0!==n.pending){if(C(e),0===e.avail_out)return n.last_flush=-1,l}else if(0===e.avail_in&&z(t)<=z(r)&&4!==t)return S(e,-5);if(666===n.status&&0!==e.avail_in)return S(e,-5);if(0!==e.avail_in||0!==n.lookahead||t!==f&&666!==n.status){var o=2===n.strategy?function(e,t){for(var r;;){if(0===e.lookahead&&(T(e),0===e.lookahead)){if(t===f)return 1;break}if(e.match_length=0,r=h._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++,r&&(A(e,!1),0===e.strm.avail_out))return 1}return e.insert=0,4===t?(A(e,!0),0===e.strm.avail_out?3:4):e.last_lit&&(A(e,!1),0===e.strm.avail_out)?1:2}(n,t):3===n.strategy?function(e,t){for(var r,n,i,s,a=e.window;;){if(e.lookahead<=w){if(T(e),e.lookahead<=w&&t===f)return 1;if(0===e.lookahead)break}if(e.match_length=0,e.lookahead>=b&&0<e.strstart&&(n=a[i=e.strstart-1])===a[++i]&&n===a[++i]&&n===a[++i]){s=e.strstart+w;do{}while(n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&i<s);e.match_length=w-(s-i),e.match_length>e.lookahead&&(e.match_length=e.lookahead)}if(e.match_length>=b?(r=h._tr_tally(e,1,e.match_length-b),e.lookahead-=e.match_length,e.strstart+=e.match_length,e.match_length=0):(r=h._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++),r&&(A(e,!1),0===e.strm.avail_out))return 1}return e.insert=0,4===t?(A(e,!0),0===e.strm.avail_out?3:4):e.last_lit&&(A(e,!1),0===e.strm.avail_out)?1:2}(n,t):u[n.level].func(n,t);if(3!==o&&4!==o||(n.status=666),1===o||3===o)return 0===e.avail_out&&(n.last_flush=-1),l;if(2===o&&(1===t?h._tr_align(n):5!==t&&(h._tr_stored_block(n,0,0,!1),3===t&&(E(n.head),0===n.lookahead&&(n.strstart=0,n.block_start=0,n.insert=0))),C(e),0===e.avail_out))return n.last_flush=-1,l}return 4!==t?l:n.wrap<=0?1:(2===n.wrap?(I(n,255&e.adler),I(n,e.adler>>8&255),I(n,e.adler>>16&255),I(n,e.adler>>24&255),I(n,255&e.total_in),I(n,e.total_in>>8&255),I(n,e.total_in>>16&255),I(n,e.total_in>>24&255)):(O(n,e.adler>>>16),O(n,65535&e.adler)),C(e),0<n.wrap&&(n.wrap=-n.wrap),0!==n.pending?l:1)},r.deflateEnd=function(e){var t;return e&&e.state?(t=e.state.status)!==k&&69!==t&&73!==t&&91!==t&&103!==t&&t!==x&&666!==t?S(e,m):(e.state=null,t===x?S(e,-3):l):m},r.deflateSetDictionary=function(e,t){var r,n,i,s,a,o,u,h,f=t.length;if(!e||!e.state)return m;if(2===(s=(r=e.state).wrap)||1===s&&r.status!==k||r.lookahead)return m;for(1===s&&(e.adler=c(e.adler,t,f,0)),r.wrap=0,f>=r.w_size&&(0===s&&(E(r.head),r.strstart=0,r.block_start=0,r.insert=0),h=new d.Buf8(r.w_size),d.arraySet(h,t,f-r.w_size,r.w_size,0),t=h,f=r.w_size),a=e.avail_in,o=e.next_in,u=e.input,e.avail_in=f,e.next_in=0,e.input=t,T(r);r.lookahead>=b;){for(n=r.strstart,i=r.lookahead-(b-1);r.ins_h=(r.ins_h<<r.hash_shift^r.window[n+b-1])&r.hash_mask,r.prev[n&r.w_mask]=r.head[r.ins_h],r.head[r.ins_h]=n,n++,--i;);r.strstart=n,r.lookahead=b-1,T(r)}return r.strstart+=r.lookahead,r.block_start=r.strstart,r.insert=r.lookahead,r.lookahead=0,r.match_length=r.prev_length=b-1,r.match_available=0,e.next_in=o,e.input=u,e.avail_in=a,r.wrap=s,l},r.deflateInfo="pako deflate (from Nodeca project)"},{"../utils/common":41,"./adler32":43,"./crc32":45,"./messages":51,"./trees":52}],47:[function(e,t,r){"use strict";t.exports=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1}},{}],48:[function(e,t,r){"use strict";t.exports=function(e,t){var r,n,i,s,a,o,u,h,f,l,d,c,p,m,_,g,v,b,w,y,k,x,S,z,E;r=e.state,n=e.next_in,z=e.input,i=n+(e.avail_in-5),s=e.next_out,E=e.output,a=s-(t-e.avail_out),o=s+(e.avail_out-257),u=r.dmax,h=r.wsize,f=r.whave,l=r.wnext,d=r.window,c=r.hold,p=r.bits,m=r.lencode,_=r.distcode,g=(1<<r.lenbits)-1,v=(1<<r.distbits)-1;e:do{p<15&&(c+=z[n++]<<p,p+=8,c+=z[n++]<<p,p+=8),b=m[c&g];t:for(;;){if(c>>>=w=b>>>24,p-=w,0==(w=b>>>16&255))E[s++]=65535&b;else{if(!(16&w)){if(0==(64&w)){b=m[(65535&b)+(c&(1<<w)-1)];continue t}if(32&w){r.mode=12;break e}e.msg="invalid literal/length code",r.mode=30;break e}y=65535&b,(w&=15)&&(p<w&&(c+=z[n++]<<p,p+=8),y+=c&(1<<w)-1,c>>>=w,p-=w),p<15&&(c+=z[n++]<<p,p+=8,c+=z[n++]<<p,p+=8),b=_[c&v];r:for(;;){if(c>>>=w=b>>>24,p-=w,!(16&(w=b>>>16&255))){if(0==(64&w)){b=_[(65535&b)+(c&(1<<w)-1)];continue r}e.msg="invalid distance code",r.mode=30;break e}if(k=65535&b,p<(w&=15)&&(c+=z[n++]<<p,(p+=8)<w&&(c+=z[n++]<<p,p+=8)),u<(k+=c&(1<<w)-1)){e.msg="invalid distance too far back",r.mode=30;break e}if(c>>>=w,p-=w,(w=s-a)<k){if(f<(w=k-w)&&r.sane){e.msg="invalid distance too far back",r.mode=30;break e}if(S=d,(x=0)===l){if(x+=h-w,w<y){for(y-=w;E[s++]=d[x++],--w;);x=s-k,S=E}}else if(l<w){if(x+=h+l-w,(w-=l)<y){for(y-=w;E[s++]=d[x++],--w;);if(x=0,l<y){for(y-=w=l;E[s++]=d[x++],--w;);x=s-k,S=E}}}else if(x+=l-w,w<y){for(y-=w;E[s++]=d[x++],--w;);x=s-k,S=E}for(;2<y;)E[s++]=S[x++],E[s++]=S[x++],E[s++]=S[x++],y-=3;y&&(E[s++]=S[x++],1<y&&(E[s++]=S[x++]))}else{for(x=s-k;E[s++]=E[x++],E[s++]=E[x++],E[s++]=E[x++],2<(y-=3););y&&(E[s++]=E[x++],1<y&&(E[s++]=E[x++]))}break}}break}}while(n<i&&s<o);n-=y=p>>3,c&=(1<<(p-=y<<3))-1,e.next_in=n,e.next_out=s,e.avail_in=n<i?i-n+5:5-(n-i),e.avail_out=s<o?o-s+257:257-(s-o),r.hold=c,r.bits=p}},{}],49:[function(e,t,r){"use strict";var I=e("../utils/common"),O=e("./adler32"),B=e("./crc32"),T=e("./inffast"),R=e("./inftrees"),D=1,F=2,N=0,U=-2,P=1,n=852,i=592;function L(e){return(e>>>24&255)+(e>>>8&65280)+((65280&e)<<8)+((255&e)<<24)}function s(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new I.Buf16(320),this.work=new I.Buf16(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}function a(e){var t;return e&&e.state?(t=e.state,e.total_in=e.total_out=t.total=0,e.msg="",t.wrap&&(e.adler=1&t.wrap),t.mode=P,t.last=0,t.havedict=0,t.dmax=32768,t.head=null,t.hold=0,t.bits=0,t.lencode=t.lendyn=new I.Buf32(n),t.distcode=t.distdyn=new I.Buf32(i),t.sane=1,t.back=-1,N):U}function o(e){var t;return e&&e.state?((t=e.state).wsize=0,t.whave=0,t.wnext=0,a(e)):U}function u(e,t){var r,n;return e&&e.state?(n=e.state,t<0?(r=0,t=-t):(r=1+(t>>4),t<48&&(t&=15)),t&&(t<8||15<t)?U:(null!==n.window&&n.wbits!==t&&(n.window=null),n.wrap=r,n.wbits=t,o(e))):U}function h(e,t){var r,n;return e?(n=new s,(e.state=n).window=null,(r=u(e,t))!==N&&(e.state=null),r):U}var f,l,d=!0;function j(e){if(d){var t;for(f=new I.Buf32(512),l=new I.Buf32(32),t=0;t<144;)e.lens[t++]=8;for(;t<256;)e.lens[t++]=9;for(;t<280;)e.lens[t++]=7;for(;t<288;)e.lens[t++]=8;for(R(D,e.lens,0,288,f,0,e.work,{bits:9}),t=0;t<32;)e.lens[t++]=5;R(F,e.lens,0,32,l,0,e.work,{bits:5}),d=!1}e.lencode=f,e.lenbits=9,e.distcode=l,e.distbits=5}function Z(e,t,r,n){var i,s=e.state;return null===s.window&&(s.wsize=1<<s.wbits,s.wnext=0,s.whave=0,s.window=new I.Buf8(s.wsize)),n>=s.wsize?(I.arraySet(s.window,t,r-s.wsize,s.wsize,0),s.wnext=0,s.whave=s.wsize):(n<(i=s.wsize-s.wnext)&&(i=n),I.arraySet(s.window,t,r-n,i,s.wnext),(n-=i)?(I.arraySet(s.window,t,r-n,n,0),s.wnext=n,s.whave=s.wsize):(s.wnext+=i,s.wnext===s.wsize&&(s.wnext=0),s.whave<s.wsize&&(s.whave+=i))),0}r.inflateReset=o,r.inflateReset2=u,r.inflateResetKeep=a,r.inflateInit=function(e){return h(e,15)},r.inflateInit2=h,r.inflate=function(e,t){var r,n,i,s,a,o,u,h,f,l,d,c,p,m,_,g,v,b,w,y,k,x,S,z,E=0,C=new I.Buf8(4),A=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];if(!e||!e.state||!e.output||!e.input&&0!==e.avail_in)return U;12===(r=e.state).mode&&(r.mode=13),a=e.next_out,i=e.output,u=e.avail_out,s=e.next_in,n=e.input,o=e.avail_in,h=r.hold,f=r.bits,l=o,d=u,x=N;e:for(;;)switch(r.mode){case P:if(0===r.wrap){r.mode=13;break}for(;f<16;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(2&r.wrap&&35615===h){C[r.check=0]=255&h,C[1]=h>>>8&255,r.check=B(r.check,C,2,0),f=h=0,r.mode=2;break}if(r.flags=0,r.head&&(r.head.done=!1),!(1&r.wrap)||(((255&h)<<8)+(h>>8))%31){e.msg="incorrect header check",r.mode=30;break}if(8!=(15&h)){e.msg="unknown compression method",r.mode=30;break}if(f-=4,k=8+(15&(h>>>=4)),0===r.wbits)r.wbits=k;else if(k>r.wbits){e.msg="invalid window size",r.mode=30;break}r.dmax=1<<k,e.adler=r.check=1,r.mode=512&h?10:12,f=h=0;break;case 2:for(;f<16;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(r.flags=h,8!=(255&r.flags)){e.msg="unknown compression method",r.mode=30;break}if(57344&r.flags){e.msg="unknown header flags set",r.mode=30;break}r.head&&(r.head.text=h>>8&1),512&r.flags&&(C[0]=255&h,C[1]=h>>>8&255,r.check=B(r.check,C,2,0)),f=h=0,r.mode=3;case 3:for(;f<32;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}r.head&&(r.head.time=h),512&r.flags&&(C[0]=255&h,C[1]=h>>>8&255,C[2]=h>>>16&255,C[3]=h>>>24&255,r.check=B(r.check,C,4,0)),f=h=0,r.mode=4;case 4:for(;f<16;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}r.head&&(r.head.xflags=255&h,r.head.os=h>>8),512&r.flags&&(C[0]=255&h,C[1]=h>>>8&255,r.check=B(r.check,C,2,0)),f=h=0,r.mode=5;case 5:if(1024&r.flags){for(;f<16;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}r.length=h,r.head&&(r.head.extra_len=h),512&r.flags&&(C[0]=255&h,C[1]=h>>>8&255,r.check=B(r.check,C,2,0)),f=h=0}else r.head&&(r.head.extra=null);r.mode=6;case 6:if(1024&r.flags&&(o<(c=r.length)&&(c=o),c&&(r.head&&(k=r.head.extra_len-r.length,r.head.extra||(r.head.extra=new Array(r.head.extra_len)),I.arraySet(r.head.extra,n,s,c,k)),512&r.flags&&(r.check=B(r.check,n,c,s)),o-=c,s+=c,r.length-=c),r.length))break e;r.length=0,r.mode=7;case 7:if(2048&r.flags){if(0===o)break e;for(c=0;k=n[s+c++],r.head&&k&&r.length<65536&&(r.head.name+=String.fromCharCode(k)),k&&c<o;);if(512&r.flags&&(r.check=B(r.check,n,c,s)),o-=c,s+=c,k)break e}else r.head&&(r.head.name=null);r.length=0,r.mode=8;case 8:if(4096&r.flags){if(0===o)break e;for(c=0;k=n[s+c++],r.head&&k&&r.length<65536&&(r.head.comment+=String.fromCharCode(k)),k&&c<o;);if(512&r.flags&&(r.check=B(r.check,n,c,s)),o-=c,s+=c,k)break e}else r.head&&(r.head.comment=null);r.mode=9;case 9:if(512&r.flags){for(;f<16;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(h!==(65535&r.check)){e.msg="header crc mismatch",r.mode=30;break}f=h=0}r.head&&(r.head.hcrc=r.flags>>9&1,r.head.done=!0),e.adler=r.check=0,r.mode=12;break;case 10:for(;f<32;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}e.adler=r.check=L(h),f=h=0,r.mode=11;case 11:if(0===r.havedict)return e.next_out=a,e.avail_out=u,e.next_in=s,e.avail_in=o,r.hold=h,r.bits=f,2;e.adler=r.check=1,r.mode=12;case 12:if(5===t||6===t)break e;case 13:if(r.last){h>>>=7&f,f-=7&f,r.mode=27;break}for(;f<3;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}switch(r.last=1&h,f-=1,3&(h>>>=1)){case 0:r.mode=14;break;case 1:if(j(r),r.mode=20,6!==t)break;h>>>=2,f-=2;break e;case 2:r.mode=17;break;case 3:e.msg="invalid block type",r.mode=30}h>>>=2,f-=2;break;case 14:for(h>>>=7&f,f-=7&f;f<32;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if((65535&h)!=(h>>>16^65535)){e.msg="invalid stored block lengths",r.mode=30;break}if(r.length=65535&h,f=h=0,r.mode=15,6===t)break e;case 15:r.mode=16;case 16:if(c=r.length){if(o<c&&(c=o),u<c&&(c=u),0===c)break e;I.arraySet(i,n,s,c,a),o-=c,s+=c,u-=c,a+=c,r.length-=c;break}r.mode=12;break;case 17:for(;f<14;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(r.nlen=257+(31&h),h>>>=5,f-=5,r.ndist=1+(31&h),h>>>=5,f-=5,r.ncode=4+(15&h),h>>>=4,f-=4,286<r.nlen||30<r.ndist){e.msg="too many length or distance symbols",r.mode=30;break}r.have=0,r.mode=18;case 18:for(;r.have<r.ncode;){for(;f<3;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}r.lens[A[r.have++]]=7&h,h>>>=3,f-=3}for(;r.have<19;)r.lens[A[r.have++]]=0;if(r.lencode=r.lendyn,r.lenbits=7,S={bits:r.lenbits},x=R(0,r.lens,0,19,r.lencode,0,r.work,S),r.lenbits=S.bits,x){e.msg="invalid code lengths set",r.mode=30;break}r.have=0,r.mode=19;case 19:for(;r.have<r.nlen+r.ndist;){for(;g=(E=r.lencode[h&(1<<r.lenbits)-1])>>>16&255,v=65535&E,!((_=E>>>24)<=f);){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(v<16)h>>>=_,f-=_,r.lens[r.have++]=v;else{if(16===v){for(z=_+2;f<z;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(h>>>=_,f-=_,0===r.have){e.msg="invalid bit length repeat",r.mode=30;break}k=r.lens[r.have-1],c=3+(3&h),h>>>=2,f-=2}else if(17===v){for(z=_+3;f<z;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}f-=_,k=0,c=3+(7&(h>>>=_)),h>>>=3,f-=3}else{for(z=_+7;f<z;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}f-=_,k=0,c=11+(127&(h>>>=_)),h>>>=7,f-=7}if(r.have+c>r.nlen+r.ndist){e.msg="invalid bit length repeat",r.mode=30;break}for(;c--;)r.lens[r.have++]=k}}if(30===r.mode)break;if(0===r.lens[256]){e.msg="invalid code -- missing end-of-block",r.mode=30;break}if(r.lenbits=9,S={bits:r.lenbits},x=R(D,r.lens,0,r.nlen,r.lencode,0,r.work,S),r.lenbits=S.bits,x){e.msg="invalid literal/lengths set",r.mode=30;break}if(r.distbits=6,r.distcode=r.distdyn,S={bits:r.distbits},x=R(F,r.lens,r.nlen,r.ndist,r.distcode,0,r.work,S),r.distbits=S.bits,x){e.msg="invalid distances set",r.mode=30;break}if(r.mode=20,6===t)break e;case 20:r.mode=21;case 21:if(6<=o&&258<=u){e.next_out=a,e.avail_out=u,e.next_in=s,e.avail_in=o,r.hold=h,r.bits=f,T(e,d),a=e.next_out,i=e.output,u=e.avail_out,s=e.next_in,n=e.input,o=e.avail_in,h=r.hold,f=r.bits,12===r.mode&&(r.back=-1);break}for(r.back=0;g=(E=r.lencode[h&(1<<r.lenbits)-1])>>>16&255,v=65535&E,!((_=E>>>24)<=f);){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(g&&0==(240&g)){for(b=_,w=g,y=v;g=(E=r.lencode[y+((h&(1<<b+w)-1)>>b)])>>>16&255,v=65535&E,!(b+(_=E>>>24)<=f);){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}h>>>=b,f-=b,r.back+=b}if(h>>>=_,f-=_,r.back+=_,r.length=v,0===g){r.mode=26;break}if(32&g){r.back=-1,r.mode=12;break}if(64&g){e.msg="invalid literal/length code",r.mode=30;break}r.extra=15&g,r.mode=22;case 22:if(r.extra){for(z=r.extra;f<z;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}r.length+=h&(1<<r.extra)-1,h>>>=r.extra,f-=r.extra,r.back+=r.extra}r.was=r.length,r.mode=23;case 23:for(;g=(E=r.distcode[h&(1<<r.distbits)-1])>>>16&255,v=65535&E,!((_=E>>>24)<=f);){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(0==(240&g)){for(b=_,w=g,y=v;g=(E=r.distcode[y+((h&(1<<b+w)-1)>>b)])>>>16&255,v=65535&E,!(b+(_=E>>>24)<=f);){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}h>>>=b,f-=b,r.back+=b}if(h>>>=_,f-=_,r.back+=_,64&g){e.msg="invalid distance code",r.mode=30;break}r.offset=v,r.extra=15&g,r.mode=24;case 24:if(r.extra){for(z=r.extra;f<z;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}r.offset+=h&(1<<r.extra)-1,h>>>=r.extra,f-=r.extra,r.back+=r.extra}if(r.offset>r.dmax){e.msg="invalid distance too far back",r.mode=30;break}r.mode=25;case 25:if(0===u)break e;if(c=d-u,r.offset>c){if((c=r.offset-c)>r.whave&&r.sane){e.msg="invalid distance too far back",r.mode=30;break}p=c>r.wnext?(c-=r.wnext,r.wsize-c):r.wnext-c,c>r.length&&(c=r.length),m=r.window}else m=i,p=a-r.offset,c=r.length;for(u<c&&(c=u),u-=c,r.length-=c;i[a++]=m[p++],--c;);0===r.length&&(r.mode=21);break;case 26:if(0===u)break e;i[a++]=r.length,u--,r.mode=21;break;case 27:if(r.wrap){for(;f<32;){if(0===o)break e;o--,h|=n[s++]<<f,f+=8}if(d-=u,e.total_out+=d,r.total+=d,d&&(e.adler=r.check=r.flags?B(r.check,i,d,a-d):O(r.check,i,d,a-d)),d=u,(r.flags?h:L(h))!==r.check){e.msg="incorrect data check",r.mode=30;break}f=h=0}r.mode=28;case 28:if(r.wrap&&r.flags){for(;f<32;){if(0===o)break e;o--,h+=n[s++]<<f,f+=8}if(h!==(4294967295&r.total)){e.msg="incorrect length check",r.mode=30;break}f=h=0}r.mode=29;case 29:x=1;break e;case 30:x=-3;break e;case 31:return-4;case 32:default:return U}return e.next_out=a,e.avail_out=u,e.next_in=s,e.avail_in=o,r.hold=h,r.bits=f,(r.wsize||d!==e.avail_out&&r.mode<30&&(r.mode<27||4!==t))&&Z(e,e.output,e.next_out,d-e.avail_out)?(r.mode=31,-4):(l-=e.avail_in,d-=e.avail_out,e.total_in+=l,e.total_out+=d,r.total+=d,r.wrap&&d&&(e.adler=r.check=r.flags?B(r.check,i,d,e.next_out-d):O(r.check,i,d,e.next_out-d)),e.data_type=r.bits+(r.last?64:0)+(12===r.mode?128:0)+(20===r.mode||15===r.mode?256:0),(0==l&&0===d||4===t)&&x===N&&(x=-5),x)},r.inflateEnd=function(e){if(!e||!e.state)return U;var t=e.state;return t.window&&(t.window=null),e.state=null,N},r.inflateGetHeader=function(e,t){var r;return e&&e.state?0==(2&(r=e.state).wrap)?U:((r.head=t).done=!1,N):U},r.inflateSetDictionary=function(e,t){var r,n=t.length;return e&&e.state?0!==(r=e.state).wrap&&11!==r.mode?U:11===r.mode&&O(1,t,n,0)!==r.check?-3:Z(e,t,n,n)?(r.mode=31,-4):(r.havedict=1,N):U},r.inflateInfo="pako inflate (from Nodeca project)"},{"../utils/common":41,"./adler32":43,"./crc32":45,"./inffast":48,"./inftrees":50}],50:[function(e,t,r){"use strict";var D=e("../utils/common"),F=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0],N=[16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78],U=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0],P=[16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64];t.exports=function(e,t,r,n,i,s,a,o){var u,h,f,l,d,c,p,m,_,g=o.bits,v=0,b=0,w=0,y=0,k=0,x=0,S=0,z=0,E=0,C=0,A=null,I=0,O=new D.Buf16(16),B=new D.Buf16(16),T=null,R=0;for(v=0;v<=15;v++)O[v]=0;for(b=0;b<n;b++)O[t[r+b]]++;for(k=g,y=15;1<=y&&0===O[y];y--);if(y<k&&(k=y),0===y)return i[s++]=20971520,i[s++]=20971520,o.bits=1,0;for(w=1;w<y&&0===O[w];w++);for(k<w&&(k=w),v=z=1;v<=15;v++)if(z<<=1,(z-=O[v])<0)return-1;if(0<z&&(0===e||1!==y))return-1;for(B[1]=0,v=1;v<15;v++)B[v+1]=B[v]+O[v];for(b=0;b<n;b++)0!==t[r+b]&&(a[B[t[r+b]]++]=b);if(c=0===e?(A=T=a,19):1===e?(A=F,I-=257,T=N,R-=257,256):(A=U,T=P,-1),v=w,d=s,S=b=C=0,f=-1,l=(E=1<<(x=k))-1,1===e&&852<E||2===e&&592<E)return 1;for(;;){for(p=v-S,_=a[b]<c?(m=0,a[b]):a[b]>c?(m=T[R+a[b]],A[I+a[b]]):(m=96,0),u=1<<v-S,w=h=1<<x;i[d+(C>>S)+(h-=u)]=p<<24|m<<16|_|0,0!==h;);for(u=1<<v-1;C&u;)u>>=1;if(0!==u?(C&=u-1,C+=u):C=0,b++,0==--O[v]){if(v===y)break;v=t[r+a[b]]}if(k<v&&(C&l)!==f){for(0===S&&(S=k),d+=w,z=1<<(x=v-S);x+S<y&&!((z-=O[x+S])<=0);)x++,z<<=1;if(E+=1<<x,1===e&&852<E||2===e&&592<E)return 1;i[f=C&l]=k<<24|x<<16|d-s|0}}return 0!==C&&(i[d+C]=v-S<<24|64<<16|0),o.bits=k,0}},{"../utils/common":41}],51:[function(e,t,r){"use strict";t.exports={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"}},{}],52:[function(e,t,r){"use strict";var o=e("../utils/common");function n(e){for(var t=e.length;0<=--t;)e[t]=0}var _=15,i=16,u=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],h=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],a=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],f=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],l=new Array(576);n(l);var d=new Array(60);n(d);var c=new Array(512);n(c);var p=new Array(256);n(p);var m=new Array(29);n(m);var g,v,b,w=new Array(30);function y(e,t,r,n,i){this.static_tree=e,this.extra_bits=t,this.extra_base=r,this.elems=n,this.max_length=i,this.has_stree=e&&e.length}function s(e,t){this.dyn_tree=e,this.max_code=0,this.stat_desc=t}function k(e){return e<256?c[e]:c[256+(e>>>7)]}function x(e,t){e.pending_buf[e.pending++]=255&t,e.pending_buf[e.pending++]=t>>>8&255}function S(e,t,r){e.bi_valid>i-r?(e.bi_buf|=t<<e.bi_valid&65535,x(e,e.bi_buf),e.bi_buf=t>>i-e.bi_valid,e.bi_valid+=r-i):(e.bi_buf|=t<<e.bi_valid&65535,e.bi_valid+=r)}function z(e,t,r){S(e,r[2*t],r[2*t+1])}function E(e,t){for(var r=0;r|=1&e,e>>>=1,r<<=1,0<--t;);return r>>>1}function C(e,t,r){var n,i,s=new Array(_+1),a=0;for(n=1;n<=_;n++)s[n]=a=a+r[n-1]<<1;for(i=0;i<=t;i++){var o=e[2*i+1];0!==o&&(e[2*i]=E(s[o]++,o))}}function A(e){var t;for(t=0;t<286;t++)e.dyn_ltree[2*t]=0;for(t=0;t<30;t++)e.dyn_dtree[2*t]=0;for(t=0;t<19;t++)e.bl_tree[2*t]=0;e.dyn_ltree[512]=1,e.opt_len=e.static_len=0,e.last_lit=e.matches=0}function I(e){8<e.bi_valid?x(e,e.bi_buf):0<e.bi_valid&&(e.pending_buf[e.pending++]=e.bi_buf),e.bi_buf=0,e.bi_valid=0}function O(e,t,r,n){var i=2*t,s=2*r;return e[i]<e[s]||e[i]===e[s]&&n[t]<=n[r]}function B(e,t,r){for(var n=e.heap[r],i=r<<1;i<=e.heap_len&&(i<e.heap_len&&O(t,e.heap[i+1],e.heap[i],e.depth)&&i++,!O(t,n,e.heap[i],e.depth));)e.heap[r]=e.heap[i],r=i,i<<=1;e.heap[r]=n}function T(e,t,r){var n,i,s,a,o=0;if(0!==e.last_lit)for(;n=e.pending_buf[e.d_buf+2*o]<<8|e.pending_buf[e.d_buf+2*o+1],i=e.pending_buf[e.l_buf+o],o++,0===n?z(e,i,t):(z(e,(s=p[i])+256+1,t),0!==(a=u[s])&&S(e,i-=m[s],a),z(e,s=k(--n),r),0!==(a=h[s])&&S(e,n-=w[s],a)),o<e.last_lit;);z(e,256,t)}function R(e,t){var r,n,i,s=t.dyn_tree,a=t.stat_desc.static_tree,o=t.stat_desc.has_stree,u=t.stat_desc.elems,h=-1;for(e.heap_len=0,e.heap_max=573,r=0;r<u;r++)0!==s[2*r]?(e.heap[++e.heap_len]=h=r,e.depth[r]=0):s[2*r+1]=0;for(;e.heap_len<2;)s[2*(i=e.heap[++e.heap_len]=h<2?++h:0)]=1,e.depth[i]=0,e.opt_len--,o&&(e.static_len-=a[2*i+1]);for(t.max_code=h,r=e.heap_len>>1;1<=r;r--)B(e,s,r);for(i=u;r=e.heap[1],e.heap[1]=e.heap[e.heap_len--],B(e,s,1),n=e.heap[1],e.heap[--e.heap_max]=r,e.heap[--e.heap_max]=n,s[2*i]=s[2*r]+s[2*n],e.depth[i]=(e.depth[r]>=e.depth[n]?e.depth[r]:e.depth[n])+1,s[2*r+1]=s[2*n+1]=i,e.heap[1]=i++,B(e,s,1),2<=e.heap_len;);e.heap[--e.heap_max]=e.heap[1],function(e,t){var r,n,i,s,a,o,u=t.dyn_tree,h=t.max_code,f=t.stat_desc.static_tree,l=t.stat_desc.has_stree,d=t.stat_desc.extra_bits,c=t.stat_desc.extra_base,p=t.stat_desc.max_length,m=0;for(s=0;s<=_;s++)e.bl_count[s]=0;for(u[2*e.heap[e.heap_max]+1]=0,r=e.heap_max+1;r<573;r++)p<(s=u[2*u[2*(n=e.heap[r])+1]+1]+1)&&(s=p,m++),u[2*n+1]=s,h<n||(e.bl_count[s]++,a=0,c<=n&&(a=d[n-c]),o=u[2*n],e.opt_len+=o*(s+a),l&&(e.static_len+=o*(f[2*n+1]+a)));if(0!==m){do{for(s=p-1;0===e.bl_count[s];)s--;e.bl_count[s]--,e.bl_count[s+1]+=2,e.bl_count[p]--,m-=2}while(0<m);for(s=p;0!==s;s--)for(n=e.bl_count[s];0!==n;)h<(i=e.heap[--r])||(u[2*i+1]!==s&&(e.opt_len+=(s-u[2*i+1])*u[2*i],u[2*i+1]=s),n--)}}(e,t),C(s,h,e.bl_count)}function D(e,t,r){var n,i,s=-1,a=t[1],o=0,u=7,h=4;for(0===a&&(u=138,h=3),t[2*(r+1)+1]=65535,n=0;n<=r;n++)i=a,a=t[2*(n+1)+1],++o<u&&i===a||(o<h?e.bl_tree[2*i]+=o:0!==i?(i!==s&&e.bl_tree[2*i]++,e.bl_tree[32]++):o<=10?e.bl_tree[34]++:e.bl_tree[36]++,s=i,h=(o=0)===a?(u=138,3):i===a?(u=6,3):(u=7,4))}function F(e,t,r){var n,i,s=-1,a=t[1],o=0,u=7,h=4;for(0===a&&(u=138,h=3),n=0;n<=r;n++)if(i=a,a=t[2*(n+1)+1],!(++o<u&&i===a)){if(o<h)for(;z(e,i,e.bl_tree),0!=--o;);else 0!==i?(i!==s&&(z(e,i,e.bl_tree),o--),z(e,16,e.bl_tree),S(e,o-3,2)):o<=10?(z(e,17,e.bl_tree),S(e,o-3,3)):(z(e,18,e.bl_tree),S(e,o-11,7));s=i,h=(o=0)===a?(u=138,3):i===a?(u=6,3):(u=7,4)}}n(w);var N=!1;function U(e,t,r,n){var i,s,a;S(e,0+(n?1:0),3),s=t,a=r,I(i=e),x(i,a),x(i,~a),o.arraySet(i.pending_buf,i.window,s,a,i.pending),i.pending+=a}r._tr_init=function(e){N||(function(){var e,t,r,n,i,s=new Array(_+1);for(n=r=0;n<28;n++)for(m[n]=r,e=0;e<1<<u[n];e++)p[r++]=n;for(p[r-1]=n,n=i=0;n<16;n++)for(w[n]=i,e=0;e<1<<h[n];e++)c[i++]=n;for(i>>=7;n<30;n++)for(w[n]=i<<7,e=0;e<1<<h[n]-7;e++)c[256+i++]=n;for(t=0;t<=_;t++)s[t]=0;for(e=0;e<=143;)l[2*e+1]=8,e++,s[8]++;for(;e<=255;)l[2*e+1]=9,e++,s[9]++;for(;e<=279;)l[2*e+1]=7,e++,s[7]++;for(;e<=287;)l[2*e+1]=8,e++,s[8]++;for(C(l,287,s),e=0;e<30;e++)d[2*e+1]=5,d[2*e]=E(e,5);g=new y(l,u,257,286,_),v=new y(d,h,0,30,_),b=new y(new Array(0),a,0,19,7)}(),N=!0),e.l_desc=new s(e.dyn_ltree,g),e.d_desc=new s(e.dyn_dtree,v),e.bl_desc=new s(e.bl_tree,b),e.bi_buf=0,e.bi_valid=0,A(e)},r._tr_stored_block=U,r._tr_flush_block=function(e,t,r,n){var i,s,a=0;0<e.level?(2===e.strm.data_type&&(e.strm.data_type=function(e){var t,r=4093624447;for(t=0;t<=31;t++,r>>>=1)if(1&r&&0!==e.dyn_ltree[2*t])return 0;if(0!==e.dyn_ltree[18]||0!==e.dyn_ltree[20]||0!==e.dyn_ltree[26])return 1;for(t=32;t<256;t++)if(0!==e.dyn_ltree[2*t])return 1;return 0}(e)),R(e,e.l_desc),R(e,e.d_desc),a=function(e){var t;for(D(e,e.dyn_ltree,e.l_desc.max_code),D(e,e.dyn_dtree,e.d_desc.max_code),R(e,e.bl_desc),t=18;3<=t&&0===e.bl_tree[2*f[t]+1];t--);return e.opt_len+=3*(t+1)+5+5+4,t}(e),i=e.opt_len+3+7>>>3,(s=e.static_len+3+7>>>3)<=i&&(i=s)):i=s=r+5,r+4<=i&&-1!==t?U(e,t,r,n):4===e.strategy||s===i?(S(e,2+(n?1:0),3),T(e,l,d)):(S(e,4+(n?1:0),3),function(e,t,r,n){var i;for(S(e,t-257,5),S(e,r-1,5),S(e,n-4,4),i=0;i<n;i++)S(e,e.bl_tree[2*f[i]+1],3);F(e,e.dyn_ltree,t-1),F(e,e.dyn_dtree,r-1)}(e,e.l_desc.max_code+1,e.d_desc.max_code+1,a+1),T(e,e.dyn_ltree,e.dyn_dtree)),A(e),n&&I(e)},r._tr_tally=function(e,t,r){return e.pending_buf[e.d_buf+2*e.last_lit]=t>>>8&255,e.pending_buf[e.d_buf+2*e.last_lit+1]=255&t,e.pending_buf[e.l_buf+e.last_lit]=255&r,e.last_lit++,0===t?e.dyn_ltree[2*r]++:(e.matches++,t--,e.dyn_ltree[2*(p[r]+256+1)]++,e.dyn_dtree[2*k(t)]++),e.last_lit===e.lit_bufsize-1},r._tr_align=function(e){var t;S(e,2,3),z(e,256,l),16===(t=e).bi_valid?(x(t,t.bi_buf),t.bi_buf=0,t.bi_valid=0):8<=t.bi_valid&&(t.pending_buf[t.pending++]=255&t.bi_buf,t.bi_buf>>=8,t.bi_valid-=8)}},{"../utils/common":41}],53:[function(e,t,r){"use strict";t.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0}},{}],54:[function(e,t,r){"use strict";t.exports="function"==typeof setImmediate?setImmediate:function(){var e=[].slice.apply(arguments);e.splice(1,0,0),setTimeout.apply(null,e)}},{}]},{},[10])(10)})}).call(this,void 0!==r?r:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}]},{},[1])(1)})}).call(this,void 0!==r?r:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}]},{},[1])(1)})}).call(this,void 0!==r?r:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}]},{},[1])(1)})}).call(this,void 0!==r?r:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}]},{},[1])(1)})}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}]},{},[1])(1)});
}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,require("timers").setImmediate)
},{"buffer":52,"timers":301}],142:[function(require,module,exports){
'use strict';

const blacklist = [
	// # All
	'^npm-debug\\.log$', // Error log for npm
	'^\\..*\\.swp$', // Swap file for vim state

	// # macOS
	'^\\.DS_Store$', // Stores custom folder attributes
	'^\\.AppleDouble$', // Stores additional file resources
	'^\\.LSOverride$', // Contains the absolute path to the app to be used
	'^Icon\\r$', // Custom Finder icon: http://superuser.com/questions/298785/icon-file-on-os-x-desktop
	'^\\._.*', // Thumbnail
	'^\\.Spotlight-V100(?:$|\\/)', // Directory that might appear on external disk
	'\\.Trashes', // File that might appear on external disk
	'^__MACOSX$', // Resource fork

	// # Linux
	'~$', // Backup file

	// # Windows
	'^Thumbs\\.db$', // Image file cache
	'^ehthumbs\\.db$', // Folder config file
	'^Desktop\\.ini$', // Stores custom folder attributes
	'@eaDir$' // Synology Diskstation "hidden" folder where the server stores thumbnails
];

exports.re = () => {
	throw new Error('`junk.re` was renamed to `junk.regex`');
};

exports.regex = new RegExp(blacklist.join('|'));

exports.is = filename => exports.regex.test(filename);

exports.not = filename => !exports.is(filename);

// TODO: Remove this for the next major release
exports.default = module.exports;

},{}],143:[function(require,module,exports){
(function (Buffer){(function (){
/*! lt_donthave. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
const arrayRemove = require('unordered-array-remove')
const { EventEmitter } = require('events')
const debug = require('debug')('lt_donthave')

module.exports = () => {
  class ltDontHave extends EventEmitter {
    constructor (wire) {
      super()

      this._peerSupports = false
      this._wire = wire
    }

    onExtendedHandshake () {
      this._peerSupports = true
    }

    onMessage (buf) {
      let index
      try {
        index = buf.readUInt32BE()
      } catch (err) {
        // drop invalid messages
        return
      }

      if (!this._wire.peerPieces.get(index)) return
      debug('got donthave %d', index)
      this._wire.peerPieces.set(index, false)

      this.emit('donthave', index)
      this._failRequests(index)
    }

    donthave (index) {
      if (!this._peerSupports) return

      debug('donthave %d', index)
      const buf = Buffer.alloc(4)
      buf.writeUInt32BE(index)

      this._wire.extended('lt_donthave', buf)
    }

    _failRequests (index) {
      const requests = this._wire.requests
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i]
        if (req.piece === index) {
          arrayRemove(requests, i)
          i -= 1 // Check the new value at the same slot
          this._wire._callback(req, new Error('peer sent donthave'), null)
        }
      }
    }
  }

  // Name of the bittorrent-protocol extension
  ltDontHave.prototype.name = 'lt_donthave'

  return ltDontHave
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"debug":111,"events":117,"unordered-array-remove":307}],144:[function(require,module,exports){
(function (Buffer){(function (){
/*! magnet-uri. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
module.exports = magnetURIDecode
module.exports.decode = magnetURIDecode
module.exports.encode = magnetURIEncode

const base32 = require('thirty-two')
const bep53Range = require('bep53-range')

/**
 * Parse a magnet URI and return an object of keys/values
 *
 * @param  {string} uri
 * @return {Object} parsed uri
 */
function magnetURIDecode (uri) {
  const result = {}

  // Support 'magnet:' and 'stream-magnet:' uris
  const data = uri.split('magnet:?')[1]

  const params = (data && data.length >= 0)
    ? data.split('&')
    : []

  params.forEach(param => {
    const keyval = param.split('=')

    // This keyval is invalid, skip it
    if (keyval.length !== 2) return

    const key = keyval[0]
    let val = keyval[1]

    // Clean up torrent name
    if (key === 'dn') val = decodeURIComponent(val).replace(/\+/g, ' ')

    // Address tracker (tr), exact source (xs), and acceptable source (as) are encoded
    // URIs, so decode them
    if (key === 'tr' || key === 'xs' || key === 'as' || key === 'ws') {
      val = decodeURIComponent(val)
    }

    // Return keywords as an array
    if (key === 'kt') val = decodeURIComponent(val).split('+')

    // Cast file index (ix) to a number
    if (key === 'ix') val = Number(val)

    // bep53
    if (key === 'so') val = bep53Range.parse(decodeURIComponent(val).split(','))

    // If there are repeated parameters, return an array of values
    if (result[key]) {
      if (!Array.isArray(result[key])) {
        result[key] = [result[key]]
      }

      result[key].push(val)
    } else {
      result[key] = val
    }
  })

  // Convenience properties for parity with `parse-torrent-file` module
  let m
  if (result.xt) {
    const xts = Array.isArray(result.xt) ? result.xt : [result.xt]
    xts.forEach(xt => {
      if ((m = xt.match(/^urn:btih:(.{40})/))) {
        result.infoHash = m[1].toLowerCase()
      } else if ((m = xt.match(/^urn:btih:(.{32})/))) {
        const decodedStr = base32.decode(m[1])
        result.infoHash = Buffer.from(decodedStr, 'binary').toString('hex')
      } else if ((m = xt.match(/^urn:btmh:1220(.{64})/))) {
        result.infoHashV2 = m[1].toLowerCase()
      }
    })
  }

  if (result.xs) {
    const xss = Array.isArray(result.xs) ? result.xs : [result.xs]
    xss.forEach(xs => {
      if ((m = xs.match(/^urn:btpk:(.{64})/))) {
        result.publicKey = m[1].toLowerCase()
      }
    })
  }

  if (result.infoHash) result.infoHashBuffer = Buffer.from(result.infoHash, 'hex')
  if (result.infoHashV2) result.infoHashV2Buffer = Buffer.from(result.infoHashV2, 'hex')
  if (result.publicKey) result.publicKeyBuffer = Buffer.from(result.publicKey, 'hex')

  if (result.dn) result.name = result.dn
  if (result.kt) result.keywords = result.kt

  result.announce = []
  if (typeof result.tr === 'string' || Array.isArray(result.tr)) {
    result.announce = result.announce.concat(result.tr)
  }

  result.urlList = []
  if (typeof result.as === 'string' || Array.isArray(result.as)) {
    result.urlList = result.urlList.concat(result.as)
  }
  if (typeof result.ws === 'string' || Array.isArray(result.ws)) {
    result.urlList = result.urlList.concat(result.ws)
  }

  result.peerAddresses = []
  if (typeof result['x.pe'] === 'string' || Array.isArray(result['x.pe'])) {
    result.peerAddresses = result.peerAddresses.concat(result['x.pe'])
  }

  // remove duplicates by converting to Set and back
  result.announce = Array.from(new Set(result.announce))
  result.urlList = Array.from(new Set(result.urlList))
  result.peerAddresses = Array.from(new Set(result.peerAddresses))

  return result
}

function magnetURIEncode (obj) {
  obj = Object.assign({}, obj) // clone obj, so we can mutate it

  // support using convenience names, in addition to spec names
  // (example: `infoHash` for `xt`, `name` for `dn`)

  // Deduplicate xt by using a set
  let xts = new Set()
  if (obj.xt && typeof obj.xt === 'string') xts.add(obj.xt)
  if (obj.xt && Array.isArray(obj.xt)) xts = new Set(obj.xt)
  if (obj.infoHashBuffer) xts.add(`urn:btih:${obj.infoHashBuffer.toString('hex')}`)
  if (obj.infoHash) xts.add(`urn:btih:${obj.infoHash}`)
  if (obj.infoHashV2Buffer) xts.add(obj.xt = `urn:btmh:1220${obj.infoHashV2Buffer.toString('hex')}`)
  if (obj.infoHashV2) xts.add(`urn:btmh:1220${obj.infoHashV2}`)
  const xtsDeduped = Array.from(xts)
  if (xtsDeduped.length === 1) obj.xt = xtsDeduped[0]
  if (xtsDeduped.length > 1) obj.xt = xtsDeduped

  if (obj.publicKeyBuffer) obj.xs = `urn:btpk:${obj.publicKeyBuffer.toString('hex')}`
  if (obj.publicKey) obj.xs = `urn:btpk:${obj.publicKey}`
  if (obj.name) obj.dn = obj.name
  if (obj.keywords) obj.kt = obj.keywords
  if (obj.announce) obj.tr = obj.announce
  if (obj.urlList) {
    obj.ws = obj.urlList
    delete obj.as
  }
  if (obj.peerAddresses) obj['x.pe'] = obj.peerAddresses

  let result = 'magnet:?'
  Object.keys(obj)
    .filter(key => key.length === 2 || key === 'x.pe')
    .forEach((key, i) => {
      const values = Array.isArray(obj[key]) ? obj[key] : [obj[key]]
      values.forEach((val, j) => {
        if ((i > 0 || j > 0) && ((key !== 'kt' && key !== 'so') || j === 0)) result += '&'

        if (key === 'dn') val = encodeURIComponent(val).replace(/%20/g, '+')
        if (key === 'tr' || key === 'as' || key === 'ws') {
          val = encodeURIComponent(val)
        }
        // Don't URI encode BEP46 keys
        if (key === 'xs' && !val.startsWith('urn:btpk:')) {
          val = encodeURIComponent(val)
        }
        if (key === 'kt') val = encodeURIComponent(val)
        if (key === 'so') return

        if (key === 'kt' && j > 0) result += `+${val}`
        else result += `${key}=${val}`
      })
      if (key === 'so') result += `${key}=${bep53Range.compose(values)}`
    })

  return result
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"bep53-range":8,"buffer":52,"thirty-two":297}],145:[function(require,module,exports){
/*! mediasource. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = MediaElementWrapper

var inherits = require('inherits')
var stream = require('readable-stream')
var toArrayBuffer = require('to-arraybuffer')

var MediaSource = typeof window !== 'undefined' && window.MediaSource

var DEFAULT_BUFFER_DURATION = 60 // seconds

function MediaElementWrapper (elem, opts) {
  var self = this
  if (!(self instanceof MediaElementWrapper)) return new MediaElementWrapper(elem, opts)

  if (!MediaSource) throw new Error('web browser lacks MediaSource support')

  if (!opts) opts = {}
  self._debug = opts.debug
  self._bufferDuration = opts.bufferDuration || DEFAULT_BUFFER_DURATION
  self._elem = elem
  self._mediaSource = new MediaSource()
  self._streams = []
  self.detailedError = null

  self._errorHandler = function () {
    self._elem.removeEventListener('error', self._errorHandler)
    var streams = self._streams.slice()
    streams.forEach(function (stream) {
      stream.destroy(self._elem.error)
    })
  }
  self._elem.addEventListener('error', self._errorHandler)

  self._elem.src = window.URL.createObjectURL(self._mediaSource)
}

/*
 * `obj` can be a previous value returned by this function
 * or a string
 */
MediaElementWrapper.prototype.createWriteStream = function (obj) {
  var self = this

  return new MediaSourceStream(self, obj)
}

/*
 * Use to trigger an error on the underlying media element
 */
MediaElementWrapper.prototype.error = function (err) {
  var self = this

  // be careful not to overwrite any existing detailedError values
  if (!self.detailedError) {
    self.detailedError = err
  }
  self._dumpDebugData()
  try {
    self._mediaSource.endOfStream('decode')
  } catch (err) {}

  try {
    // Attempt to clean up object URL
    window.URL.revokeObjectURL(self._elem.src)
  } catch (err) {}
}

/*
 * When self._debug is set, dump all data to files
 */
MediaElementWrapper.prototype._dumpDebugData = function () {
  var self = this

  if (self._debug) {
    self._debug = false // prevent multiple dumps on multiple errors
    self._streams.forEach(function (stream, i) {
      downloadBuffers(stream._debugBuffers, 'mediasource-stream-' + i)
    })
  }
}

inherits(MediaSourceStream, stream.Writable)

function MediaSourceStream (wrapper, obj) {
  var self = this
  stream.Writable.call(self)

  self._wrapper = wrapper
  self._elem = wrapper._elem
  self._mediaSource = wrapper._mediaSource
  self._allStreams = wrapper._streams
  self._allStreams.push(self)
  self._bufferDuration = wrapper._bufferDuration
  self._sourceBuffer = null
  self._debugBuffers = []

  self._openHandler = function () {
    self._onSourceOpen()
  }
  self._flowHandler = function () {
    self._flow()
  }
  self._errorHandler = function (err) {
    if (!self.destroyed) {
      self.emit('error', err)
    }
  }

  if (typeof obj === 'string') {
    self._type = obj
    // Need to create a new sourceBuffer
    if (self._mediaSource.readyState === 'open') {
      self._createSourceBuffer()
    } else {
      self._mediaSource.addEventListener('sourceopen', self._openHandler)
    }
  } else if (obj._sourceBuffer === null) {
    obj.destroy()
    self._type = obj._type // The old stream was created but hasn't finished initializing
    self._mediaSource.addEventListener('sourceopen', self._openHandler)
  } else if (obj._sourceBuffer) {
    obj.destroy()
    self._type = obj._type
    self._sourceBuffer = obj._sourceBuffer // Copy over the old sourceBuffer
    self._debugBuffers = obj._debugBuffers // Copy over previous debug data
    self._sourceBuffer.addEventListener('updateend', self._flowHandler)
    self._sourceBuffer.addEventListener('error', self._errorHandler)
  } else {
    throw new Error('The argument to MediaElementWrapper.createWriteStream must be a string or a previous stream returned from that function')
  }

  self._elem.addEventListener('timeupdate', self._flowHandler)

  self.on('error', function (err) {
    self._wrapper.error(err)
  })

  self.on('finish', function () {
    if (self.destroyed) return
    self._finished = true
    if (self._allStreams.every(function (other) { return other._finished })) {
      self._wrapper._dumpDebugData()
      try {
        self._mediaSource.endOfStream()
      } catch (err) {}
    }
  })
}

MediaSourceStream.prototype._onSourceOpen = function () {
  var self = this
  if (self.destroyed) return

  self._mediaSource.removeEventListener('sourceopen', self._openHandler)
  self._createSourceBuffer()
}

MediaSourceStream.prototype.destroy = function (err) {
  var self = this
  if (self.destroyed) return
  self.destroyed = true

  // Remove from allStreams
  self._allStreams.splice(self._allStreams.indexOf(self), 1)

  self._mediaSource.removeEventListener('sourceopen', self._openHandler)
  self._elem.removeEventListener('timeupdate', self._flowHandler)
  if (self._sourceBuffer) {
    self._sourceBuffer.removeEventListener('updateend', self._flowHandler)
    self._sourceBuffer.removeEventListener('error', self._errorHandler)
    if (self._mediaSource.readyState === 'open') {
      self._sourceBuffer.abort()
    }
  }

  if (err) self.emit('error', err)
  self.emit('close')
}

MediaSourceStream.prototype._createSourceBuffer = function () {
  var self = this
  if (self.destroyed) return

  if (MediaSource.isTypeSupported(self._type)) {
    self._sourceBuffer = self._mediaSource.addSourceBuffer(self._type)
    self._sourceBuffer.addEventListener('updateend', self._flowHandler)
    self._sourceBuffer.addEventListener('error', self._errorHandler)
    if (self._cb) {
      var cb = self._cb
      self._cb = null
      cb()
    }
  } else {
    self.destroy(new Error('The provided type is not supported'))
  }
}

MediaSourceStream.prototype._write = function (chunk, encoding, cb) {
  var self = this
  if (self.destroyed) return
  if (!self._sourceBuffer) {
    self._cb = function (err) {
      if (err) return cb(err)
      self._write(chunk, encoding, cb)
    }
    return
  }

  if (self._sourceBuffer.updating) {
    return cb(new Error('Cannot append buffer while source buffer updating'))
  }

  var arr = toArrayBuffer(chunk)
  if (self._wrapper._debug) {
    self._debugBuffers.push(arr)
  }

  try {
    self._sourceBuffer.appendBuffer(arr)
  } catch (err) {
    // appendBuffer can throw for a number of reasons, most notably when the data
    // being appended is invalid or if appendBuffer is called after another error
    // already occurred on the media element. In Chrome, there may be useful debugging
    // info in chrome://media-internals
    self.destroy(err)
    return
  }
  self._cb = cb
}

MediaSourceStream.prototype._flow = function () {
  var self = this

  if (self.destroyed || !self._sourceBuffer || self._sourceBuffer.updating) {
    return
  }

  if (self._mediaSource.readyState === 'open') {
    // check buffer size
    if (self._getBufferDuration() > self._bufferDuration) {
      return
    }
  }

  if (self._cb) {
    var cb = self._cb
    self._cb = null
    cb()
  }
}

// TODO: if zero actually works in all browsers, remove the logic associated with this below
var EPSILON = 0

MediaSourceStream.prototype._getBufferDuration = function () {
  var self = this

  var buffered = self._sourceBuffer.buffered
  var currentTime = self._elem.currentTime
  var bufferEnd = -1 // end of the buffer
  // This is a little over complex because some browsers seem to separate the
  // buffered region into multiple sections with slight gaps.
  for (var i = 0; i < buffered.length; i++) {
    var start = buffered.start(i)
    var end = buffered.end(i) + EPSILON

    if (start > currentTime) {
      // Reached past the joined buffer
      break
    } else if (bufferEnd >= 0 || currentTime <= end) {
      // Found the start/continuation of the joined buffer
      bufferEnd = end
    }
  }

  var bufferedTime = bufferEnd - currentTime
  if (bufferedTime < 0) {
    bufferedTime = 0
  }

  return bufferedTime
}

function downloadBuffers (bufs, name) {
  var a = document.createElement('a')
  a.href = window.URL.createObjectURL(new window.Blob(bufs))
  a.download = name
  a.click()
}

},{"inherits":138,"readable-stream":160,"to-arraybuffer":302}],146:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],147:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":149,"./_stream_writable":151,"_process":206,"dup":13,"inherits":138}],148:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":150,"dup":14,"inherits":138}],149:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":146,"./_stream_duplex":147,"./internal/streams/async_iterator":152,"./internal/streams/buffer_list":153,"./internal/streams/destroy":154,"./internal/streams/from":156,"./internal/streams/state":158,"./internal/streams/stream":159,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],150:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":146,"./_stream_duplex":147,"dup":16,"inherits":138}],151:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":146,"./_stream_duplex":147,"./internal/streams/destroy":154,"./internal/streams/state":158,"./internal/streams/stream":159,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],152:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":155,"_process":206,"dup":18}],153:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],154:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],155:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":146,"dup":21}],156:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],157:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":146,"./end-of-stream":155,"dup":23}],158:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":146,"dup":24}],159:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],160:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":147,"./lib/_stream_passthrough.js":148,"./lib/_stream_readable.js":149,"./lib/_stream_transform.js":150,"./lib/_stream_writable.js":151,"./lib/internal/streams/end-of-stream.js":155,"./lib/internal/streams/pipeline.js":157,"dup":26}],161:[function(require,module,exports){
module.exports = Storage

const queueMicrotask = require('queue-microtask')

function Storage (chunkLength, opts) {
  if (!(this instanceof Storage)) return new Storage(chunkLength, opts)
  if (!opts) opts = {}

  this.chunkLength = Number(chunkLength)
  if (!this.chunkLength) throw new Error('First argument must be a chunk length')

  this.chunks = []
  this.closed = false
  this.length = Number(opts.length) || Infinity

  if (this.length !== Infinity) {
    this.lastChunkLength = (this.length % this.chunkLength) || this.chunkLength
    this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1
  }
}

Storage.prototype.put = function (index, buf, cb) {
  if (this.closed) return nextTick(cb, new Error('Storage is closed'))

  const isLastChunk = (index === this.lastChunkIndex)
  if (isLastChunk && buf.length !== this.lastChunkLength) {
    return nextTick(cb, new Error('Last chunk length must be ' + this.lastChunkLength))
  }
  if (!isLastChunk && buf.length !== this.chunkLength) {
    return nextTick(cb, new Error('Chunk length must be ' + this.chunkLength))
  }
  this.chunks[index] = buf
  nextTick(cb, null)
}

Storage.prototype.get = function (index, opts, cb) {
  if (typeof opts === 'function') return this.get(index, null, opts)
  if (this.closed) return nextTick(cb, new Error('Storage is closed'))
  const buf = this.chunks[index]
  if (!buf) {
    const err = new Error('Chunk not found')
    err.notFound = true
    return nextTick(cb, err)
  }
  if (!opts) return nextTick(cb, null, buf)

  const offset = opts.offset || 0
  const len = opts.length || (buf.length - offset)

  if (opts.offset === 0 && len === buf.length - offset) {
    return nextTick(cb, null, buf)
  }
  nextTick(cb, null, buf.slice(offset, len + offset))
}

Storage.prototype.close = Storage.prototype.destroy = function (cb) {
  if (this.closed) return nextTick(cb, new Error('Storage is closed'))
  this.closed = true
  this.chunks = null
  nextTick(cb, null)
}

function nextTick (cb, err, val) {
  queueMicrotask(function () {
    if (cb) cb(err, val)
  })
}

},{"queue-microtask":212}],162:[function(require,module,exports){
(function (Buffer){(function (){
// This is an intentionally recursive require. I don't like it either.
var Box = require('./index')
var Descriptor = require('./descriptor')
var uint64be = require('uint64be')

var TIME_OFFSET = 2082844800000

/*
TODO:
test these
add new box versions
*/

// These have 'version' and 'flags' fields in the headers
exports.fullBoxes = {}
var fullBoxes = [
  'mvhd',
  'tkhd',
  'mdhd',
  'vmhd',
  'smhd',
  'stsd',
  'esds',
  'stsz',
  'stco',
  'co64',
  'stss',
  'stts',
  'ctts',
  'stsc',
  'dref',
  'elst',
  'hdlr',
  'mehd',
  'trex',
  'mfhd',
  'tfhd',
  'tfdt',
  'trun'
]
fullBoxes.forEach(function (type) {
  exports.fullBoxes[type] = true
})

exports.ftyp = {}
exports.ftyp.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.ftyp.encodingLength(box))
  var brands = box.compatibleBrands || []
  buf.write(box.brand, 0, 4, 'ascii')
  buf.writeUInt32BE(box.brandVersion, 4)
  for (var i = 0; i < brands.length; i++) buf.write(brands[i], 8 + (i * 4), 4, 'ascii')
  exports.ftyp.encode.bytes = 8 + brands.length * 4
  return buf
}
exports.ftyp.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var brand = buf.toString('ascii', 0, 4)
  var version = buf.readUInt32BE(4)
  var compatibleBrands = []
  for (var i = 8; i < buf.length; i += 4) compatibleBrands.push(buf.toString('ascii', i, i + 4))
  return {
    brand: brand,
    brandVersion: version,
    compatibleBrands: compatibleBrands
  }
}
exports.ftyp.encodingLength = function (box) {
  return 8 + (box.compatibleBrands || []).length * 4
}

exports.mvhd = {}
exports.mvhd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(96)
  writeDate(box.ctime || new Date(), buf, 0)
  writeDate(box.mtime || new Date(), buf, 4)
  buf.writeUInt32BE(box.timeScale || 0, 8)
  buf.writeUInt32BE(box.duration || 0, 12)
  writeFixed32(box.preferredRate || 0, buf, 16)
  writeFixed16(box.preferredVolume || 0, buf, 20)
  writeReserved(buf, 22, 32)
  writeMatrix(box.matrix, buf, 32)
  buf.writeUInt32BE(box.previewTime || 0, 68)
  buf.writeUInt32BE(box.previewDuration || 0, 72)
  buf.writeUInt32BE(box.posterTime || 0, 76)
  buf.writeUInt32BE(box.selectionTime || 0, 80)
  buf.writeUInt32BE(box.selectionDuration || 0, 84)
  buf.writeUInt32BE(box.currentTime || 0, 88)
  buf.writeUInt32BE(box.nextTrackId || 0, 92)
  exports.mvhd.encode.bytes = 96
  return buf
}
exports.mvhd.decode = function (buf, offset) {
  buf = buf.slice(offset)
  return {
    ctime: readDate(buf, 0),
    mtime: readDate(buf, 4),
    timeScale: buf.readUInt32BE(8),
    duration: buf.readUInt32BE(12),
    preferredRate: readFixed32(buf, 16),
    preferredVolume: readFixed16(buf, 20),
    matrix: readMatrix(buf.slice(32, 68)),
    previewTime: buf.readUInt32BE(68),
    previewDuration: buf.readUInt32BE(72),
    posterTime: buf.readUInt32BE(76),
    selectionTime: buf.readUInt32BE(80),
    selectionDuration: buf.readUInt32BE(84),
    currentTime: buf.readUInt32BE(88),
    nextTrackId: buf.readUInt32BE(92)
  }
}
exports.mvhd.encodingLength = function (box) {
  return 96
}

exports.tkhd = {}
exports.tkhd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(80)
  writeDate(box.ctime || new Date(), buf, 0)
  writeDate(box.mtime || new Date(), buf, 4)
  buf.writeUInt32BE(box.trackId || 0, 8)
  writeReserved(buf, 12, 16)
  buf.writeUInt32BE(box.duration || 0, 16)
  writeReserved(buf, 20, 28)
  buf.writeUInt16BE(box.layer || 0, 28)
  buf.writeUInt16BE(box.alternateGroup || 0, 30)
  buf.writeUInt16BE(box.volume || 0, 32)
  writeMatrix(box.matrix, buf, 36)
  buf.writeUInt32BE(box.trackWidth || 0, 72)
  buf.writeUInt32BE(box.trackHeight || 0, 76)
  exports.tkhd.encode.bytes = 80
  return buf
}
exports.tkhd.decode = function (buf, offset) {
  buf = buf.slice(offset)
  return {
    ctime: readDate(buf, 0),
    mtime: readDate(buf, 4),
    trackId: buf.readUInt32BE(8),
    duration: buf.readUInt32BE(16),
    layer: buf.readUInt16BE(28),
    alternateGroup: buf.readUInt16BE(30),
    volume: buf.readUInt16BE(32),
    matrix: readMatrix(buf.slice(36, 72)),
    trackWidth: buf.readUInt32BE(72),
    trackHeight: buf.readUInt32BE(76)
  }
}
exports.tkhd.encodingLength = function (box) {
  return 80
}

exports.mdhd = {}
exports.mdhd.encode = function (box, buf, offset) {
  if (box.version === 1) {
    buf = buf ? buf.slice(offset) : Buffer.alloc(32)
    writeDate64(box.ctime || new Date(), buf, 0)
    writeDate64(box.mtime || new Date(), buf, 8)
    buf.writeUInt32BE(box.timeScale || 0, 16)
    // Node only supports integer <= 48bit. Waiting for BigInt!
    buf.writeUIntBE(box.duration || 0, 20, 6)
    buf.writeUInt16BE(box.language || 0, 28)
    buf.writeUInt16BE(box.quality || 0, 30)
    exports.mdhd.encode.bytes = 32
    return buf
  }

  buf = buf ? buf.slice(offset) : Buffer.alloc(20)
  writeDate(box.ctime || new Date(), buf, 0)
  writeDate(box.mtime || new Date(), buf, 4)
  buf.writeUInt32BE(box.timeScale || 0, 8)
  buf.writeUInt32BE(box.duration || 0, 12)
  buf.writeUInt16BE(box.language || 0, 16)
  buf.writeUInt16BE(box.quality || 0, 18)
  exports.mdhd.encode.bytes = 20
  return buf
}

exports.mdhd.decode = function (buf, offset, end) {
  buf = buf.slice(offset)

  var version1 = (end - offset) !== 20

  // In version 1 creation time and modification time are unsigned long
  if (version1) {
    return {
      ctime: readDate64(buf, 0),
      mtime: readDate64(buf, 8),
      timeScale: buf.readUInt32BE(16),
      // Node only supports integer <= 48bit. Waiting for BigInt!
      duration: buf.readUIntBE(20, 6),
      language: buf.readUInt16BE(28),
      quality: buf.readUInt16BE(30)
    }
  }

  return {
    ctime: readDate(buf, 0),
    mtime: readDate(buf, 4),
    timeScale: buf.readUInt32BE(8),
    duration: buf.readUInt32BE(12),
    language: buf.readUInt16BE(16),
    quality: buf.readUInt16BE(18)
  }
}
exports.mdhd.encodingLength = function (box) {
  if (box.version === 1) return 32

  return 20
}

exports.vmhd = {}
exports.vmhd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(8)
  buf.writeUInt16BE(box.graphicsMode || 0, 0)
  var opcolor = box.opcolor || [0, 0, 0]
  buf.writeUInt16BE(opcolor[0], 2)
  buf.writeUInt16BE(opcolor[1], 4)
  buf.writeUInt16BE(opcolor[2], 6)
  exports.vmhd.encode.bytes = 8
  return buf
}
exports.vmhd.decode = function (buf, offset) {
  buf = buf.slice(offset)
  return {
    graphicsMode: buf.readUInt16BE(0),
    opcolor: [buf.readUInt16BE(2), buf.readUInt16BE(4), buf.readUInt16BE(6)]
  }
}
exports.vmhd.encodingLength = function (box) {
  return 8
}

exports.smhd = {}
exports.smhd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(4)
  buf.writeUInt16BE(box.balance || 0, 0)
  writeReserved(buf, 2, 4)
  exports.smhd.encode.bytes = 4
  return buf
}
exports.smhd.decode = function (buf, offset) {
  buf = buf.slice(offset)
  return {
    balance: buf.readUInt16BE(0)
  }
}
exports.smhd.encodingLength = function (box) {
  return 4
}

exports.stsd = {}
exports.stsd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.stsd.encodingLength(box))
  var entries = box.entries || []

  buf.writeUInt32BE(entries.length, 0)

  var ptr = 4
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    Box.encode(entry, buf, ptr)
    ptr += Box.encode.bytes
  }

  exports.stsd.encode.bytes = ptr
  return buf
}
exports.stsd.decode = function (buf, offset, end) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)
  var ptr = 4

  for (var i = 0; i < num; i++) {
    var entry = Box.decode(buf, ptr, end)
    entries[i] = entry
    ptr += entry.length
  }

  return {
    entries: entries
  }
}
exports.stsd.encodingLength = function (box) {
  var totalSize = 4
  if (!box.entries) return totalSize
  for (var i = 0; i < box.entries.length; i++) {
    totalSize += Box.encodingLength(box.entries[i])
  }
  return totalSize
}

exports.avc1 = exports.VisualSampleEntry = {}
exports.VisualSampleEntry.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.VisualSampleEntry.encodingLength(box))

  writeReserved(buf, 0, 6)
  buf.writeUInt16BE(box.dataReferenceIndex || 0, 6)
  writeReserved(buf, 8, 24)
  buf.writeUInt16BE(box.width || 0, 24)
  buf.writeUInt16BE(box.height || 0, 26)
  buf.writeUInt32BE(box.hResolution || 0x480000, 28)
  buf.writeUInt32BE(box.vResolution || 0x480000, 32)
  writeReserved(buf, 36, 40)
  buf.writeUInt16BE(box.frameCount || 1, 40)
  var compressorName = box.compressorName || ''
  var nameLen = Math.min(compressorName.length, 31)
  buf.writeUInt8(nameLen, 42)
  buf.write(compressorName, 43, nameLen, 'utf8')
  buf.writeUInt16BE(box.depth || 0x18, 74)
  buf.writeInt16BE(-1, 76)

  var ptr = 78
  var children = box.children || []
  children.forEach(function (child) {
    Box.encode(child, buf, ptr)
    ptr += Box.encode.bytes
  })
  exports.VisualSampleEntry.encode.bytes = ptr
}
exports.VisualSampleEntry.decode = function (buf, offset, end) {
  buf = buf.slice(offset)
  var length = end - offset
  var nameLen = Math.min(buf.readUInt8(42), 31)
  var box = {
    dataReferenceIndex: buf.readUInt16BE(6),
    width: buf.readUInt16BE(24),
    height: buf.readUInt16BE(26),
    hResolution: buf.readUInt32BE(28),
    vResolution: buf.readUInt32BE(32),
    frameCount: buf.readUInt16BE(40),
    compressorName: buf.toString('utf8', 43, 43 + nameLen),
    depth: buf.readUInt16BE(74),
    children: []
  }

  var ptr = 78
  while (length - ptr >= 8) {
    var child = Box.decode(buf, ptr, length)
    box.children.push(child)
    box[child.type] = child
    ptr += child.length
  }

  return box
}
exports.VisualSampleEntry.encodingLength = function (box) {
  var len = 78
  var children = box.children || []
  children.forEach(function (child) {
    len += Box.encodingLength(child)
  })
  return len
}

exports.avcC = {}
exports.avcC.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(box.buffer.length)

  box.buffer.copy(buf)
  exports.avcC.encode.bytes = box.buffer.length
}
exports.avcC.decode = function (buf, offset, end) {
  buf = buf.slice(offset, end)

  return {
    mimeCodec: buf.toString('hex', 1, 4),
    buffer: Buffer.from(buf)
  }
}
exports.avcC.encodingLength = function (box) {
  return box.buffer.length
}

exports.mp4a = exports.AudioSampleEntry = {}
exports.AudioSampleEntry.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.AudioSampleEntry.encodingLength(box))

  writeReserved(buf, 0, 6)
  buf.writeUInt16BE(box.dataReferenceIndex || 0, 6)
  writeReserved(buf, 8, 16)
  buf.writeUInt16BE(box.channelCount || 2, 16)
  buf.writeUInt16BE(box.sampleSize || 16, 18)
  writeReserved(buf, 20, 24)
  buf.writeUInt32BE(box.sampleRate || 0, 24)

  var ptr = 28
  var children = box.children || []
  children.forEach(function (child) {
    Box.encode(child, buf, ptr)
    ptr += Box.encode.bytes
  })
  exports.AudioSampleEntry.encode.bytes = ptr
}
exports.AudioSampleEntry.decode = function (buf, offset, end) {
  buf = buf.slice(offset, end)
  var length = end - offset
  var box = {
    dataReferenceIndex: buf.readUInt16BE(6),
    channelCount: buf.readUInt16BE(16),
    sampleSize: buf.readUInt16BE(18),
    sampleRate: buf.readUInt32BE(24),
    children: []
  }

  var ptr = 28
  while (length - ptr >= 8) {
    var child = Box.decode(buf, ptr, length)
    box.children.push(child)
    box[child.type] = child
    ptr += child.length
  }

  return box
}
exports.AudioSampleEntry.encodingLength = function (box) {
  var len = 28
  var children = box.children || []
  children.forEach(function (child) {
    len += Box.encodingLength(child)
  })
  return len
}

exports.esds = {}
exports.esds.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(box.buffer.length)

  box.buffer.copy(buf, 0)
  exports.esds.encode.bytes = box.buffer.length
}
exports.esds.decode = function (buf, offset, end) {
  buf = buf.slice(offset, end)

  var desc = Descriptor.Descriptor.decode(buf, 0, buf.length)
  var esd = (desc.tagName === 'ESDescriptor') ? desc : {}
  var dcd = esd.DecoderConfigDescriptor || {}
  var oti = dcd.oti || 0
  var dsi = dcd.DecoderSpecificInfo
  var audioConfig = dsi ? (dsi.buffer.readUInt8(0) & 0xf8) >> 3 : 0

  var mimeCodec = null
  if (oti) {
    mimeCodec = oti.toString(16)
    if (audioConfig) {
      mimeCodec += '.' + audioConfig
    }
  }

  return {
    mimeCodec: mimeCodec,
    buffer: Buffer.from(buf.slice(0))
  }
}
exports.esds.encodingLength = function (box) {
  return box.buffer.length
}

// TODO: integrate the two versions in a saner way
exports.stsz = {}
exports.stsz.encode = function (box, buf, offset) {
  var entries = box.entries || []
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.stsz.encodingLength(box))

  buf.writeUInt32BE(0, 0)
  buf.writeUInt32BE(entries.length, 4)

  for (var i = 0; i < entries.length; i++) {
    buf.writeUInt32BE(entries[i], i * 4 + 8)
  }

  exports.stsz.encode.bytes = 8 + entries.length * 4
  return buf
}
exports.stsz.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var size = buf.readUInt32BE(0)
  var num = buf.readUInt32BE(4)
  var entries = new Array(num)

  for (var i = 0; i < num; i++) {
    if (size === 0) {
      entries[i] = buf.readUInt32BE(i * 4 + 8)
    } else {
      entries[i] = size
    }
  }

  return {
    entries: entries
  }
}
exports.stsz.encodingLength = function (box) {
  return 8 + box.entries.length * 4
}

exports.stss =
exports.stco = {}
exports.stco.encode = function (box, buf, offset) {
  var entries = box.entries || []
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.stco.encodingLength(box))

  buf.writeUInt32BE(entries.length, 0)

  for (var i = 0; i < entries.length; i++) {
    buf.writeUInt32BE(entries[i], i * 4 + 4)
  }

  exports.stco.encode.bytes = 4 + entries.length * 4
  return buf
}
exports.stco.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)

  for (var i = 0; i < num; i++) {
    entries[i] = buf.readUInt32BE(i * 4 + 4)
  }

  return {
    entries: entries
  }
}
exports.stco.encodingLength = function (box) {
  return 4 + box.entries.length * 4
}

exports.co64 = {}
exports.co64.encode = function (box, buf, offset) {
  var entries = box.entries || []
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.co64.encodingLength(box))

  buf.writeUInt32BE(entries.length, 0)

  for (var i = 0; i < entries.length; i++) {
    uint64be.encode(entries[i], buf, i * 8 + 4)
  }

  exports.co64.encode.bytes = 4 + entries.length * 8
  return buf
}
exports.co64.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)

  for (var i = 0; i < num; i++) {
    entries[i] = uint64be.decode(buf, i * 8 + 4)
  }

  return {
    entries: entries
  }
}
exports.co64.encodingLength = function (box) {
  return 4 + box.entries.length * 8
}

exports.stts = {}
exports.stts.encode = function (box, buf, offset) {
  var entries = box.entries || []
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.stts.encodingLength(box))

  buf.writeUInt32BE(entries.length, 0)

  for (var i = 0; i < entries.length; i++) {
    var ptr = i * 8 + 4
    buf.writeUInt32BE(entries[i].count || 0, ptr)
    buf.writeUInt32BE(entries[i].duration || 0, ptr + 4)
  }

  exports.stts.encode.bytes = 4 + box.entries.length * 8
  return buf
}
exports.stts.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)

  for (var i = 0; i < num; i++) {
    var ptr = i * 8 + 4
    entries[i] = {
      count: buf.readUInt32BE(ptr),
      duration: buf.readUInt32BE(ptr + 4)
    }
  }

  return {
    entries: entries
  }
}
exports.stts.encodingLength = function (box) {
  return 4 + box.entries.length * 8
}

exports.ctts = {}
exports.ctts.encode = function (box, buf, offset) {
  var entries = box.entries || []
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.ctts.encodingLength(box))

  buf.writeUInt32BE(entries.length, 0)

  for (var i = 0; i < entries.length; i++) {
    var ptr = i * 8 + 4
    buf.writeUInt32BE(entries[i].count || 0, ptr)
    buf.writeUInt32BE(entries[i].compositionOffset || 0, ptr + 4)
  }

  exports.ctts.encode.bytes = 4 + entries.length * 8
  return buf
}
exports.ctts.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)

  for (var i = 0; i < num; i++) {
    var ptr = i * 8 + 4
    entries[i] = {
      count: buf.readUInt32BE(ptr),
      compositionOffset: buf.readInt32BE(ptr + 4)
    }
  }

  return {
    entries: entries
  }
}
exports.ctts.encodingLength = function (box) {
  return 4 + box.entries.length * 8
}

exports.stsc = {}
exports.stsc.encode = function (box, buf, offset) {
  var entries = box.entries || []
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.stsc.encodingLength(box))

  buf.writeUInt32BE(entries.length, 0)

  for (var i = 0; i < entries.length; i++) {
    var ptr = i * 12 + 4
    buf.writeUInt32BE(entries[i].firstChunk || 0, ptr)
    buf.writeUInt32BE(entries[i].samplesPerChunk || 0, ptr + 4)
    buf.writeUInt32BE(entries[i].sampleDescriptionId || 0, ptr + 8)
  }

  exports.stsc.encode.bytes = 4 + entries.length * 12
  return buf
}
exports.stsc.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)

  for (var i = 0; i < num; i++) {
    var ptr = i * 12 + 4
    entries[i] = {
      firstChunk: buf.readUInt32BE(ptr),
      samplesPerChunk: buf.readUInt32BE(ptr + 4),
      sampleDescriptionId: buf.readUInt32BE(ptr + 8)
    }
  }

  return {
    entries: entries
  }
}
exports.stsc.encodingLength = function (box) {
  return 4 + box.entries.length * 12
}

exports.dref = {}
exports.dref.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.dref.encodingLength(box))
  var entries = box.entries || []

  buf.writeUInt32BE(entries.length, 0)

  var ptr = 4
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    var size = (entry.buf ? entry.buf.length : 0) + 4 + 4

    buf.writeUInt32BE(size, ptr)
    ptr += 4

    buf.write(entry.type, ptr, 4, 'ascii')
    ptr += 4

    if (entry.buf) {
      entry.buf.copy(buf, ptr)
      ptr += entry.buf.length
    }
  }

  exports.dref.encode.bytes = ptr
  return buf
}
exports.dref.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)
  var ptr = 4

  for (var i = 0; i < num; i++) {
    var size = buf.readUInt32BE(ptr)
    var type = buf.toString('ascii', ptr + 4, ptr + 8)
    var tmp = buf.slice(ptr + 8, ptr + size)
    ptr += size

    entries[i] = {
      type: type,
      buf: tmp
    }
  }

  return {
    entries: entries
  }
}
exports.dref.encodingLength = function (box) {
  var totalSize = 4
  if (!box.entries) return totalSize
  for (var i = 0; i < box.entries.length; i++) {
    var buf = box.entries[i].buf
    totalSize += (buf ? buf.length : 0) + 4 + 4
  }
  return totalSize
}

exports.elst = {}
exports.elst.encode = function (box, buf, offset) {
  var entries = box.entries || []
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.elst.encodingLength(box))

  buf.writeUInt32BE(entries.length, 0)

  for (var i = 0; i < entries.length; i++) {
    var ptr = i * 12 + 4
    buf.writeUInt32BE(entries[i].trackDuration || 0, ptr)
    buf.writeUInt32BE(entries[i].mediaTime || 0, ptr + 4)
    writeFixed32(entries[i].mediaRate || 0, buf, ptr + 8)
  }

  exports.elst.encode.bytes = 4 + entries.length * 12
  return buf
}
exports.elst.decode = function (buf, offset) {
  buf = buf.slice(offset)
  var num = buf.readUInt32BE(0)
  var entries = new Array(num)

  for (var i = 0; i < num; i++) {
    var ptr = i * 12 + 4
    entries[i] = {
      trackDuration: buf.readUInt32BE(ptr),
      mediaTime: buf.readInt32BE(ptr + 4),
      mediaRate: readFixed32(buf, ptr + 8)
    }
  }

  return {
    entries: entries
  }
}
exports.elst.encodingLength = function (box) {
  return 4 + box.entries.length * 12
}

exports.hdlr = {}
exports.hdlr.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(exports.hdlr.encodingLength(box))

  var len = 21 + (box.name || '').length
  buf.fill(0, 0, len)

  buf.write(box.handlerType || '', 4, 4, 'ascii')
  writeString(box.name || '', buf, 20)

  exports.hdlr.encode.bytes = len
  return buf
}
exports.hdlr.decode = function (buf, offset, end) {
  buf = buf.slice(offset)
  return {
    handlerType: buf.toString('ascii', 4, 8),
    name: readString(buf, 20, end)
  }
}
exports.hdlr.encodingLength = function (box) {
  return 21 + (box.name || '').length
}

exports.mehd = {}
exports.mehd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(4)

  buf.writeUInt32BE(box.fragmentDuration || 0, 0)
  exports.mehd.encode.bytes = 4
  return buf
}
exports.mehd.decode = function (buf, offset) {
  buf = buf.slice(offset)
  return {
    fragmentDuration: buf.readUInt32BE(0)
  }
}
exports.mehd.encodingLength = function (box) {
  return 4
}

exports.trex = {}
exports.trex.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(20)

  buf.writeUInt32BE(box.trackId || 0, 0)
  buf.writeUInt32BE(box.defaultSampleDescriptionIndex || 0, 4)
  buf.writeUInt32BE(box.defaultSampleDuration || 0, 8)
  buf.writeUInt32BE(box.defaultSampleSize || 0, 12)
  buf.writeUInt32BE(box.defaultSampleFlags || 0, 16)
  exports.trex.encode.bytes = 20
  return buf
}
exports.trex.decode = function (buf, offset) {
  buf = buf.slice(offset)
  return {
    trackId: buf.readUInt32BE(0),
    defaultSampleDescriptionIndex: buf.readUInt32BE(4),
    defaultSampleDuration: buf.readUInt32BE(8),
    defaultSampleSize: buf.readUInt32BE(12),
    defaultSampleFlags: buf.readUInt32BE(16)
  }
}
exports.trex.encodingLength = function (box) {
  return 20
}

exports.mfhd = {}
exports.mfhd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(4)

  buf.writeUInt32BE(box.sequenceNumber || 0, 0)
  exports.mfhd.encode.bytes = 4
  return buf
}
exports.mfhd.decode = function (buf, offset) {
  return {
    sequenceNumber: buf.readUInt32BE(0)
  }
}
exports.mfhd.encodingLength = function (box) {
  return 4
}

exports.tfhd = {}
exports.tfhd.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(4)
  buf.writeUInt32BE(box.trackId, 0)
  exports.tfhd.encode.bytes = 4
  return buf
}
exports.tfhd.decode = function (buf, offset) {
  // TODO: this
}
exports.tfhd.encodingLength = function (box) {
  // TODO: this is wrong!
  return 4
}

exports.tfdt = {}
exports.tfdt.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(4)

  buf.writeUInt32BE(box.baseMediaDecodeTime || 0, 0)
  exports.tfdt.encode.bytes = 4
  return buf
}
exports.tfdt.decode = function (buf, offset) {
  // TODO: this
}
exports.tfdt.encodingLength = function (box) {
  return 4
}

exports.trun = {}
exports.trun.encode = function (box, buf, offset) {
  buf = buf ? buf.slice(offset) : Buffer.alloc(8 + box.entries.length * 16)

  // TODO: this is wrong
  buf.writeUInt32BE(box.entries.length, 0)
  buf.writeInt32BE(box.dataOffset, 4)
  var ptr = 8
  for (var i = 0; i < box.entries.length; i++) {
    var entry = box.entries[i]
    buf.writeUInt32BE(entry.sampleDuration, ptr)
    ptr += 4

    buf.writeUInt32BE(entry.sampleSize, ptr)
    ptr += 4

    buf.writeUInt32BE(entry.sampleFlags, ptr)
    ptr += 4

    if ((box.version || 0) === 0) {
      buf.writeUInt32BE(entry.sampleCompositionTimeOffset, ptr)
    } else {
      buf.writeInt32BE(entry.sampleCompositionTimeOffset, ptr)
    }
    ptr += 4
  }
  exports.trun.encode.bytes = ptr
}
exports.trun.decode = function (buf, offset) {
  // TODO: this
}
exports.trun.encodingLength = function (box) {
  // TODO: this is wrong
  return 8 + box.entries.length * 16
}

exports.mdat = {}
exports.mdat.encode = function (box, buf, offset) {
  if (box.buffer) {
    box.buffer.copy(buf, offset)
    exports.mdat.encode.bytes = box.buffer.length
  } else {
    exports.mdat.encode.bytes = exports.mdat.encodingLength(box)
  }
}
exports.mdat.decode = function (buf, start, end) {
  return {
    buffer: Buffer.from(buf.slice(start, end))
  }
}
exports.mdat.encodingLength = function (box) {
  return box.buffer ? box.buffer.length : box.contentLength
}

function writeReserved (buf, offset, end) {
  for (var i = offset; i < end; i++) buf[i] = 0
}

function writeDate (date, buf, offset) {
  buf.writeUInt32BE(Math.floor((date.getTime() + TIME_OFFSET) / 1000), offset)
}

function writeDate64 (date, buf, offset) {
  // Node only supports integer <= 48bit. Waiting for BigInt!
  buf.writeUIntBE(Math.floor((date.getTime() + TIME_OFFSET) / 1000), offset, 6)
}

// TODO: think something is wrong here
function writeFixed32 (num, buf, offset) {
  buf.writeUInt16BE(Math.floor(num) % (256 * 256), offset)
  buf.writeUInt16BE(Math.floor(num * 256 * 256) % (256 * 256), offset + 2)
}

function writeFixed16 (num, buf, offset) {
  buf[offset] = Math.floor(num) % 256
  buf[offset + 1] = Math.floor(num * 256) % 256
}

function writeMatrix (list, buf, offset) {
  if (!list) list = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (var i = 0; i < list.length; i++) {
    writeFixed32(list[i], buf, offset + i * 4)
  }
}

function writeString (str, buf, offset) {
  var strBuffer = Buffer.from(str, 'utf8')
  strBuffer.copy(buf, offset)
  buf[offset + strBuffer.length] = 0
}

function readMatrix (buf) {
  var list = new Array(buf.length / 4)
  for (var i = 0; i < list.length; i++) list[i] = readFixed32(buf, i * 4)
  return list
}

function readDate64 (buf, offset) {
  // Node only supports integer <= 48bit. Waiting for BigInt!
  return new Date(buf.readUIntBE(offset, 6) * 1000 - TIME_OFFSET)
}

function readDate (buf, offset) {
  return new Date(buf.readUInt32BE(offset) * 1000 - TIME_OFFSET)
}

function readFixed32 (buf, offset) {
  return buf.readUInt16BE(offset) + buf.readUInt16BE(offset + 2) / (256 * 256)
}

function readFixed16 (buf, offset) {
  return buf[offset] + buf[offset + 1] / 256
}

function readString (buf, offset, length) {
  var i
  for (i = 0; i < length; i++) {
    if (buf[offset + i] === 0) {
      break
    }
  }
  return buf.toString('utf8', offset, offset + i)
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"./descriptor":163,"./index":164,"buffer":52,"uint64be":306}],163:[function(require,module,exports){
(function (Buffer){(function (){
var tagToName = {
  0x03: 'ESDescriptor',
  0x04: 'DecoderConfigDescriptor',
  0x05: 'DecoderSpecificInfo',
  0x06: 'SLConfigDescriptor'
}

exports.Descriptor = {}
exports.Descriptor.decode = function (buf, start, end) {
  var tag = buf.readUInt8(start)
  var ptr = start + 1
  var lenByte
  var len = 0
  do {
    lenByte = buf.readUInt8(ptr++)
    len = (len << 7) | (lenByte & 0x7f)
  } while (lenByte & 0x80)

  var obj
  var tagName = tagToName[tag] // May be undefined; that's ok
  if (exports[tagName]) {
    obj = exports[tagName].decode(buf, ptr, end)
  } else {
    obj = {
      buffer: Buffer.from(buf.slice(ptr, ptr + len))
    }
  }

  obj.tag = tag
  obj.tagName = tagName
  obj.length = (ptr - start) + len
  obj.contentsLen = len
  return obj
}

exports.DescriptorArray = {}
exports.DescriptorArray.decode = function (buf, start, end) {
  var ptr = start
  var obj = {}
  while (ptr + 2 <= end) {
    var descriptor = exports.Descriptor.decode(buf, ptr, end)
    ptr += descriptor.length
    var tagName = tagToName[descriptor.tag] || ('Descriptor' + descriptor.tag)
    obj[tagName] = descriptor
  }
  return obj
}

exports.ESDescriptor = {}
exports.ESDescriptor.decode = function (buf, start, end) {
  var flags = buf.readUInt8(start + 2)
  var ptr = start + 3
  if (flags & 0x80) {
    ptr += 2
  }
  if (flags & 0x40) {
    var len = buf.readUInt8(ptr)
    ptr += len + 1
  }
  if (flags & 0x20) {
    ptr += 2
  }
  return exports.DescriptorArray.decode(buf, ptr, end)
}

exports.DecoderConfigDescriptor = {}
exports.DecoderConfigDescriptor.decode = function (buf, start, end) {
  var oti = buf.readUInt8(start)
  var obj = exports.DescriptorArray.decode(buf, start + 13, end)
  obj.oti = oti
  return obj
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],164:[function(require,module,exports){
(function (Buffer){(function (){
// var assert = require('assert')
var uint64be = require('uint64be')

var boxes = require('./boxes')

var UINT32_MAX = 4294967295

var Box = exports

/*
 * Lists the proper order for boxes inside containers.
 * Five-character names ending in 's' indicate arrays instead of single elements.
 */
var containers = exports.containers = {
  'moov': ['mvhd', 'meta', 'traks', 'mvex'],
  'trak': ['tkhd', 'tref', 'trgr', 'edts', 'meta', 'mdia', 'udta'],
  'edts': ['elst'],
  'mdia': ['mdhd', 'hdlr', 'elng', 'minf'],
  'minf': ['vmhd', 'smhd', 'hmhd', 'sthd', 'nmhd', 'dinf', 'stbl'],
  'dinf': ['dref'],
  'stbl': ['stsd', 'stts', 'ctts', 'cslg', 'stsc', 'stsz', 'stz2', 'stco', 'co64', 'stss', 'stsh', 'padb', 'stdp', 'sdtp', 'sbgps', 'sgpds', 'subss', 'saizs', 'saios'],
  'mvex': ['mehd', 'trexs', 'leva'],
  'moof': ['mfhd', 'meta', 'trafs'],
  'traf': ['tfhd', 'tfdt', 'trun', 'sbgps', 'sgpds', 'subss', 'saizs', 'saios', 'meta']
}

Box.encode = function (obj, buffer, offset) {
  Box.encodingLength(obj) // sets every level appropriately
  offset = offset || 0
  buffer = buffer || Buffer.alloc(obj.length)
  return Box._encode(obj, buffer, offset)
}

Box._encode = function (obj, buffer, offset) {
  var type = obj.type
  var len = obj.length
  if (len > UINT32_MAX) {
    len = 1
  }
  buffer.writeUInt32BE(len, offset)
  buffer.write(obj.type, offset + 4, 4, 'ascii')
  var ptr = offset + 8
  if (len === 1) {
    uint64be.encode(obj.length, buffer, ptr)
    ptr += 8
  }
  if (boxes.fullBoxes[type]) {
    buffer.writeUInt32BE(obj.flags || 0, ptr)
    buffer.writeUInt8(obj.version || 0, ptr)
    ptr += 4
  }

  if (containers[type]) {
    var contents = containers[type]
    contents.forEach(function (childType) {
      if (childType.length === 5) {
        var entry = obj[childType] || []
        childType = childType.substr(0, 4)
        entry.forEach(function (child) {
          Box._encode(child, buffer, ptr)
          ptr += Box.encode.bytes
        })
      } else if (obj[childType]) {
        Box._encode(obj[childType], buffer, ptr)
        ptr += Box.encode.bytes
      }
    })
    if (obj.otherBoxes) {
      obj.otherBoxes.forEach(function (child) {
        Box._encode(child, buffer, ptr)
        ptr += Box.encode.bytes
      })
    }
  } else if (boxes[type]) {
    var encode = boxes[type].encode
    encode(obj, buffer, ptr)
    ptr += encode.bytes
  } else if (obj.buffer) {
    var buf = obj.buffer
    buf.copy(buffer, ptr)
    ptr += obj.buffer.length
  } else {
    throw new Error('Either `type` must be set to a known type (not\'' + type + '\') or `buffer` must be set')
  }

  Box.encode.bytes = ptr - offset
  // assert.equal(ptr - offset, obj.length, 'Error encoding \'' + type + '\': wrote ' + ptr - offset + ' bytes, expecting ' + obj.length)
  return buffer
}

/*
 * Returns an object with `type` and `size` fields,
 * or if there isn't enough data, returns the total
 * number of bytes needed to read the headers
 */
Box.readHeaders = function (buffer, start, end) {
  start = start || 0
  end = end || buffer.length
  if (end - start < 8) {
    return 8
  }

  var len = buffer.readUInt32BE(start)
  var type = buffer.toString('ascii', start + 4, start + 8)
  var ptr = start + 8

  if (len === 1) {
    if (end - start < 16) {
      return 16
    }

    len = uint64be.decode(buffer, ptr)
    ptr += 8
  }

  var version
  var flags
  if (boxes.fullBoxes[type]) {
    version = buffer.readUInt8(ptr)
    flags = buffer.readUInt32BE(ptr) & 0xffffff
    ptr += 4
  }

  return {
    length: len,
    headersLen: ptr - start,
    contentLen: len - (ptr - start),
    type: type,
    version: version,
    flags: flags
  }
}

Box.decode = function (buffer, start, end) {
  start = start || 0
  end = end || buffer.length
  var headers = Box.readHeaders(buffer, start, end)
  if (!headers || headers.length > end - start) {
    throw new Error('Data too short')
  }

  return Box.decodeWithoutHeaders(headers, buffer, start + headers.headersLen, start + headers.length)
}

Box.decodeWithoutHeaders = function (headers, buffer, start, end) {
  start = start || 0
  end = end || buffer.length
  var type = headers.type
  var obj = {}
  if (containers[type]) {
    obj.otherBoxes = []
    var contents = containers[type]
    var ptr = start
    while (end - ptr >= 8) {
      var child = Box.decode(buffer, ptr, end)
      ptr += child.length
      if (contents.indexOf(child.type) >= 0) {
        obj[child.type] = child
      } else if (contents.indexOf(child.type + 's') >= 0) {
        var childType = child.type + 's'
        var entry = obj[childType] = obj[childType] || []
        entry.push(child)
      } else {
        obj.otherBoxes.push(child)
      }
    }
  } else if (boxes[type]) {
    var decode = boxes[type].decode
    obj = decode(buffer, start, end)
  } else {
    obj.buffer = Buffer.from(buffer.slice(start, end))
  }

  obj.length = headers.length
  obj.contentLen = headers.contentLen
  obj.type = headers.type
  obj.version = headers.version
  obj.flags = headers.flags
  return obj
}

Box.encodingLength = function (obj) {
  var type = obj.type

  var len = 8
  if (boxes.fullBoxes[type]) {
    len += 4
  }

  if (containers[type]) {
    var contents = containers[type]
    contents.forEach(function (childType) {
      if (childType.length === 5) {
        var entry = obj[childType] || []
        childType = childType.substr(0, 4)
        entry.forEach(function (child) {
          child.type = childType
          len += Box.encodingLength(child)
        })
      } else if (obj[childType]) {
        var child = obj[childType]
        child.type = childType
        len += Box.encodingLength(child)
      }
    })
    if (obj.otherBoxes) {
      obj.otherBoxes.forEach(function (child) {
        len += Box.encodingLength(child)
      })
    }
  } else if (boxes[type]) {
    len += boxes[type].encodingLength(obj)
  } else if (obj.buffer) {
    len += obj.buffer.length
  } else {
    throw new Error('Either `type` must be set to a known type (not\'' + type + '\') or `buffer` must be set')
  }

  if (len > UINT32_MAX) {
    len += 8
  }

  obj.length = len
  return len
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"./boxes":162,"buffer":52,"uint64be":306}],165:[function(require,module,exports){
(function (Buffer){(function (){
var stream = require('readable-stream')
var nextEvent = require('next-event')
var Box = require('mp4-box-encoding')

var EMPTY = Buffer.alloc(0)

class Decoder extends stream.Writable {
  constructor (opts) {
    super(opts)

    this.destroyed = false

    this._pending = 0
    this._missing = 0
    this._ignoreEmpty = false
    this._buf = null
    this._str = null
    this._cb = null
    this._ondrain = null
    this._writeBuffer = null
    this._writeCb = null

    this._ondrain = null
    this._kick()
  }

  destroy (err) {
    if (this.destroyed) return
    this.destroyed = true
    if (err) this.emit('error', err)
    this.emit('close')
  }

  _write (data, enc, next) {
    if (this.destroyed) return
    var drained = !this._str || !this._str._writableState.needDrain

    while (data.length && !this.destroyed) {
      if (!this._missing && !this._ignoreEmpty) {
        this._writeBuffer = data
        this._writeCb = next
        return
      }

      var consumed = data.length < this._missing ? data.length : this._missing
      if (this._buf) data.copy(this._buf, this._buf.length - this._missing)
      else if (this._str) drained = this._str.write(consumed === data.length ? data : data.slice(0, consumed))

      this._missing -= consumed

      if (!this._missing) {
        var buf = this._buf
        var cb = this._cb
        var stream = this._str

        this._buf = this._cb = this._str = this._ondrain = null
        drained = true

        this._ignoreEmpty = false
        if (stream) stream.end()
        if (cb) cb(buf)
      }

      data = consumed === data.length ? EMPTY : data.slice(consumed)
    }

    if (this._pending && !this._missing) {
      this._writeBuffer = data
      this._writeCb = next
      return
    }

    if (drained) next()
    else this._ondrain(next)
  }

  _buffer (size, cb) {
    this._missing = size
    this._buf = Buffer.alloc(size)
    this._cb = cb
  }

  _stream (size, cb) {
    this._missing = size
    this._str = new MediaData(this)
    this._ondrain = nextEvent(this._str, 'drain')
    this._pending++
    this._str.on('end', () => {
      this._pending--
      this._kick()
    })
    this._cb = cb
    return this._str
  }

  _readBox () {
    const bufferHeaders = (len, buf) => {
      this._buffer(len, additionalBuf => {
        if (buf) {
          buf = Buffer.concat([buf, additionalBuf])
        } else {
          buf = additionalBuf
        }
        var headers = Box.readHeaders(buf)
        if (typeof headers === 'number') {
          bufferHeaders(headers - buf.length, buf)
        } else {
          this._pending++
          this._headers = headers
          this.emit('box', headers)
        }
      })
    }

    bufferHeaders(8)
  }

  stream () {
    if (!this._headers) throw new Error('this function can only be called once after \'box\' is emitted')
    var headers = this._headers
    this._headers = null

    return this._stream(headers.contentLen, () => {
      this._pending--
      this._kick()
    })
  }

  decode (cb) {
    if (!this._headers) throw new Error('this function can only be called once after \'box\' is emitted')
    var headers = this._headers
    this._headers = null

    this._buffer(headers.contentLen, buf => {
      var box = Box.decodeWithoutHeaders(headers, buf)
      cb(box)
      this._pending--
      this._kick()
    })
  }

  ignore () {
    if (!this._headers) throw new Error('this function can only be called once after \'box\' is emitted')
    var headers = this._headers
    this._headers = null

    this._missing = headers.contentLen
    if (this._missing === 0) {
      this._ignoreEmpty = true
    }
    this._cb = () => {
      this._pending--
      this._kick()
    }
  }

  _kick () {
    if (this._pending) return
    if (!this._buf && !this._str) this._readBox()
    if (this._writeBuffer) {
      var next = this._writeCb
      var buffer = this._writeBuffer
      this._writeBuffer = null
      this._writeCb = null
      this._write(buffer, null, next)
    }
  }
}

class MediaData extends stream.PassThrough {
  constructor (parent) {
    super()
    this._parent = parent
    this.destroyed = false
  }

  destroy (err) {
    if (this.destroyed) return
    this.destroyed = true
    this._parent.destroy(err)
    if (err) this.emit('error', err)
    this.emit('close')
  }
}

module.exports = Decoder

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"mp4-box-encoding":164,"next-event":200,"readable-stream":182}],166:[function(require,module,exports){
(function (Buffer){(function (){
var stream = require('readable-stream')
var Box = require('mp4-box-encoding')
var queueMicrotask = require('queue-microtask')

function noop () {}

class Encoder extends stream.Readable {
  constructor (opts) {
    super(opts)

    this.destroyed = false

    this._finalized = false
    this._reading = false
    this._stream = null
    this._drain = null
    this._want = false

    this._onreadable = () => {
      if (!this._want) return
      this._want = false
      this._read()
    }

    this._onend = () => {
      this._stream = null
    }
  }

  mdat (size, cb) {
    this.mediaData(size, cb)
  }

  mediaData (size, cb) {
    var stream = new MediaData(this)
    this.box({ type: 'mdat', contentLength: size, encodeBufferLen: 8, stream: stream }, cb)
    return stream
  }

  box (box, cb) {
    if (!cb) cb = noop
    if (this.destroyed) return cb(new Error('Encoder is destroyed'))

    var buf
    if (box.encodeBufferLen) {
      buf = Buffer.alloc(box.encodeBufferLen)
    }
    if (box.stream) {
      box.buffer = null
      buf = Box.encode(box, buf)
      this.push(buf)
      this._stream = box.stream
      this._stream.on('readable', this._onreadable)
      this._stream.on('end', this._onend)
      this._stream.on('end', cb)
      this._forward()
    } else {
      buf = Box.encode(box, buf)
      var drained = this.push(buf)
      if (drained) return queueMicrotask(cb)
      this._drain = cb
    }
  }

  destroy (err) {
    if (this.destroyed) return
    this.destroyed = true
    if (this._stream && this._stream.destroy) this._stream.destroy()
    this._stream = null
    if (this._drain) {
      var cb = this._drain
      this._drain = null
      cb(err)
    }
    if (err) this.emit('error', err)
    this.emit('close')
  }

  finalize () {
    this._finalized = true
    if (!this._stream && !this._drain) {
      this.push(null)
    }
  }

  _forward () {
    if (!this._stream) return

    while (!this.destroyed) {
      var buf = this._stream.read()

      if (!buf) {
        this._want = !!this._stream
        return
      }

      if (!this.push(buf)) return
    }
  }

  _read () {
    if (this._reading || this.destroyed) return
    this._reading = true

    if (this._stream) this._forward()
    if (this._drain) {
      var drain = this._drain
      this._drain = null
      drain()
    }

    this._reading = false
    if (this._finalized) {
      this.push(null)
    }
  }
}

class MediaData extends stream.PassThrough {
  constructor (parent) {
    super()
    this._parent = parent
    this.destroyed = false
  }

  destroy (err) {
    if (this.destroyed) return
    this.destroyed = true
    this._parent.destroy(err)
    if (err) this.emit('error', err)
    this.emit('close')
  }
}

module.exports = Encoder

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"mp4-box-encoding":164,"queue-microtask":212,"readable-stream":182}],167:[function(require,module,exports){
const Decoder = require('./decode')
const Encoder = require('./encode')

exports.decode = opts => new Decoder(opts)
exports.encode = opts => new Encoder(opts)

},{"./decode":165,"./encode":166}],168:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],169:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":171,"./_stream_writable":173,"_process":206,"dup":13,"inherits":138}],170:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":172,"dup":14,"inherits":138}],171:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":168,"./_stream_duplex":169,"./internal/streams/async_iterator":174,"./internal/streams/buffer_list":175,"./internal/streams/destroy":176,"./internal/streams/from":178,"./internal/streams/state":180,"./internal/streams/stream":181,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],172:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":168,"./_stream_duplex":169,"dup":16,"inherits":138}],173:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":168,"./_stream_duplex":169,"./internal/streams/destroy":176,"./internal/streams/state":180,"./internal/streams/stream":181,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],174:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":177,"_process":206,"dup":18}],175:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],176:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],177:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":168,"dup":21}],178:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],179:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":168,"./end-of-stream":177,"dup":23}],180:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":168,"dup":24}],181:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],182:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":169,"./lib/_stream_passthrough.js":170,"./lib/_stream_readable.js":171,"./lib/_stream_transform.js":172,"./lib/_stream_writable.js":173,"./lib/internal/streams/end-of-stream.js":177,"./lib/internal/streams/pipeline.js":179,"dup":26}],183:[function(require,module,exports){
/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var w = d * 7;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} [options]
 * @throws {Error} throw an error if val is not a non-empty string or a number
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options) {
  options = options || {};
  var type = typeof val;
  if (type === 'string' && val.length > 0) {
    return parse(val);
  } else if (type === 'number' && isFinite(val)) {
    return options.long ? fmtLong(val) : fmtShort(val);
  }
  throw new Error(
    'val is not a non-empty string or a valid number. val=' +
      JSON.stringify(val)
  );
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = String(str);
  if (str.length > 100) {
    return;
  }
  var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
    str
  );
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'weeks':
    case 'week':
    case 'w':
      return n * w;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
    default:
      return undefined;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtShort(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= d) {
    return Math.round(ms / d) + 'd';
  }
  if (msAbs >= h) {
    return Math.round(ms / h) + 'h';
  }
  if (msAbs >= m) {
    return Math.round(ms / m) + 'm';
  }
  if (msAbs >= s) {
    return Math.round(ms / s) + 's';
  }
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtLong(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= d) {
    return plural(ms, msAbs, d, 'day');
  }
  if (msAbs >= h) {
    return plural(ms, msAbs, h, 'hour');
  }
  if (msAbs >= m) {
    return plural(ms, msAbs, m, 'minute');
  }
  if (msAbs >= s) {
    return plural(ms, msAbs, s, 'second');
  }
  return ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, msAbs, n, name) {
  var isPlural = msAbs >= n * 1.5;
  return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
}

},{}],184:[function(require,module,exports){
/*! multistream. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
const stream = require('readable-stream')
const once = require('once')

function toStreams2Obj (s) {
  return toStreams2(s, { objectMode: true, highWaterMark: 16 })
}

function toStreams2Buf (s) {
  return toStreams2(s)
}

function toStreams2 (s, opts) {
  if (!s || typeof s === 'function' || s._readableState) return s

  const wrap = new stream.Readable(opts).wrap(s)
  if (s.destroy) {
    wrap.destroy = s.destroy.bind(s)
  }
  return wrap
}

class MultiStream extends stream.Readable {
  constructor (streams, opts) {
    super({ ...opts, autoDestroy: true })

    this._drained = false
    this._forwarding = false
    this._current = null
    this._toStreams2 = (opts && opts.objectMode) ? toStreams2Obj : toStreams2Buf

    if (typeof streams === 'function') {
      this._queue = streams
    } else {
      this._queue = streams.map(this._toStreams2)
      this._queue.forEach(stream => {
        if (typeof stream !== 'function') this._attachErrorListener(stream)
      })
    }

    this._next()
  }

  _read () {
    this._drained = true
    this._forward()
  }

  _forward () {
    if (this._forwarding || !this._drained || !this._current) return
    this._forwarding = true

    let chunk
    while (this._drained && (chunk = this._current.read()) !== null) {
      this._drained = this.push(chunk)
    }

    this._forwarding = false
  }

  _destroy (err, cb) {
    let streams = []
    if (this._current) streams.push(this._current)
    if (typeof this._queue !== 'function') streams = streams.concat(this._queue)

    if (streams.length === 0) {
      cb(err)
    } else {
      let counter = streams.length
      let er = err
      streams.forEach(stream => {
        destroy(stream, err, err => {
          er = er || err
          if (--counter === 0) {
            cb(er)
          }
        })
      })
    }
  }

  _next () {
    this._current = null

    if (typeof this._queue === 'function') {
      this._queue((err, stream) => {
        if (err) return this.destroy(err)
        stream = this._toStreams2(stream)
        this._attachErrorListener(stream)
        this._gotNextStream(stream)
      })
    } else {
      let stream = this._queue.shift()
      if (typeof stream === 'function') {
        stream = this._toStreams2(stream())
        this._attachErrorListener(stream)
      }
      this._gotNextStream(stream)
    }
  }

  _gotNextStream (stream) {
    if (!stream) {
      this.push(null)
      return
    }

    this._current = stream
    this._forward()

    const onReadable = () => {
      this._forward()
    }

    const onClose = () => {
      if (!stream._readableState.ended && !stream.destroyed) {
        const err = new Error('ERR_STREAM_PREMATURE_CLOSE')
        err.code = 'ERR_STREAM_PREMATURE_CLOSE'
        this.destroy(err)
      }
    }

    const onEnd = () => {
      this._current = null
      stream.removeListener('readable', onReadable)
      stream.removeListener('end', onEnd)
      stream.removeListener('close', onClose)
      stream.destroy()
      this._next()
    }

    stream.on('readable', onReadable)
    stream.once('end', onEnd)
    stream.once('close', onClose)
  }

  _attachErrorListener (stream) {
    if (!stream) return

    const onError = (err) => {
      stream.removeListener('error', onError)
      this.destroy(err)
    }

    stream.once('error', onError)
  }
}

MultiStream.obj = streams => (
  new MultiStream(streams, { objectMode: true, highWaterMark: 16 })
)

module.exports = MultiStream

// Normalize stream destroy w/ callback.
function destroy (stream, err, cb) {
  if (!stream.destroy || stream.destroyed) {
    cb(err)
  } else {
    const callback = once(er => cb(er || err))
    stream
      .on('error', callback)
      .on('close', () => callback())
      .destroy(err, callback)
  }
}

},{"once":201,"readable-stream":199}],185:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],186:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":188,"./_stream_writable":190,"_process":206,"dup":13,"inherits":138}],187:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":189,"dup":14,"inherits":138}],188:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":185,"./_stream_duplex":186,"./internal/streams/async_iterator":191,"./internal/streams/buffer_list":192,"./internal/streams/destroy":193,"./internal/streams/from":195,"./internal/streams/state":197,"./internal/streams/stream":198,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],189:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":185,"./_stream_duplex":186,"dup":16,"inherits":138}],190:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":185,"./_stream_duplex":186,"./internal/streams/destroy":193,"./internal/streams/state":197,"./internal/streams/stream":198,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],191:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":194,"_process":206,"dup":18}],192:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],193:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],194:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":185,"dup":21}],195:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],196:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":185,"./end-of-stream":194,"dup":23}],197:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":185,"dup":24}],198:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],199:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":186,"./lib/_stream_passthrough.js":187,"./lib/_stream_readable.js":188,"./lib/_stream_transform.js":189,"./lib/_stream_writable.js":190,"./lib/internal/streams/end-of-stream.js":194,"./lib/internal/streams/pipeline.js":196,"dup":26}],200:[function(require,module,exports){
module.exports = nextEvent

function nextEvent (emitter, name) {
  var next = null
  emitter.on(name, function (data) {
    if (!next) return
    var fn = next
    next = null
    fn(data)
  })

  return function (once) {
    next = once
  }
}

},{}],201:[function(require,module,exports){
var wrappy = require('wrappy')
module.exports = wrappy(once)
module.exports.strict = wrappy(onceStrict)

once.proto = once(function () {
  Object.defineProperty(Function.prototype, 'once', {
    value: function () {
      return once(this)
    },
    configurable: true
  })

  Object.defineProperty(Function.prototype, 'onceStrict', {
    value: function () {
      return onceStrict(this)
    },
    configurable: true
  })
})

function once (fn) {
  var f = function () {
    if (f.called) return f.value
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  f.called = false
  return f
}

function onceStrict (fn) {
  var f = function () {
    if (f.called)
      throw new Error(f.onceError)
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  var name = fn.name || 'Function wrapped with `once`'
  f.onceError = name + " shouldn't be called more than once"
  f.called = false
  return f
}

},{"wrappy":338}],202:[function(require,module,exports){
(function (Buffer){(function (){
/*! parse-torrent. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
/* global Blob */

const bencode = require('bencode')
const blobToBuffer = require('blob-to-buffer')
const fs = require('fs') // browser exclude
const get = require('simple-get')
const magnet = require('magnet-uri')
const path = require('path')
const sha1 = require('simple-sha1')
const queueMicrotask = require('queue-microtask')

module.exports = parseTorrent
module.exports.remote = parseTorrentRemote

module.exports.toMagnetURI = magnet.encode
module.exports.toTorrentFile = encodeTorrentFile

/**
 * Parse a torrent identifier (magnet uri, .torrent file, info hash)
 * @param  {string|Buffer|Object} torrentId
 * @return {Object}
 */
function parseTorrent (torrentId) {
  if (typeof torrentId === 'string' && /^(stream-)?magnet:/.test(torrentId)) {
    // if magnet uri (string)
    const torrentObj = magnet(torrentId)

    // infoHash won't be defined if a non-bittorrent magnet is passed
    if (!torrentObj.infoHash) {
      throw new Error('Invalid torrent identifier')
    }

    return torrentObj
  } else if (typeof torrentId === 'string' && (/^[a-f0-9]{40}$/i.test(torrentId) || /^[a-z2-7]{32}$/i.test(torrentId))) {
    // if info hash (hex/base-32 string)
    return magnet(`magnet:?xt=urn:btih:${torrentId}`)
  } else if (Buffer.isBuffer(torrentId) && torrentId.length === 20) {
    // if info hash (buffer)
    return magnet(`magnet:?xt=urn:btih:${torrentId.toString('hex')}`)
  } else if (Buffer.isBuffer(torrentId)) {
    // if .torrent file (buffer)
    return decodeTorrentFile(torrentId) // might throw
  } else if (torrentId && torrentId.infoHash) {
    // if parsed torrent (from `parse-torrent` or `magnet-uri`)
    torrentId.infoHash = torrentId.infoHash.toLowerCase()

    if (!torrentId.announce) torrentId.announce = []

    if (typeof torrentId.announce === 'string') {
      torrentId.announce = [torrentId.announce]
    }

    if (!torrentId.urlList) torrentId.urlList = []

    return torrentId
  } else {
    throw new Error('Invalid torrent identifier')
  }
}

function parseTorrentRemote (torrentId, opts, cb) {
  if (typeof opts === 'function') return parseTorrentRemote(torrentId, {}, opts)
  if (typeof cb !== 'function') throw new Error('second argument must be a Function')

  let parsedTorrent
  try {
    parsedTorrent = parseTorrent(torrentId)
  } catch (err) {
    // If torrent fails to parse, it could be a Blob, http/https URL or
    // filesystem path, so don't consider it an error yet.
  }

  if (parsedTorrent && parsedTorrent.infoHash) {
    queueMicrotask(() => {
      cb(null, parsedTorrent)
    })
  } else if (isBlob(torrentId)) {
    blobToBuffer(torrentId, (err, torrentBuf) => {
      if (err) return cb(new Error(`Error converting Blob: ${err.message}`))
      parseOrThrow(torrentBuf)
    })
  } else if (typeof get === 'function' && /^https?:/.test(torrentId)) {
    // http, or https url to torrent file
    opts = Object.assign({
      url: torrentId,
      timeout: 30 * 1000,
      headers: { 'user-agent': 'WebTorrent (https://webtorrent.io)' }
    }, opts)
    get.concat(opts, (err, res, torrentBuf) => {
      if (err) return cb(new Error(`Error downloading torrent: ${err.message}`))
      parseOrThrow(torrentBuf)
    })
  } else if (typeof fs.readFile === 'function' && typeof torrentId === 'string') {
    // assume it's a filesystem path
    fs.readFile(torrentId, (err, torrentBuf) => {
      if (err) return cb(new Error('Invalid torrent identifier'))
      parseOrThrow(torrentBuf)
    })
  } else {
    queueMicrotask(() => {
      cb(new Error('Invalid torrent identifier'))
    })
  }

  function parseOrThrow (torrentBuf) {
    try {
      parsedTorrent = parseTorrent(torrentBuf)
    } catch (err) {
      return cb(err)
    }
    if (parsedTorrent && parsedTorrent.infoHash) cb(null, parsedTorrent)
    else cb(new Error('Invalid torrent identifier'))
  }
}

/**
 * Parse a torrent. Throws an exception if the torrent is missing required fields.
 * @param  {Buffer|Object} torrent
 * @return {Object}        parsed torrent
 */
function decodeTorrentFile (torrent) {
  if (Buffer.isBuffer(torrent)) {
    torrent = bencode.decode(torrent)
  }

  // sanity check
  ensure(torrent.info, 'info')
  ensure(torrent.info['name.utf-8'] || torrent.info.name, 'info.name')
  ensure(torrent.info['piece length'], 'info[\'piece length\']')
  ensure(torrent.info.pieces, 'info.pieces')

  if (torrent.info.files) {
    torrent.info.files.forEach(file => {
      ensure(typeof file.length === 'number', 'info.files[0].length')
      ensure(file['path.utf-8'] || file.path, 'info.files[0].path')
    })
  } else {
    ensure(typeof torrent.info.length === 'number', 'info.length')
  }

  const result = {
    info: torrent.info,
    infoBuffer: bencode.encode(torrent.info),
    name: (torrent.info['name.utf-8'] || torrent.info.name).toString(),
    announce: []
  }

  result.infoHash = sha1.sync(result.infoBuffer)
  result.infoHashBuffer = Buffer.from(result.infoHash, 'hex')

  if (torrent.info.private !== undefined) result.private = !!torrent.info.private

  if (torrent['creation date']) result.created = new Date(torrent['creation date'] * 1000)
  if (torrent['created by']) result.createdBy = torrent['created by'].toString()

  if (Buffer.isBuffer(torrent.comment)) result.comment = torrent.comment.toString()

  // announce and announce-list will be missing if metadata fetched via ut_metadata
  if (Array.isArray(torrent['announce-list']) && torrent['announce-list'].length > 0) {
    torrent['announce-list'].forEach(urls => {
      urls.forEach(url => {
        result.announce.push(url.toString())
      })
    })
  } else if (torrent.announce) {
    result.announce.push(torrent.announce.toString())
  }

  // handle url-list (BEP19 / web seeding)
  if (Buffer.isBuffer(torrent['url-list'])) {
    // some clients set url-list to empty string
    torrent['url-list'] = torrent['url-list'].length > 0
      ? [torrent['url-list']]
      : []
  }
  result.urlList = (torrent['url-list'] || []).map(url => url.toString())

  // remove duplicates by converting to Set and back
  result.announce = Array.from(new Set(result.announce))
  result.urlList = Array.from(new Set(result.urlList))

  const files = torrent.info.files || [torrent.info]
  result.files = files.map((file, i) => {
    const parts = [].concat(result.name, file['path.utf-8'] || file.path || []).map(p => p.toString())
    return {
      path: path.join.apply(null, [path.sep].concat(parts)).slice(1),
      name: parts[parts.length - 1],
      length: file.length,
      offset: files.slice(0, i).reduce(sumLength, 0)
    }
  })

  result.length = files.reduce(sumLength, 0)

  const lastFile = result.files[result.files.length - 1]

  result.pieceLength = torrent.info['piece length']
  result.lastPieceLength = ((lastFile.offset + lastFile.length) % result.pieceLength) || result.pieceLength
  result.pieces = splitPieces(torrent.info.pieces)

  return result
}

/**
 * Convert a parsed torrent object back into a .torrent file buffer.
 * @param  {Object} parsed parsed torrent
 * @return {Buffer}
 */
function encodeTorrentFile (parsed) {
  const torrent = {
    info: parsed.info
  }

  torrent['announce-list'] = (parsed.announce || []).map(url => {
    if (!torrent.announce) torrent.announce = url
    url = Buffer.from(url, 'utf8')
    return [url]
  })

  torrent['url-list'] = parsed.urlList || []

  if (parsed.private !== undefined) {
    torrent.private = Number(parsed.private)
  }

  if (parsed.created) {
    torrent['creation date'] = (parsed.created.getTime() / 1000) | 0
  }

  if (parsed.createdBy) {
    torrent['created by'] = parsed.createdBy
  }

  if (parsed.comment) {
    torrent.comment = parsed.comment
  }

  return bencode.encode(torrent)
}

/**
 * Check if `obj` is a W3C `Blob` or `File` object
 * @param  {*} obj
 * @return {boolean}
 */
function isBlob (obj) {
  return typeof Blob !== 'undefined' && obj instanceof Blob
}

function sumLength (sum, file) {
  return sum + file.length
}

function splitPieces (buf) {
  const pieces = []
  for (let i = 0; i < buf.length; i += 20) {
    pieces.push(buf.slice(i, i + 20).toString('hex'))
  }
  return pieces
}

function ensure (bool, fieldName) {
  if (!bool) throw new Error(`Torrent is missing required field: ${fieldName}`)
}

// Workaround Browserify v13 bug
// https://github.com/substack/node-browserify/issues/1483
;(() => { Buffer.alloc(0) })()

}).call(this)}).call(this,require("buffer").Buffer)
},{"bencode":7,"blob-to-buffer":31,"buffer":52,"fs":48,"magnet-uri":144,"path":203,"queue-microtask":212,"simple-get":238,"simple-sha1":255}],203:[function(require,module,exports){
(function (process){(function (){
// 'path' module extracted from Node.js v8.11.1 (only the posix part)
// transplited with Babel

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

function assertPath(path) {
  if (typeof path !== 'string') {
    throw new TypeError('Path must be a string. Received ' + JSON.stringify(path));
  }
}

// Resolves . and .. elements in a path with directory names
function normalizeStringPosix(path, allowAboveRoot) {
  var res = '';
  var lastSegmentLength = 0;
  var lastSlash = -1;
  var dots = 0;
  var code;
  for (var i = 0; i <= path.length; ++i) {
    if (i < path.length)
      code = path.charCodeAt(i);
    else if (code === 47 /*/*/)
      break;
    else
      code = 47 /*/*/;
    if (code === 47 /*/*/) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 /*.*/ || res.charCodeAt(res.length - 2) !== 46 /*.*/) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf('/');
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1) {
                res = '';
                lastSegmentLength = 0;
              } else {
                res = res.slice(0, lastSlashIndex);
                lastSegmentLength = res.length - 1 - res.lastIndexOf('/');
              }
              lastSlash = i;
              dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0)
            res += '/..';
          else
            res = '..';
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += '/' + path.slice(lastSlash + 1, i);
        else
          res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 /*.*/ && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function _format(sep, pathObject) {
  var dir = pathObject.dir || pathObject.root;
  var base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '');
  if (!dir) {
    return base;
  }
  if (dir === pathObject.root) {
    return dir + base;
  }
  return dir + sep + base;
}

var posix = {
  // path.resolve([from ...], to)
  resolve: function resolve() {
    var resolvedPath = '';
    var resolvedAbsolute = false;
    var cwd;

    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path;
      if (i >= 0)
        path = arguments[i];
      else {
        if (cwd === undefined)
          cwd = process.cwd();
        path = cwd;
      }

      assertPath(path);

      // Skip empty entries
      if (path.length === 0) {
        continue;
      }

      resolvedPath = path + '/' + resolvedPath;
      resolvedAbsolute = path.charCodeAt(0) === 47 /*/*/;
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);

    if (resolvedAbsolute) {
      if (resolvedPath.length > 0)
        return '/' + resolvedPath;
      else
        return '/';
    } else if (resolvedPath.length > 0) {
      return resolvedPath;
    } else {
      return '.';
    }
  },

  normalize: function normalize(path) {
    assertPath(path);

    if (path.length === 0) return '.';

    var isAbsolute = path.charCodeAt(0) === 47 /*/*/;
    var trailingSeparator = path.charCodeAt(path.length - 1) === 47 /*/*/;

    // Normalize the path
    path = normalizeStringPosix(path, !isAbsolute);

    if (path.length === 0 && !isAbsolute) path = '.';
    if (path.length > 0 && trailingSeparator) path += '/';

    if (isAbsolute) return '/' + path;
    return path;
  },

  isAbsolute: function isAbsolute(path) {
    assertPath(path);
    return path.length > 0 && path.charCodeAt(0) === 47 /*/*/;
  },

  join: function join() {
    if (arguments.length === 0)
      return '.';
    var joined;
    for (var i = 0; i < arguments.length; ++i) {
      var arg = arguments[i];
      assertPath(arg);
      if (arg.length > 0) {
        if (joined === undefined)
          joined = arg;
        else
          joined += '/' + arg;
      }
    }
    if (joined === undefined)
      return '.';
    return posix.normalize(joined);
  },

  relative: function relative(from, to) {
    assertPath(from);
    assertPath(to);

    if (from === to) return '';

    from = posix.resolve(from);
    to = posix.resolve(to);

    if (from === to) return '';

    // Trim any leading backslashes
    var fromStart = 1;
    for (; fromStart < from.length; ++fromStart) {
      if (from.charCodeAt(fromStart) !== 47 /*/*/)
        break;
    }
    var fromEnd = from.length;
    var fromLen = fromEnd - fromStart;

    // Trim any leading backslashes
    var toStart = 1;
    for (; toStart < to.length; ++toStart) {
      if (to.charCodeAt(toStart) !== 47 /*/*/)
        break;
    }
    var toEnd = to.length;
    var toLen = toEnd - toStart;

    // Compare paths to find the longest common path from root
    var length = fromLen < toLen ? fromLen : toLen;
    var lastCommonSep = -1;
    var i = 0;
    for (; i <= length; ++i) {
      if (i === length) {
        if (toLen > length) {
          if (to.charCodeAt(toStart + i) === 47 /*/*/) {
            // We get here if `from` is the exact base path for `to`.
            // For example: from='/foo/bar'; to='/foo/bar/baz'
            return to.slice(toStart + i + 1);
          } else if (i === 0) {
            // We get here if `from` is the root
            // For example: from='/'; to='/foo'
            return to.slice(toStart + i);
          }
        } else if (fromLen > length) {
          if (from.charCodeAt(fromStart + i) === 47 /*/*/) {
            // We get here if `to` is the exact base path for `from`.
            // For example: from='/foo/bar/baz'; to='/foo/bar'
            lastCommonSep = i;
          } else if (i === 0) {
            // We get here if `to` is the root.
            // For example: from='/foo'; to='/'
            lastCommonSep = 0;
          }
        }
        break;
      }
      var fromCode = from.charCodeAt(fromStart + i);
      var toCode = to.charCodeAt(toStart + i);
      if (fromCode !== toCode)
        break;
      else if (fromCode === 47 /*/*/)
        lastCommonSep = i;
    }

    var out = '';
    // Generate the relative path based on the path difference between `to`
    // and `from`
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd || from.charCodeAt(i) === 47 /*/*/) {
        if (out.length === 0)
          out += '..';
        else
          out += '/..';
      }
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts
    if (out.length > 0)
      return out + to.slice(toStart + lastCommonSep);
    else {
      toStart += lastCommonSep;
      if (to.charCodeAt(toStart) === 47 /*/*/)
        ++toStart;
      return to.slice(toStart);
    }
  },

  _makeLong: function _makeLong(path) {
    return path;
  },

  dirname: function dirname(path) {
    assertPath(path);
    if (path.length === 0) return '.';
    var code = path.charCodeAt(0);
    var hasRoot = code === 47 /*/*/;
    var end = -1;
    var matchedSlash = true;
    for (var i = path.length - 1; i >= 1; --i) {
      code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          if (!matchedSlash) {
            end = i;
            break;
          }
        } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 1) return '//';
    return path.slice(0, end);
  },

  basename: function basename(path, ext) {
    if (ext !== undefined && typeof ext !== 'string') throw new TypeError('"ext" argument must be a string');
    assertPath(path);

    var start = 0;
    var end = -1;
    var matchedSlash = true;
    var i;

    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
      if (ext.length === path.length && ext === path) return '';
      var extIdx = ext.length - 1;
      var firstNonSlashEnd = -1;
      for (i = path.length - 1; i >= 0; --i) {
        var code = path.charCodeAt(i);
        if (code === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
          } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === ext.charCodeAt(extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end) end = firstNonSlashEnd;else if (end === -1) end = path.length;
      return path.slice(start, end);
    } else {
      for (i = path.length - 1; i >= 0; --i) {
        if (path.charCodeAt(i) === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
          } else if (end === -1) {
          // We saw the first non-path separator, mark this as the end of our
          // path component
          matchedSlash = false;
          end = i + 1;
        }
      }

      if (end === -1) return '';
      return path.slice(start, end);
    }
  },

  extname: function extname(path) {
    assertPath(path);
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    var preDotState = 0;
    for (var i = path.length - 1; i >= 0; --i) {
      var code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46 /*.*/) {
          // If this is our first dot, mark it as the start of our extension
          if (startDot === -1)
            startDot = i;
          else if (preDotState !== 1)
            preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      return '';
    }
    return path.slice(startDot, end);
  },

  format: function format(pathObject) {
    if (pathObject === null || typeof pathObject !== 'object') {
      throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
    }
    return _format('/', pathObject);
  },

  parse: function parse(path) {
    assertPath(path);

    var ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0) return ret;
    var code = path.charCodeAt(0);
    var isAbsolute = code === 47 /*/*/;
    var start;
    if (isAbsolute) {
      ret.root = '/';
      start = 1;
    } else {
      start = 0;
    }
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    var i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    var preDotState = 0;

    // Get non-dir info
    for (; i >= start; --i) {
      code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46 /*.*/) {
          // If this is our first dot, mark it as the start of our extension
          if (startDot === -1) startDot = i;else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      if (end !== -1) {
        if (startPart === 0 && isAbsolute) ret.base = ret.name = path.slice(1, end);else ret.base = ret.name = path.slice(startPart, end);
      }
    } else {
      if (startPart === 0 && isAbsolute) {
        ret.name = path.slice(1, startDot);
        ret.base = path.slice(1, end);
      } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
      }
      ret.ext = path.slice(startDot, end);
    }

    if (startPart > 0) ret.dir = path.slice(0, startPart - 1);else if (isAbsolute) ret.dir = '/';

    return ret;
  },

  sep: '/',
  delimiter: ':',
  win32: null,
  posix: null
};

posix.posix = posix;

module.exports = posix;

}).call(this)}).call(this,require('_process'))
},{"_process":206}],204:[function(require,module,exports){
module.exports = length

function length (bytes) {
  return Math.max(16384, 1 << Math.log2(bytes < 1024 ? 1 : bytes / 1024) + 0.5 | 0)
}

},{}],205:[function(require,module,exports){
module.exports = prettierBytes

function prettierBytes (num) {
  if (typeof num !== 'number' || isNaN(num)) {
    throw new TypeError('Expected a number, got ' + typeof num)
  }

  var neg = num < 0
  var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  if (neg) {
    num = -num
  }

  if (num < 1) {
    return (neg ? '-' : '') + num + ' B'
  }

  var exponent = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1)
  num = Number(num / Math.pow(1000, exponent))
  var unit = units[exponent]

  if (num >= 10 || num % 1 === 0) {
    // Do not show decimals when the number is two-digit, or if the number has no
    // decimal component.
    return (neg ? '-' : '') + num.toFixed(0) + ' ' + unit
  } else {
    return (neg ? '-' : '') + num.toFixed(1) + ' ' + unit
  }
}

},{}],206:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],207:[function(require,module,exports){
(function (process){(function (){
var once = require('once')
var eos = require('end-of-stream')
var fs = require('fs') // we only need fs to get the ReadStream and WriteStream prototypes

var noop = function () {}
var ancient = /^v?\.0/.test(process.version)

var isFn = function (fn) {
  return typeof fn === 'function'
}

var isFS = function (stream) {
  if (!ancient) return false // newer node version do not need to care about fs is a special way
  if (!fs) return false // browser
  return (stream instanceof (fs.ReadStream || noop) || stream instanceof (fs.WriteStream || noop)) && isFn(stream.close)
}

var isRequest = function (stream) {
  return stream.setHeader && isFn(stream.abort)
}

var destroyer = function (stream, reading, writing, callback) {
  callback = once(callback)

  var closed = false
  stream.on('close', function () {
    closed = true
  })

  eos(stream, {readable: reading, writable: writing}, function (err) {
    if (err) return callback(err)
    closed = true
    callback()
  })

  var destroyed = false
  return function (err) {
    if (closed) return
    if (destroyed) return
    destroyed = true

    if (isFS(stream)) return stream.close(noop) // use close for fs streams to avoid fd leaks
    if (isRequest(stream)) return stream.abort() // request.destroy just do .end - .abort is what we want

    if (isFn(stream.destroy)) return stream.destroy()

    callback(err || new Error('stream was destroyed'))
  }
}

var call = function (fn) {
  fn()
}

var pipe = function (from, to) {
  return from.pipe(to)
}

var pump = function () {
  var streams = Array.prototype.slice.call(arguments)
  var callback = isFn(streams[streams.length - 1] || noop) && streams.pop() || noop

  if (Array.isArray(streams[0])) streams = streams[0]
  if (streams.length < 2) throw new Error('pump requires two streams per minimum')

  var error
  var destroys = streams.map(function (stream, i) {
    var reading = i < streams.length - 1
    var writing = i > 0
    return destroyer(stream, reading, writing, function (err) {
      if (!error) error = err
      if (err) destroys.forEach(call)
      if (reading) return
      destroys.forEach(call)
      callback(error)
    })
  })

  return streams.reduce(pipe)
}

module.exports = pump

}).call(this)}).call(this,require('_process'))
},{"_process":206,"end-of-stream":114,"fs":48,"once":201}],208:[function(require,module,exports){
(function (global){(function (){
/*! https://mths.be/punycode v1.4.1 by @mathias */
;(function(root) {

	/** Detect free variables */
	var freeExports = typeof exports == 'object' && exports &&
		!exports.nodeType && exports;
	var freeModule = typeof module == 'object' && module &&
		!module.nodeType && module;
	var freeGlobal = typeof global == 'object' && global;
	if (
		freeGlobal.global === freeGlobal ||
		freeGlobal.window === freeGlobal ||
		freeGlobal.self === freeGlobal
	) {
		root = freeGlobal;
	}

	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw new RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * https://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		'version': '1.4.1',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		'ucs2': {
			'decode': ucs2decode,
			'encode': ucs2encode
		},
		'decode': decode,
		'encode': encode,
		'toASCII': toASCII,
		'toUnicode': toUnicode
	};

	/** Expose `punycode` */
	// Some AMD build optimizers, like r.js, check for specific condition patterns
	// like the following:
	if (
		typeof define == 'function' &&
		typeof define.amd == 'object' &&
		define.amd
	) {
		define('punycode', function() {
			return punycode;
		});
	} else if (freeExports && freeModule) {
		if (module.exports == freeExports) {
			// in Node.js, io.js, or RingoJS v0.8.0+
			freeModule.exports = punycode;
		} else {
			// in Narwhal or RingoJS v0.7.0-
			for (key in punycode) {
				punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
			}
		}
	} else {
		// in Rhino or a web browser
		root.punycode = punycode;
	}

}(this));

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],209:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],210:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],211:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":209,"./encode":210}],212:[function(require,module,exports){
(function (global){(function (){
/*! queue-microtask. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
let promise

module.exports = typeof queueMicrotask === 'function'
  ? queueMicrotask.bind(typeof window !== 'undefined' ? window : global)
  // reuse resolved promise, and allocate it lazily
  : cb => (promise || (promise = Promise.resolve()))
    .then(cb)
    .catch(err => setTimeout(() => { throw err }, 0))

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],213:[function(require,module,exports){
var iterate = function (list) {
  var offset = 0
  return function () {
    if (offset === list.length) return null

    var len = list.length - offset
    var i = (Math.random() * len) | 0
    var el = list[offset + i]

    var tmp = list[offset]
    list[offset] = el
    list[offset + i] = tmp
    offset++

    return el
  }
}

module.exports = iterate

},{}],214:[function(require,module,exports){
(function (process,global){(function (){
'use strict'

// limit of Crypto.getRandomValues()
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues
var MAX_BYTES = 65536

// Node supports requesting up to this number of bytes
// https://github.com/nodejs/node/blob/master/lib/internal/crypto/random.js#L48
var MAX_UINT32 = 4294967295

function oldBrowser () {
  throw new Error('Secure random number generation is not supported by this browser.\nUse Chrome, Firefox or Internet Explorer 11')
}

var Buffer = require('safe-buffer').Buffer
var crypto = global.crypto || global.msCrypto

if (crypto && crypto.getRandomValues) {
  module.exports = randomBytes
} else {
  module.exports = oldBrowser
}

function randomBytes (size, cb) {
  // phantomjs needs to throw
  if (size > MAX_UINT32) throw new RangeError('requested too many random bytes')

  var bytes = Buffer.allocUnsafe(size)

  if (size > 0) {  // getRandomValues fails on IE if size == 0
    if (size > MAX_BYTES) { // this is the max bytes crypto.getRandomValues
      // can do at once see https://developer.mozilla.org/en-US/docs/Web/API/window.crypto.getRandomValues
      for (var generated = 0; generated < size; generated += MAX_BYTES) {
        // buffer.slice automatically checks if the end is past the end of
        // the buffer so we don't have to here
        crypto.getRandomValues(bytes.slice(generated, generated + MAX_BYTES))
      }
    } else {
      crypto.getRandomValues(bytes)
    }
  }

  if (typeof cb === 'function') {
    return process.nextTick(function () {
      cb(null, bytes)
    })
  }

  return bytes
}

}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"_process":206,"safe-buffer":236}],215:[function(require,module,exports){
/*
Instance of writable stream.

call .get(length) or .discard(length) to get a stream (relative to the last end)

emits 'stalled' once everything is written

*/
const { Writable, PassThrough } = require('readable-stream')

class RangeSliceStream extends Writable {
  constructor (offset, opts = {}) {
    super(opts)

    this.destroyed = false
    this._queue = []
    this._position = offset || 0
    this._cb = null
    this._buffer = null
    this._out = null
  }

  _write (chunk, encoding, cb) {
    let drained = true

    while (true) {
      if (this.destroyed) {
        return
      }

      // Wait for more queue entries
      if (this._queue.length === 0) {
        this._buffer = chunk
        this._cb = cb
        return
      }

      this._buffer = null
      var currRange = this._queue[0]
      // Relative to the start of chunk, what data do we need?
      const writeStart = Math.max(currRange.start - this._position, 0)
      const writeEnd = currRange.end - this._position

      // Check if we need to throw it all away
      if (writeStart >= chunk.length) {
        this._position += chunk.length
        return cb(null)
      }

      // Check if we need to use it all
      let toWrite
      if (writeEnd > chunk.length) {
        this._position += chunk.length
        if (writeStart === 0) {
          toWrite = chunk
        } else {
          toWrite = chunk.slice(writeStart)
        }
        drained = currRange.stream.write(toWrite) && drained
        break
      }

      this._position += writeEnd

      toWrite = (writeStart === 0 && writeEnd === chunk.length)
        ? chunk
        : chunk.slice(writeStart, writeEnd)

      drained = currRange.stream.write(toWrite) && drained
      if (currRange.last) {
        currRange.stream.end()
      }
      chunk = chunk.slice(writeEnd)
      this._queue.shift()
    }

    if (drained) {
      cb(null)
    } else {
      currRange.stream.once('drain', cb.bind(null, null))
    }
  }

  slice (ranges) {
    if (this.destroyed) return null

    if (!Array.isArray(ranges)) ranges = [ranges]

    const str = new PassThrough()

    ranges.forEach((range, i) => {
      this._queue.push({
        start: range.start,
        end: range.end,
        stream: str,
        last: i === ranges.length - 1
      })
    })

    if (this._buffer) {
      this._write(this._buffer, null, this._cb)
    }

    return str
  }

  destroy (err) {
    if (this.destroyed) return
    this.destroyed = true

    if (err) this.emit('error', err)
  }
}

module.exports = RangeSliceStream

},{"readable-stream":230}],216:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],217:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":219,"./_stream_writable":221,"_process":206,"dup":13,"inherits":138}],218:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":220,"dup":14,"inherits":138}],219:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":216,"./_stream_duplex":217,"./internal/streams/async_iterator":222,"./internal/streams/buffer_list":223,"./internal/streams/destroy":224,"./internal/streams/from":226,"./internal/streams/state":228,"./internal/streams/stream":229,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],220:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":216,"./_stream_duplex":217,"dup":16,"inherits":138}],221:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":216,"./_stream_duplex":217,"./internal/streams/destroy":224,"./internal/streams/state":228,"./internal/streams/stream":229,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],222:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":225,"_process":206,"dup":18}],223:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],224:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],225:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":216,"dup":21}],226:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],227:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":216,"./end-of-stream":225,"dup":23}],228:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":216,"dup":24}],229:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],230:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":217,"./lib/_stream_passthrough.js":218,"./lib/_stream_readable.js":219,"./lib/_stream_transform.js":220,"./lib/_stream_writable.js":221,"./lib/internal/streams/end-of-stream.js":225,"./lib/internal/streams/pipeline.js":227,"dup":26}],231:[function(require,module,exports){
/*! render-media. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
exports.render = render
exports.append = append
exports.mime = require('./lib/mime.json')

const debug = require('debug')('render-media')
const isAscii = require('is-ascii')
const MediaElementWrapper = require('mediasource')
const path = require('path')
const streamToBlobURL = require('stream-to-blob-url')
const VideoStream = require('videostream')

// Note: Everything listed in VIDEOSTREAM_EXTS should also appear in either
// MEDIASOURCE_VIDEO_EXTS or MEDIASOURCE_AUDIO_EXTS.
const VIDEOSTREAM_EXTS = [
  '.m4a',
  '.m4b',
  '.m4p',
  '.m4v',
  '.mp4'
]

const MEDIASOURCE_VIDEO_EXTS = [
  '.m4v',
  '.mkv',
  '.mp4',
  '.webm'
]

const MEDIASOURCE_AUDIO_EXTS = [
  '.m4a',
  '.m4b',
  '.m4p',
  '.mp3'
]

const MEDIASOURCE_EXTS = [].concat(
  MEDIASOURCE_VIDEO_EXTS,
  MEDIASOURCE_AUDIO_EXTS
)

const VIDEO_EXTS = [
  '.mov',
  '.ogv'
]

const AUDIO_EXTS = [
  '.aac',
  '.oga',
  '.ogg',
  '.wav',
  '.flac'
]

const IMAGE_EXTS = [
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg'
]

const IFRAME_EXTS = [
  '.css',
  '.html',
  '.js',
  '.md',
  '.pdf',
  '.srt',
  '.txt'
]

// Maximum file length for which the Blob URL strategy will be attempted
// See: https://github.com/feross/render-media/issues/18
const MAX_BLOB_LENGTH = 200 * 1000 * 1000 // 200 MB

const MediaSource = typeof window !== 'undefined' && window.MediaSource

function render (file, elem, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!opts) opts = {}
  if (!cb) cb = () => {}

  validateFile(file)
  parseOpts(opts)

  if (typeof elem === 'string') elem = document.querySelector(elem)

  renderMedia(file, tagName => {
    if (elem.nodeName !== tagName.toUpperCase()) {
      const extname = path.extname(file.name).toLowerCase()

      throw new Error(
        `Cannot render "${extname}" inside a "${elem.nodeName.toLowerCase()}" element, expected "${tagName}"`
      )
    }

    if (tagName === 'video' || tagName === 'audio') setMediaOpts(elem, opts)

    return elem
  }, opts, cb)
}

function append (file, rootElem, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!opts) opts = {}
  if (!cb) cb = () => {}

  validateFile(file)
  parseOpts(opts)

  if (typeof rootElem === 'string') rootElem = document.querySelector(rootElem)

  if (rootElem && (rootElem.nodeName === 'VIDEO' || rootElem.nodeName === 'AUDIO')) {
    throw new Error(
      'Invalid video/audio node argument. Argument must be root element that ' +
      'video/audio tag will be appended to.'
    )
  }

  renderMedia(file, getElem, opts, done)

  function getElem (tagName) {
    if (tagName === 'video' || tagName === 'audio') return createMedia(tagName)
    else return createElem(tagName)
  }

  function createMedia (tagName) {
    const elem = createElem(tagName)
    setMediaOpts(elem, opts)
    rootElem.appendChild(elem)
    return elem
  }

  function createElem (tagName) {
    const elem = document.createElement(tagName)
    rootElem.appendChild(elem)
    return elem
  }

  function done (err, elem) {
    if (err && elem) elem.remove()
    cb(err, elem)
  }
}

function renderMedia (file, getElem, opts, cb) {
  const extname = path.extname(file.name).toLowerCase()
  let currentTime = 0
  let elem

  if (MEDIASOURCE_EXTS.includes(extname)) {
    renderMediaSource()
  } else if (VIDEO_EXTS.includes(extname)) {
    renderMediaElement('video')
  } else if (AUDIO_EXTS.includes(extname)) {
    renderMediaElement('audio')
  } else if (IMAGE_EXTS.includes(extname)) {
    renderImage()
  } else if (IFRAME_EXTS.includes(extname)) {
    renderIframe()
  } else {
    tryRenderIframe()
  }

  function renderMediaSource () {
    const tagName = MEDIASOURCE_VIDEO_EXTS.includes(extname) ? 'video' : 'audio'

    if (MediaSource) {
      if (VIDEOSTREAM_EXTS.includes(extname)) {
        useVideostream()
      } else {
        useMediaSource()
      }
    } else {
      useBlobURL()
    }

    function useVideostream () {
      debug(`Use \`videostream\` package for ${file.name}`)
      prepareElem()
      elem.addEventListener('error', fallbackToMediaSource)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)
      new VideoStream(file, elem) /* eslint-disable-line no-new */
    }

    function useMediaSource () {
      debug(`Use MediaSource API for ${file.name}`)
      prepareElem()
      elem.addEventListener('error', fallbackToBlobURL)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)

      const wrapper = new MediaElementWrapper(elem)
      const writable = wrapper.createWriteStream(getCodec(file.name))
      file.createReadStream().pipe(writable)

      if (currentTime) elem.currentTime = currentTime
    }

    function useBlobURL () {
      debug(`Use Blob URL for ${file.name}`)
      prepareElem()
      elem.addEventListener('error', fatalError)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)
      getBlobURL(file, (err, url) => {
        if (err) return fatalError(err)
        elem.src = url
        if (currentTime) elem.currentTime = currentTime
      })
    }

    function fallbackToMediaSource (err) {
      debug('videostream error: fallback to MediaSource API: %o', err.message || err)
      elem.removeEventListener('error', fallbackToMediaSource)
      elem.removeEventListener('loadedmetadata', onLoadedMetadata)

      useMediaSource()
    }

    function fallbackToBlobURL (err) {
      debug('MediaSource API error: fallback to Blob URL: %o', err.message || err)
      if (!checkBlobLength()) return

      elem.removeEventListener('error', fallbackToBlobURL)
      elem.removeEventListener('loadedmetadata', onLoadedMetadata)

      useBlobURL()
    }

    function prepareElem () {
      if (!elem) {
        elem = getElem(tagName)

        elem.addEventListener('progress', () => {
          currentTime = elem.currentTime
        })
      }
    }
  }

  function checkBlobLength () {
    if (typeof file.length === 'number' && file.length > opts.maxBlobLength) {
      debug(
        'File length too large for Blob URL approach: %d (max: %d)',
        file.length, opts.maxBlobLength
      )
      fatalError(new Error(
        `File length too large for Blob URL approach: ${file.length} (max: ${opts.maxBlobLength})`
      ))
      return false
    }
    return true
  }

  function renderMediaElement (type) {
    if (!checkBlobLength()) return

    elem = getElem(type)
    getBlobURL(file, (err, url) => {
      if (err) return fatalError(err)
      elem.addEventListener('error', fatalError)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)
      elem.src = url
    })
  }

  function onLoadStart () {
    elem.removeEventListener('loadstart', onLoadStart)
    if (opts.autoplay) {
      const playPromise = elem.play()
      if (typeof playPromise !== 'undefined') playPromise.catch(fatalError)
    }
  }

  function onLoadedMetadata () {
    elem.removeEventListener('loadedmetadata', onLoadedMetadata)
    cb(null, elem)
  }

  function renderImage () {
    elem = getElem('img')
    getBlobURL(file, (err, url) => {
      if (err) return fatalError(err)
      elem.src = url
      elem.alt = file.name
      cb(null, elem)
    })
  }

  function renderIframe () {
    getBlobURL(file, (err, url) => {
      if (err) return fatalError(err)

      if (extname !== '.pdf') {
        // Render iframe
        elem = getElem('iframe')
        elem.sandbox = 'allow-forms allow-scripts'
        elem.src = url
      } else {
        // Render .pdf
        elem = getElem('object')
        // Firefox-only: `typemustmatch` keeps the embedded file from running unless
        // its content type matches the specified `type` attribute
        elem.setAttribute('typemustmatch', true)
        elem.setAttribute('type', 'application/pdf')
        elem.setAttribute('data', url)
      }
      cb(null, elem)
    })
  }

  function tryRenderIframe () {
    debug('Unknown file extension "%s" - will attempt to render into iframe', extname)

    let str = ''
    file.createReadStream({ start: 0, end: 1000 })
      .setEncoding('utf8')
      .on('data', chunk => {
        str += chunk
      })
      .on('end', done)
      .on('error', cb)

    function done () {
      if (isAscii(str)) {
        debug('File extension "%s" appears ascii, so will render.', extname)
        renderIframe()
      } else {
        debug('File extension "%s" appears non-ascii, will not render.', extname)
        cb(new Error(`Unsupported file type "${extname}": Cannot append to DOM`))
      }
    }
  }

  function fatalError (err) {
    err.message = `Error rendering file "${file.name}": ${err.message}`
    debug(err.message)
    cb(err)
  }
}

function getBlobURL (file, cb) {
  const extname = path.extname(file.name).toLowerCase()
  streamToBlobURL(file.createReadStream(), exports.mime[extname])
    .then(
      blobUrl => cb(null, blobUrl),
      err => cb(err)
    )
}

function validateFile (file) {
  if (file == null) {
    throw new Error('file cannot be null or undefined')
  }
  if (typeof file.name !== 'string') {
    throw new Error('missing or invalid file.name property')
  }
  if (typeof file.createReadStream !== 'function') {
    throw new Error('missing or invalid file.createReadStream property')
  }
}

function getCodec (name) {
  const extname = path.extname(name).toLowerCase()
  return {
    '.m4a': 'audio/mp4; codecs="mp4a.40.5"',
    '.m4b': 'audio/mp4; codecs="mp4a.40.5"',
    '.m4p': 'audio/mp4; codecs="mp4a.40.5"',
    '.m4v': 'video/mp4; codecs="avc1.640029, mp4a.40.5"',
    '.mkv': 'video/webm; codecs="avc1.640029, mp4a.40.5"',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4; codecs="avc1.640029, mp4a.40.5"',
    '.webm': 'video/webm; codecs="vorbis, vp8"'
  }[extname]
}

function parseOpts (opts) {
  if (opts.autoplay == null) opts.autoplay = false
  if (opts.muted == null) opts.muted = false
  if (opts.controls == null) opts.controls = true
  if (opts.maxBlobLength == null) opts.maxBlobLength = MAX_BLOB_LENGTH
}

function setMediaOpts (elem, opts) {
  elem.autoplay = !!opts.autoplay
  elem.muted = !!opts.muted
  elem.controls = !!opts.controls
}

},{"./lib/mime.json":232,"debug":111,"is-ascii":139,"mediasource":145,"path":203,"stream-to-blob-url":293,"videostream":314}],232:[function(require,module,exports){
module.exports={
  ".3gp": "video/3gpp",
  ".aac": "audio/aac",
  ".aif": "audio/x-aiff",
  ".aiff": "audio/x-aiff",
  ".atom": "application/atom+xml",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".bz2": "application/x-bzip2",
  ".conf": "text/plain",
  ".css": "text/css",
  ".csv": "text/plain",
  ".diff": "text/x-diff",
  ".doc": "application/msword",
  ".flv": "video/x-flv",
  ".gif": "image/gif",
  ".gz": "application/x-gzip",
  ".htm": "text/html",
  ".html": "text/html",
  ".ico": "image/vnd.microsoft.icon",
  ".ics": "text/calendar",
  ".iso": "application/octet-stream",
  ".jar": "application/java-archive",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript",
  ".json": "application/json",
  ".less": "text/css",
  ".log": "text/plain",
  ".m3u": "audio/x-mpegurl",
  ".m4a": "audio/x-m4a",
  ".m4b": "audio/mp4",
  ".m4p": "audio/mp4",
  ".m4v": "video/x-m4v",
  ".manifest": "text/cache-manifest",
  ".markdown": "text/x-markdown",
  ".mathml": "application/mathml+xml",
  ".md": "text/x-markdown",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mp4v": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".oga": "audio/ogg",
  ".ogg": "application/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".pps": "application/vnd.ms-powerpoint",
  ".ppt": "application/vnd.ms-powerpoint",
  ".ps": "application/postscript",
  ".psd": "image/vnd.adobe.photoshop",
  ".qt": "video/quicktime",
  ".rar": "application/x-rar-compressed",
  ".rdf": "application/rdf+xml",
  ".rss": "application/rss+xml",
  ".rtf": "application/rtf",
  ".svg": "image/svg+xml",
  ".svgz": "image/svg+xml",
  ".swf": "application/x-shockwave-flash",
  ".tar": "application/x-tar",
  ".tbz": "application/x-bzip-compressed-tar",
  ".text": "text/plain",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".torrent": "application/x-bittorrent",
  ".ttf": "application/x-font-ttf",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".wma": "audio/x-ms-wma",
  ".wmv": "video/x-ms-wmv",
  ".xls": "application/vnd.ms-excel",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".zip": "application/zip"
}

},{}],233:[function(require,module,exports){
/*! run-parallel-limit. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = runParallelLimit

const queueMicrotask = require('queue-microtask')

function runParallelLimit (tasks, limit, cb) {
  if (typeof limit !== 'number') throw new Error('second argument must be a Number')
  let results, len, pending, keys, isErrored
  let isSync = true
  let next

  if (Array.isArray(tasks)) {
    results = []
    pending = len = tasks.length
  } else {
    keys = Object.keys(tasks)
    results = {}
    pending = len = keys.length
  }

  function done (err) {
    function end () {
      if (cb) cb(err, results)
      cb = null
    }
    if (isSync) queueMicrotask(end)
    else end()
  }

  function each (i, err, result) {
    results[i] = result
    if (err) isErrored = true
    if (--pending === 0 || err) {
      done(err)
    } else if (!isErrored && next < len) {
      let key
      if (keys) {
        key = keys[next]
        next += 1
        tasks[key](function (err, result) { each(key, err, result) })
      } else {
        key = next
        next += 1
        tasks[key](function (err, result) { each(key, err, result) })
      }
    }
  }

  next = limit
  if (!pending) {
    // empty
    done(null)
  } else if (keys) {
    // object
    keys.some(function (key, i) {
      tasks[key](function (err, result) { each(key, err, result) })
      if (i === limit - 1) return true // early return
      return false
    })
  } else {
    // array
    tasks.some(function (task, i) {
      task(function (err, result) { each(i, err, result) })
      if (i === limit - 1) return true // early return
      return false
    })
  }

  isSync = false
}

},{"queue-microtask":212}],234:[function(require,module,exports){
/*! run-parallel. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = runParallel

const queueMicrotask = require('queue-microtask')

function runParallel (tasks, cb) {
  let results, pending, keys
  let isSync = true

  if (Array.isArray(tasks)) {
    results = []
    pending = tasks.length
  } else {
    keys = Object.keys(tasks)
    results = {}
    pending = keys.length
  }

  function done (err) {
    function end () {
      if (cb) cb(err, results)
      cb = null
    }
    if (isSync) queueMicrotask(end)
    else end()
  }

  function each (i, err, result) {
    results[i] = result
    if (--pending === 0 || err) {
      done(err)
    }
  }

  if (!pending) {
    // empty
    done(null)
  } else if (keys) {
    // object
    keys.forEach(function (key) {
      tasks[key](function (err, result) { each(key, err, result) })
    })
  } else {
    // array
    tasks.forEach(function (task, i) {
      task(function (err, result) { each(i, err, result) })
    })
  }

  isSync = false
}

},{"queue-microtask":212}],235:[function(require,module,exports){
(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["Rusha"] = factory();
	else
		root["Rusha"] = factory();
})(typeof self !== 'undefined' ? self : this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, {
/******/ 				configurable: false,
/******/ 				enumerable: true,
/******/ 				get: getter
/******/ 			});
/******/ 		}
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = 3);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/* eslint-env commonjs, browser */

var RushaCore = __webpack_require__(5);

var _require = __webpack_require__(1),
    toHex = _require.toHex,
    ceilHeapSize = _require.ceilHeapSize;

var conv = __webpack_require__(6);

// Calculate the length of buffer that the sha1 routine uses
// including the padding.
var padlen = function (len) {
  for (len += 9; len % 64 > 0; len += 1) {}
  return len;
};

var padZeroes = function (bin, len) {
  var h8 = new Uint8Array(bin.buffer);
  var om = len % 4,
      align = len - om;
  switch (om) {
    case 0:
      h8[align + 3] = 0;
    case 1:
      h8[align + 2] = 0;
    case 2:
      h8[align + 1] = 0;
    case 3:
      h8[align + 0] = 0;
  }
  for (var i = (len >> 2) + 1; i < bin.length; i++) {
    bin[i] = 0;
  }
};

var padData = function (bin, chunkLen, msgLen) {
  bin[chunkLen >> 2] |= 0x80 << 24 - (chunkLen % 4 << 3);
  // To support msgLen >= 2 GiB, use a float division when computing the
  // high 32-bits of the big-endian message length in bits.
  bin[((chunkLen >> 2) + 2 & ~0x0f) + 14] = msgLen / (1 << 29) | 0;
  bin[((chunkLen >> 2) + 2 & ~0x0f) + 15] = msgLen << 3;
};

var getRawDigest = function (heap, padMaxChunkLen) {
  var io = new Int32Array(heap, padMaxChunkLen + 320, 5);
  var out = new Int32Array(5);
  var arr = new DataView(out.buffer);
  arr.setInt32(0, io[0], false);
  arr.setInt32(4, io[1], false);
  arr.setInt32(8, io[2], false);
  arr.setInt32(12, io[3], false);
  arr.setInt32(16, io[4], false);
  return out;
};

var Rusha = function () {
  function Rusha(chunkSize) {
    _classCallCheck(this, Rusha);

    chunkSize = chunkSize || 64 * 1024;
    if (chunkSize % 64 > 0) {
      throw new Error('Chunk size must be a multiple of 128 bit');
    }
    this._offset = 0;
    this._maxChunkLen = chunkSize;
    this._padMaxChunkLen = padlen(chunkSize);
    // The size of the heap is the sum of:
    // 1. The padded input message size
    // 2. The extended space the algorithm needs (320 byte)
    // 3. The 160 bit state the algoritm uses
    this._heap = new ArrayBuffer(ceilHeapSize(this._padMaxChunkLen + 320 + 20));
    this._h32 = new Int32Array(this._heap);
    this._h8 = new Int8Array(this._heap);
    this._core = new RushaCore({ Int32Array: Int32Array }, {}, this._heap);
  }

  Rusha.prototype._initState = function _initState(heap, padMsgLen) {
    this._offset = 0;
    var io = new Int32Array(heap, padMsgLen + 320, 5);
    io[0] = 1732584193;
    io[1] = -271733879;
    io[2] = -1732584194;
    io[3] = 271733878;
    io[4] = -1009589776;
  };

  Rusha.prototype._padChunk = function _padChunk(chunkLen, msgLen) {
    var padChunkLen = padlen(chunkLen);
    var view = new Int32Array(this._heap, 0, padChunkLen >> 2);
    padZeroes(view, chunkLen);
    padData(view, chunkLen, msgLen);
    return padChunkLen;
  };

  Rusha.prototype._write = function _write(data, chunkOffset, chunkLen, off) {
    conv(data, this._h8, this._h32, chunkOffset, chunkLen, off || 0);
  };

  Rusha.prototype._coreCall = function _coreCall(data, chunkOffset, chunkLen, msgLen, finalize) {
    var padChunkLen = chunkLen;
    this._write(data, chunkOffset, chunkLen);
    if (finalize) {
      padChunkLen = this._padChunk(chunkLen, msgLen);
    }
    this._core.hash(padChunkLen, this._padMaxChunkLen);
  };

  Rusha.prototype.rawDigest = function rawDigest(str) {
    var msgLen = str.byteLength || str.length || str.size || 0;
    this._initState(this._heap, this._padMaxChunkLen);
    var chunkOffset = 0,
        chunkLen = this._maxChunkLen;
    for (chunkOffset = 0; msgLen > chunkOffset + chunkLen; chunkOffset += chunkLen) {
      this._coreCall(str, chunkOffset, chunkLen, msgLen, false);
    }
    this._coreCall(str, chunkOffset, msgLen - chunkOffset, msgLen, true);
    return getRawDigest(this._heap, this._padMaxChunkLen);
  };

  Rusha.prototype.digest = function digest(str) {
    return toHex(this.rawDigest(str).buffer);
  };

  Rusha.prototype.digestFromString = function digestFromString(str) {
    return this.digest(str);
  };

  Rusha.prototype.digestFromBuffer = function digestFromBuffer(str) {
    return this.digest(str);
  };

  Rusha.prototype.digestFromArrayBuffer = function digestFromArrayBuffer(str) {
    return this.digest(str);
  };

  Rusha.prototype.resetState = function resetState() {
    this._initState(this._heap, this._padMaxChunkLen);
    return this;
  };

  Rusha.prototype.append = function append(chunk) {
    var chunkOffset = 0;
    var chunkLen = chunk.byteLength || chunk.length || chunk.size || 0;
    var turnOffset = this._offset % this._maxChunkLen;
    var inputLen = void 0;

    this._offset += chunkLen;
    while (chunkOffset < chunkLen) {
      inputLen = Math.min(chunkLen - chunkOffset, this._maxChunkLen - turnOffset);
      this._write(chunk, chunkOffset, inputLen, turnOffset);
      turnOffset += inputLen;
      chunkOffset += inputLen;
      if (turnOffset === this._maxChunkLen) {
        this._core.hash(this._maxChunkLen, this._padMaxChunkLen);
        turnOffset = 0;
      }
    }
    return this;
  };

  Rusha.prototype.getState = function getState() {
    var turnOffset = this._offset % this._maxChunkLen;
    var heap = void 0;
    if (!turnOffset) {
      var io = new Int32Array(this._heap, this._padMaxChunkLen + 320, 5);
      heap = io.buffer.slice(io.byteOffset, io.byteOffset + io.byteLength);
    } else {
      heap = this._heap.slice(0);
    }
    return {
      offset: this._offset,
      heap: heap
    };
  };

  Rusha.prototype.setState = function setState(state) {
    this._offset = state.offset;
    if (state.heap.byteLength === 20) {
      var io = new Int32Array(this._heap, this._padMaxChunkLen + 320, 5);
      io.set(new Int32Array(state.heap));
    } else {
      this._h32.set(new Int32Array(state.heap));
    }
    return this;
  };

  Rusha.prototype.rawEnd = function rawEnd() {
    var msgLen = this._offset;
    var chunkLen = msgLen % this._maxChunkLen;
    var padChunkLen = this._padChunk(chunkLen, msgLen);
    this._core.hash(padChunkLen, this._padMaxChunkLen);
    var result = getRawDigest(this._heap, this._padMaxChunkLen);
    this._initState(this._heap, this._padMaxChunkLen);
    return result;
  };

  Rusha.prototype.end = function end() {
    return toHex(this.rawEnd().buffer);
  };

  return Rusha;
}();

module.exports = Rusha;
module.exports._core = RushaCore;

/***/ }),
/* 1 */
/***/ (function(module, exports) {

/* eslint-env commonjs, browser */

//
// toHex
//

var precomputedHex = new Array(256);
for (var i = 0; i < 256; i++) {
  precomputedHex[i] = (i < 0x10 ? '0' : '') + i.toString(16);
}

module.exports.toHex = function (arrayBuffer) {
  var binarray = new Uint8Array(arrayBuffer);
  var res = new Array(arrayBuffer.byteLength);
  for (var _i = 0; _i < res.length; _i++) {
    res[_i] = precomputedHex[binarray[_i]];
  }
  return res.join('');
};

//
// ceilHeapSize
//

module.exports.ceilHeapSize = function (v) {
  // The asm.js spec says:
  // The heap object's byteLength must be either
  // 2^n for n in [12, 24) or 2^24 * n for n ≥ 1.
  // Also, byteLengths smaller than 2^16 are deprecated.
  var p = 0;
  // If v is smaller than 2^16, the smallest possible solution
  // is 2^16.
  if (v <= 65536) return 65536;
  // If v < 2^24, we round up to 2^n,
  // otherwise we round up to 2^24 * n.
  if (v < 16777216) {
    for (p = 1; p < v; p = p << 1) {}
  } else {
    for (p = 16777216; p < v; p += 16777216) {}
  }
  return p;
};

//
// isDedicatedWorkerScope
//

module.exports.isDedicatedWorkerScope = function (self) {
  var isRunningInWorker = 'WorkerGlobalScope' in self && self instanceof self.WorkerGlobalScope;
  var isRunningInSharedWorker = 'SharedWorkerGlobalScope' in self && self instanceof self.SharedWorkerGlobalScope;
  var isRunningInServiceWorker = 'ServiceWorkerGlobalScope' in self && self instanceof self.ServiceWorkerGlobalScope;

  // Detects whether we run inside a dedicated worker or not.
  //
  // We can't just check for `DedicatedWorkerGlobalScope`, since IE11
  // has a bug where it only supports `WorkerGlobalScope`.
  //
  // Therefore, we consider us as running inside a dedicated worker
  // when we are running inside a worker, but not in a shared or service worker.
  //
  // When new types of workers are introduced, we will need to adjust this code.
  return isRunningInWorker && !isRunningInSharedWorker && !isRunningInServiceWorker;
};

/***/ }),
/* 2 */
/***/ (function(module, exports, __webpack_require__) {

/* eslint-env commonjs, worker */

module.exports = function () {
  var Rusha = __webpack_require__(0);

  var hashData = function (hasher, data, cb) {
    try {
      return cb(null, hasher.digest(data));
    } catch (e) {
      return cb(e);
    }
  };

  var hashFile = function (hasher, readTotal, blockSize, file, cb) {
    var reader = new self.FileReader();
    reader.onloadend = function onloadend() {
      if (reader.error) {
        return cb(reader.error);
      }
      var buffer = reader.result;
      readTotal += reader.result.byteLength;
      try {
        hasher.append(buffer);
      } catch (e) {
        cb(e);
        return;
      }
      if (readTotal < file.size) {
        hashFile(hasher, readTotal, blockSize, file, cb);
      } else {
        cb(null, hasher.end());
      }
    };
    reader.readAsArrayBuffer(file.slice(readTotal, readTotal + blockSize));
  };

  var workerBehaviourEnabled = true;

  self.onmessage = function (event) {
    if (!workerBehaviourEnabled) {
      return;
    }

    var data = event.data.data,
        file = event.data.file,
        id = event.data.id;
    if (typeof id === 'undefined') return;
    if (!file && !data) return;
    var blockSize = event.data.blockSize || 4 * 1024 * 1024;
    var hasher = new Rusha(blockSize);
    hasher.resetState();
    var done = function (err, hash) {
      if (!err) {
        self.postMessage({ id: id, hash: hash });
      } else {
        self.postMessage({ id: id, error: err.name });
      }
    };
    if (data) hashData(hasher, data, done);
    if (file) hashFile(hasher, 0, blockSize, file, done);
  };

  return function () {
    workerBehaviourEnabled = false;
  };
};

/***/ }),
/* 3 */
/***/ (function(module, exports, __webpack_require__) {

/* eslint-env commonjs, browser */

var work = __webpack_require__(4);
var Rusha = __webpack_require__(0);
var createHash = __webpack_require__(7);
var runWorker = __webpack_require__(2);

var _require = __webpack_require__(1),
    isDedicatedWorkerScope = _require.isDedicatedWorkerScope;

var isRunningInDedicatedWorker = typeof self !== 'undefined' && isDedicatedWorkerScope(self);

Rusha.disableWorkerBehaviour = isRunningInDedicatedWorker ? runWorker() : function () {};

Rusha.createWorker = function () {
  var worker = work(/*require.resolve*/(2));
  var terminate = worker.terminate;
  worker.terminate = function () {
    URL.revokeObjectURL(worker.objectURL);
    terminate.call(worker);
  };
  return worker;
};

Rusha.createHash = createHash;

module.exports = Rusha;

/***/ }),
/* 4 */
/***/ (function(module, exports, __webpack_require__) {

function webpackBootstrapFunc (modules) {
/******/  // The module cache
/******/  var installedModules = {};

/******/  // The require function
/******/  function __webpack_require__(moduleId) {

/******/    // Check if module is in cache
/******/    if(installedModules[moduleId])
/******/      return installedModules[moduleId].exports;

/******/    // Create a new module (and put it into the cache)
/******/    var module = installedModules[moduleId] = {
/******/      i: moduleId,
/******/      l: false,
/******/      exports: {}
/******/    };

/******/    // Execute the module function
/******/    modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/    // Flag the module as loaded
/******/    module.l = true;

/******/    // Return the exports of the module
/******/    return module.exports;
/******/  }

/******/  // expose the modules object (__webpack_modules__)
/******/  __webpack_require__.m = modules;

/******/  // expose the module cache
/******/  __webpack_require__.c = installedModules;

/******/  // identity function for calling harmony imports with the correct context
/******/  __webpack_require__.i = function(value) { return value; };

/******/  // define getter function for harmony exports
/******/  __webpack_require__.d = function(exports, name, getter) {
/******/    if(!__webpack_require__.o(exports, name)) {
/******/      Object.defineProperty(exports, name, {
/******/        configurable: false,
/******/        enumerable: true,
/******/        get: getter
/******/      });
/******/    }
/******/  };

/******/  // define __esModule on exports
/******/  __webpack_require__.r = function(exports) {
/******/    Object.defineProperty(exports, '__esModule', { value: true });
/******/  };

/******/  // getDefaultExport function for compatibility with non-harmony modules
/******/  __webpack_require__.n = function(module) {
/******/    var getter = module && module.__esModule ?
/******/      function getDefault() { return module['default']; } :
/******/      function getModuleExports() { return module; };
/******/    __webpack_require__.d(getter, 'a', getter);
/******/    return getter;
/******/  };

/******/  // Object.prototype.hasOwnProperty.call
/******/  __webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };

/******/  // __webpack_public_path__
/******/  __webpack_require__.p = "/";

/******/  // on error function for async loading
/******/  __webpack_require__.oe = function(err) { console.error(err); throw err; };

  var f = __webpack_require__(__webpack_require__.s = ENTRY_MODULE)
  return f.default || f // try to call default if defined to also support babel esmodule exports
}

var moduleNameReqExp = '[\\.|\\-|\\+|\\w|\/|@]+'
var dependencyRegExp = '\\((\/\\*.*?\\*\/)?\s?.*?(' + moduleNameReqExp + ').*?\\)' // additional chars when output.pathinfo is true

// http://stackoverflow.com/a/2593661/130442
function quoteRegExp (str) {
  return (str + '').replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')
}

function getModuleDependencies (sources, module, queueName) {
  var retval = {}
  retval[queueName] = []

  var fnString = module.toString()
  var wrapperSignature = fnString.match(/^function\s?\(\w+,\s*\w+,\s*(\w+)\)/)
  if (!wrapperSignature) return retval
  var webpackRequireName = wrapperSignature[1]

  // main bundle deps
  var re = new RegExp('(\\\\n|\\W)' + quoteRegExp(webpackRequireName) + dependencyRegExp, 'g')
  var match
  while ((match = re.exec(fnString))) {
    if (match[3] === 'dll-reference') continue
    retval[queueName].push(match[3])
  }

  // dll deps
  re = new RegExp('\\(' + quoteRegExp(webpackRequireName) + '\\("(dll-reference\\s(' + moduleNameReqExp + '))"\\)\\)' + dependencyRegExp, 'g')
  while ((match = re.exec(fnString))) {
    if (!sources[match[2]]) {
      retval[queueName].push(match[1])
      sources[match[2]] = __webpack_require__(match[1]).m
    }
    retval[match[2]] = retval[match[2]] || []
    retval[match[2]].push(match[4])
  }

  return retval
}

function hasValuesInQueues (queues) {
  var keys = Object.keys(queues)
  return keys.reduce(function (hasValues, key) {
    return hasValues || queues[key].length > 0
  }, false)
}

function getRequiredModules (sources, moduleId) {
  var modulesQueue = {
    main: [moduleId]
  }
  var requiredModules = {
    main: []
  }
  var seenModules = {
    main: {}
  }

  while (hasValuesInQueues(modulesQueue)) {
    var queues = Object.keys(modulesQueue)
    for (var i = 0; i < queues.length; i++) {
      var queueName = queues[i]
      var queue = modulesQueue[queueName]
      var moduleToCheck = queue.pop()
      seenModules[queueName] = seenModules[queueName] || {}
      if (seenModules[queueName][moduleToCheck] || !sources[queueName][moduleToCheck]) continue
      seenModules[queueName][moduleToCheck] = true
      requiredModules[queueName] = requiredModules[queueName] || []
      requiredModules[queueName].push(moduleToCheck)
      var newModules = getModuleDependencies(sources, sources[queueName][moduleToCheck], queueName)
      var newModulesKeys = Object.keys(newModules)
      for (var j = 0; j < newModulesKeys.length; j++) {
        modulesQueue[newModulesKeys[j]] = modulesQueue[newModulesKeys[j]] || []
        modulesQueue[newModulesKeys[j]] = modulesQueue[newModulesKeys[j]].concat(newModules[newModulesKeys[j]])
      }
    }
  }

  return requiredModules
}

module.exports = function (moduleId, options) {
  options = options || {}
  var sources = {
    main: __webpack_require__.m
  }

  var requiredModules = options.all ? { main: Object.keys(sources) } : getRequiredModules(sources, moduleId)

  var src = ''

  Object.keys(requiredModules).filter(function (m) { return m !== 'main' }).forEach(function (module) {
    var entryModule = 0
    while (requiredModules[module][entryModule]) {
      entryModule++
    }
    requiredModules[module].push(entryModule)
    sources[module][entryModule] = '(function(module, exports, __webpack_require__) { module.exports = __webpack_require__; })'
    src = src + 'var ' + module + ' = (' + webpackBootstrapFunc.toString().replace('ENTRY_MODULE', JSON.stringify(entryModule)) + ')({' + requiredModules[module].map(function (id) { return '' + JSON.stringify(id) + ': ' + sources[module][id].toString() }).join(',') + '});\n'
  })

  src = src + '(' + webpackBootstrapFunc.toString().replace('ENTRY_MODULE', JSON.stringify(moduleId)) + ')({' + requiredModules.main.map(function (id) { return '' + JSON.stringify(id) + ': ' + sources.main[id].toString() }).join(',') + '})(self);'

  var blob = new window.Blob([src], { type: 'text/javascript' })
  if (options.bare) { return blob }

  var URL = window.URL || window.webkitURL || window.mozURL || window.msURL

  var workerUrl = URL.createObjectURL(blob)
  var worker = new window.Worker(workerUrl)
  worker.objectURL = workerUrl

  return worker
}


/***/ }),
/* 5 */
/***/ (function(module, exports) {

// The low-level RushCore module provides the heart of Rusha,
// a high-speed sha1 implementation working on an Int32Array heap.
// At first glance, the implementation seems complicated, however
// with the SHA1 spec at hand, it is obvious this almost a textbook
// implementation that has a few functions hand-inlined and a few loops
// hand-unrolled.
module.exports = function RushaCore(stdlib$846, foreign$847, heap$848) {
    'use asm';
    var H$849 = new stdlib$846.Int32Array(heap$848);
    function hash$850(k$851, x$852) {
        // k in bytes
        k$851 = k$851 | 0;
        x$852 = x$852 | 0;
        var i$853 = 0, j$854 = 0, y0$855 = 0, z0$856 = 0, y1$857 = 0, z1$858 = 0, y2$859 = 0, z2$860 = 0, y3$861 = 0, z3$862 = 0, y4$863 = 0, z4$864 = 0, t0$865 = 0, t1$866 = 0;
        y0$855 = H$849[x$852 + 320 >> 2] | 0;
        y1$857 = H$849[x$852 + 324 >> 2] | 0;
        y2$859 = H$849[x$852 + 328 >> 2] | 0;
        y3$861 = H$849[x$852 + 332 >> 2] | 0;
        y4$863 = H$849[x$852 + 336 >> 2] | 0;
        for (i$853 = 0; (i$853 | 0) < (k$851 | 0); i$853 = i$853 + 64 | 0) {
            z0$856 = y0$855;
            z1$858 = y1$857;
            z2$860 = y2$859;
            z3$862 = y3$861;
            z4$864 = y4$863;
            for (j$854 = 0; (j$854 | 0) < 64; j$854 = j$854 + 4 | 0) {
                t1$866 = H$849[i$853 + j$854 >> 2] | 0;
                t0$865 = ((y0$855 << 5 | y0$855 >>> 27) + (y1$857 & y2$859 | ~y1$857 & y3$861) | 0) + ((t1$866 + y4$863 | 0) + 1518500249 | 0) | 0;
                y4$863 = y3$861;
                y3$861 = y2$859;
                y2$859 = y1$857 << 30 | y1$857 >>> 2;
                y1$857 = y0$855;
                y0$855 = t0$865;
                H$849[k$851 + j$854 >> 2] = t1$866;
            }
            for (j$854 = k$851 + 64 | 0; (j$854 | 0) < (k$851 + 80 | 0); j$854 = j$854 + 4 | 0) {
                t1$866 = (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) << 1 | (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) >>> 31;
                t0$865 = ((y0$855 << 5 | y0$855 >>> 27) + (y1$857 & y2$859 | ~y1$857 & y3$861) | 0) + ((t1$866 + y4$863 | 0) + 1518500249 | 0) | 0;
                y4$863 = y3$861;
                y3$861 = y2$859;
                y2$859 = y1$857 << 30 | y1$857 >>> 2;
                y1$857 = y0$855;
                y0$855 = t0$865;
                H$849[j$854 >> 2] = t1$866;
            }
            for (j$854 = k$851 + 80 | 0; (j$854 | 0) < (k$851 + 160 | 0); j$854 = j$854 + 4 | 0) {
                t1$866 = (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) << 1 | (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) >>> 31;
                t0$865 = ((y0$855 << 5 | y0$855 >>> 27) + (y1$857 ^ y2$859 ^ y3$861) | 0) + ((t1$866 + y4$863 | 0) + 1859775393 | 0) | 0;
                y4$863 = y3$861;
                y3$861 = y2$859;
                y2$859 = y1$857 << 30 | y1$857 >>> 2;
                y1$857 = y0$855;
                y0$855 = t0$865;
                H$849[j$854 >> 2] = t1$866;
            }
            for (j$854 = k$851 + 160 | 0; (j$854 | 0) < (k$851 + 240 | 0); j$854 = j$854 + 4 | 0) {
                t1$866 = (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) << 1 | (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) >>> 31;
                t0$865 = ((y0$855 << 5 | y0$855 >>> 27) + (y1$857 & y2$859 | y1$857 & y3$861 | y2$859 & y3$861) | 0) + ((t1$866 + y4$863 | 0) - 1894007588 | 0) | 0;
                y4$863 = y3$861;
                y3$861 = y2$859;
                y2$859 = y1$857 << 30 | y1$857 >>> 2;
                y1$857 = y0$855;
                y0$855 = t0$865;
                H$849[j$854 >> 2] = t1$866;
            }
            for (j$854 = k$851 + 240 | 0; (j$854 | 0) < (k$851 + 320 | 0); j$854 = j$854 + 4 | 0) {
                t1$866 = (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) << 1 | (H$849[j$854 - 12 >> 2] ^ H$849[j$854 - 32 >> 2] ^ H$849[j$854 - 56 >> 2] ^ H$849[j$854 - 64 >> 2]) >>> 31;
                t0$865 = ((y0$855 << 5 | y0$855 >>> 27) + (y1$857 ^ y2$859 ^ y3$861) | 0) + ((t1$866 + y4$863 | 0) - 899497514 | 0) | 0;
                y4$863 = y3$861;
                y3$861 = y2$859;
                y2$859 = y1$857 << 30 | y1$857 >>> 2;
                y1$857 = y0$855;
                y0$855 = t0$865;
                H$849[j$854 >> 2] = t1$866;
            }
            y0$855 = y0$855 + z0$856 | 0;
            y1$857 = y1$857 + z1$858 | 0;
            y2$859 = y2$859 + z2$860 | 0;
            y3$861 = y3$861 + z3$862 | 0;
            y4$863 = y4$863 + z4$864 | 0;
        }
        H$849[x$852 + 320 >> 2] = y0$855;
        H$849[x$852 + 324 >> 2] = y1$857;
        H$849[x$852 + 328 >> 2] = y2$859;
        H$849[x$852 + 332 >> 2] = y3$861;
        H$849[x$852 + 336 >> 2] = y4$863;
    }
    return { hash: hash$850 };
};

/***/ }),
/* 6 */
/***/ (function(module, exports) {

var _this = this;

/* eslint-env commonjs, browser */

var reader = void 0;
if (typeof self !== 'undefined' && typeof self.FileReaderSync !== 'undefined') {
  reader = new self.FileReaderSync();
}

// Convert a binary string and write it to the heap.
// A binary string is expected to only contain char codes < 256.
var convStr = function (str, H8, H32, start, len, off) {
  var i = void 0,
      om = off % 4,
      lm = (len + om) % 4,
      j = len - lm;
  switch (om) {
    case 0:
      H8[off] = str.charCodeAt(start + 3);
    case 1:
      H8[off + 1 - (om << 1) | 0] = str.charCodeAt(start + 2);
    case 2:
      H8[off + 2 - (om << 1) | 0] = str.charCodeAt(start + 1);
    case 3:
      H8[off + 3 - (om << 1) | 0] = str.charCodeAt(start);
  }
  if (len < lm + (4 - om)) {
    return;
  }
  for (i = 4 - om; i < j; i = i + 4 | 0) {
    H32[off + i >> 2] = str.charCodeAt(start + i) << 24 | str.charCodeAt(start + i + 1) << 16 | str.charCodeAt(start + i + 2) << 8 | str.charCodeAt(start + i + 3);
  }
  switch (lm) {
    case 3:
      H8[off + j + 1 | 0] = str.charCodeAt(start + j + 2);
    case 2:
      H8[off + j + 2 | 0] = str.charCodeAt(start + j + 1);
    case 1:
      H8[off + j + 3 | 0] = str.charCodeAt(start + j);
  }
};

// Convert a buffer or array and write it to the heap.
// The buffer or array is expected to only contain elements < 256.
var convBuf = function (buf, H8, H32, start, len, off) {
  var i = void 0,
      om = off % 4,
      lm = (len + om) % 4,
      j = len - lm;
  switch (om) {
    case 0:
      H8[off] = buf[start + 3];
    case 1:
      H8[off + 1 - (om << 1) | 0] = buf[start + 2];
    case 2:
      H8[off + 2 - (om << 1) | 0] = buf[start + 1];
    case 3:
      H8[off + 3 - (om << 1) | 0] = buf[start];
  }
  if (len < lm + (4 - om)) {
    return;
  }
  for (i = 4 - om; i < j; i = i + 4 | 0) {
    H32[off + i >> 2 | 0] = buf[start + i] << 24 | buf[start + i + 1] << 16 | buf[start + i + 2] << 8 | buf[start + i + 3];
  }
  switch (lm) {
    case 3:
      H8[off + j + 1 | 0] = buf[start + j + 2];
    case 2:
      H8[off + j + 2 | 0] = buf[start + j + 1];
    case 1:
      H8[off + j + 3 | 0] = buf[start + j];
  }
};

var convBlob = function (blob, H8, H32, start, len, off) {
  var i = void 0,
      om = off % 4,
      lm = (len + om) % 4,
      j = len - lm;
  var buf = new Uint8Array(reader.readAsArrayBuffer(blob.slice(start, start + len)));
  switch (om) {
    case 0:
      H8[off] = buf[3];
    case 1:
      H8[off + 1 - (om << 1) | 0] = buf[2];
    case 2:
      H8[off + 2 - (om << 1) | 0] = buf[1];
    case 3:
      H8[off + 3 - (om << 1) | 0] = buf[0];
  }
  if (len < lm + (4 - om)) {
    return;
  }
  for (i = 4 - om; i < j; i = i + 4 | 0) {
    H32[off + i >> 2 | 0] = buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3];
  }
  switch (lm) {
    case 3:
      H8[off + j + 1 | 0] = buf[j + 2];
    case 2:
      H8[off + j + 2 | 0] = buf[j + 1];
    case 1:
      H8[off + j + 3 | 0] = buf[j];
  }
};

module.exports = function (data, H8, H32, start, len, off) {
  if (typeof data === 'string') {
    return convStr(data, H8, H32, start, len, off);
  }
  if (data instanceof Array) {
    return convBuf(data, H8, H32, start, len, off);
  }
  // Safely doing a Buffer check using "this" to avoid Buffer polyfill to be included in the dist
  if (_this && _this.Buffer && _this.Buffer.isBuffer(data)) {
    return convBuf(data, H8, H32, start, len, off);
  }
  if (data instanceof ArrayBuffer) {
    return convBuf(new Uint8Array(data), H8, H32, start, len, off);
  }
  if (data.buffer instanceof ArrayBuffer) {
    return convBuf(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), H8, H32, start, len, off);
  }
  if (data instanceof Blob) {
    return convBlob(data, H8, H32, start, len, off);
  }
  throw new Error('Unsupported data type.');
};

/***/ }),
/* 7 */
/***/ (function(module, exports, __webpack_require__) {

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/* eslint-env commonjs, browser */

var Rusha = __webpack_require__(0);

var _require = __webpack_require__(1),
    toHex = _require.toHex;

var Hash = function () {
  function Hash() {
    _classCallCheck(this, Hash);

    this._rusha = new Rusha();
    this._rusha.resetState();
  }

  Hash.prototype.update = function update(data) {
    this._rusha.append(data);
    return this;
  };

  Hash.prototype.digest = function digest(encoding) {
    var digest = this._rusha.rawEnd().buffer;
    if (!encoding) {
      return digest;
    }
    if (encoding === 'hex') {
      return toHex(digest);
    }
    throw new Error('unsupported digest encoding');
  };

  return Hash;
}();

module.exports = function () {
  return new Hash();
};

/***/ })
/******/ ]);
});
},{}],236:[function(require,module,exports){
/*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
/* eslint-disable node/no-deprecated-api */
var buffer = require('buffer')
var Buffer = buffer.Buffer

// alternative to using Object.keys for old browsers
function copyProps (src, dst) {
  for (var key in src) {
    dst[key] = src[key]
  }
}
if (Buffer.from && Buffer.alloc && Buffer.allocUnsafe && Buffer.allocUnsafeSlow) {
  module.exports = buffer
} else {
  // Copy properties from require('buffer')
  copyProps(buffer, exports)
  exports.Buffer = SafeBuffer
}

function SafeBuffer (arg, encodingOrOffset, length) {
  return Buffer(arg, encodingOrOffset, length)
}

SafeBuffer.prototype = Object.create(Buffer.prototype)

// Copy static methods from Buffer
copyProps(Buffer, SafeBuffer)

SafeBuffer.from = function (arg, encodingOrOffset, length) {
  if (typeof arg === 'number') {
    throw new TypeError('Argument must not be a number')
  }
  return Buffer(arg, encodingOrOffset, length)
}

SafeBuffer.alloc = function (size, fill, encoding) {
  if (typeof size !== 'number') {
    throw new TypeError('Argument must be a number')
  }
  var buf = Buffer(size)
  if (fill !== undefined) {
    if (typeof encoding === 'string') {
      buf.fill(fill, encoding)
    } else {
      buf.fill(fill)
    }
  } else {
    buf.fill(0)
  }
  return buf
}

SafeBuffer.allocUnsafe = function (size) {
  if (typeof size !== 'number') {
    throw new TypeError('Argument must be a number')
  }
  return Buffer(size)
}

SafeBuffer.allocUnsafeSlow = function (size) {
  if (typeof size !== 'number') {
    throw new TypeError('Argument must be a number')
  }
  return buffer.SlowBuffer(size)
}

},{"buffer":52}],237:[function(require,module,exports){
(function (Buffer){(function (){
/*! simple-concat. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = function (stream, cb) {
  var chunks = []
  stream.on('data', function (chunk) {
    chunks.push(chunk)
  })
  stream.once('end', function () {
    if (cb) cb(null, Buffer.concat(chunks))
    cb = null
  })
  stream.once('error', function (err) {
    if (cb) cb(err)
    cb = null
  })
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],238:[function(require,module,exports){
(function (Buffer){(function (){
/*! simple-get. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = simpleGet

const concat = require('simple-concat')
const decompressResponse = require('decompress-response') // excluded from browser build
const http = require('http')
const https = require('https')
const once = require('once')
const querystring = require('querystring')
const url = require('url')

const isStream = o => o !== null && typeof o === 'object' && typeof o.pipe === 'function'

function simpleGet (opts, cb) {
  opts = Object.assign({ maxRedirects: 10 }, typeof opts === 'string' ? { url: opts } : opts)
  cb = once(cb)

  if (opts.url) {
    const { hostname, port, protocol, auth, path } = url.parse(opts.url) // eslint-disable-line node/no-deprecated-api
    delete opts.url
    if (!hostname && !port && !protocol && !auth) opts.path = path // Relative redirect
    else Object.assign(opts, { hostname, port, protocol, auth, path }) // Absolute redirect
  }

  const headers = { 'accept-encoding': 'gzip, deflate' }
  if (opts.headers) Object.keys(opts.headers).forEach(k => (headers[k.toLowerCase()] = opts.headers[k]))
  opts.headers = headers

  let body
  if (opts.body) {
    body = opts.json && !isStream(opts.body) ? JSON.stringify(opts.body) : opts.body
  } else if (opts.form) {
    body = typeof opts.form === 'string' ? opts.form : querystring.stringify(opts.form)
    opts.headers['content-type'] = 'application/x-www-form-urlencoded'
  }

  if (body) {
    if (!opts.method) opts.method = 'POST'
    if (!isStream(body)) opts.headers['content-length'] = Buffer.byteLength(body)
    if (opts.json && !opts.form) opts.headers['content-type'] = 'application/json'
  }
  delete opts.body; delete opts.form

  if (opts.json) opts.headers.accept = 'application/json'
  if (opts.method) opts.method = opts.method.toUpperCase()

  const protocol = opts.protocol === 'https:' ? https : http // Support http/https urls
  const req = protocol.request(opts, res => {
    if (opts.followRedirects !== false && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      opts.url = res.headers.location // Follow 3xx redirects
      delete opts.headers.host // Discard `host` header on redirect (see #32)
      res.resume() // Discard response

      if (opts.method === 'POST' && [301, 302].includes(res.statusCode)) {
        opts.method = 'GET' // On 301/302 redirect, change POST to GET (see #35)
        delete opts.headers['content-length']; delete opts.headers['content-type']
      }

      if (opts.maxRedirects-- === 0) return cb(new Error('too many redirects'))
      else return simpleGet(opts, cb)
    }

    const tryUnzip = typeof decompressResponse === 'function' && opts.method !== 'HEAD'
    cb(null, tryUnzip ? decompressResponse(res) : res)
  })
  req.on('timeout', () => {
    req.abort()
    cb(new Error('Request timed out'))
  })
  req.on('error', cb)

  if (isStream(body)) body.on('error', cb).pipe(req)
  else req.end(body)

  return req
}

simpleGet.concat = (opts, cb) => {
  return simpleGet(opts, (err, res) => {
    if (err) return cb(err)
    concat(res, (err, data) => {
      if (err) return cb(err)
      if (opts.json) {
        try {
          data = JSON.parse(data.toString())
        } catch (err) {
          return cb(err, res, data)
        }
      }
      cb(null, res, data)
    })
  })
}

;['get', 'post', 'put', 'patch', 'head', 'delete'].forEach(method => {
  simpleGet[method] = (opts, cb) => {
    if (typeof opts === 'string') opts = { url: opts }
    return simpleGet(Object.assign({ method: method.toUpperCase() }, opts), cb)
  }
})

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"decompress-response":48,"http":274,"https":135,"once":201,"querystring":211,"simple-concat":237,"url":309}],239:[function(require,module,exports){
/*! simple-peer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
const debug = require('debug')('simple-peer')
const getBrowserRTC = require('get-browser-rtc')
const randombytes = require('randombytes')
const stream = require('readable-stream')
const queueMicrotask = require('queue-microtask') // TODO: remove when Node 10 is not supported
const errCode = require('err-code')
const { Buffer } = require('buffer')

const MAX_BUFFERED_AMOUNT = 64 * 1024
const ICECOMPLETE_TIMEOUT = 5 * 1000
const CHANNEL_CLOSING_TIMEOUT = 5 * 1000

// HACK: Filter trickle lines when trickle is disabled #354
function filterTrickle (sdp) {
  return sdp.replace(/a=ice-options:trickle\s\n/g, '')
}

function warn (message) {
  console.warn(message)
}

/**
 * WebRTC peer connection. Same API as node core `net.Socket`, plus a few extra methods.
 * Duplex stream.
 * @param {Object} opts
 */
class Peer extends stream.Duplex {
  constructor (opts) {
    opts = Object.assign({
      allowHalfOpen: false
    }, opts)

    super(opts)

    this._id = randombytes(4).toString('hex').slice(0, 7)
    this._debug('new peer %o', opts)

    this.channelName = opts.initiator
      ? opts.channelName || randombytes(20).toString('hex')
      : null

    this.initiator = opts.initiator || false
    this.channelConfig = opts.channelConfig || Peer.channelConfig
    this.channelNegotiated = this.channelConfig.negotiated
    this.config = Object.assign({}, Peer.config, opts.config)
    this.offerOptions = opts.offerOptions || {}
    this.answerOptions = opts.answerOptions || {}
    this.sdpTransform = opts.sdpTransform || (sdp => sdp)
    this.streams = opts.streams || (opts.stream ? [opts.stream] : []) // support old "stream" option
    this.trickle = opts.trickle !== undefined ? opts.trickle : true
    this.allowHalfTrickle = opts.allowHalfTrickle !== undefined ? opts.allowHalfTrickle : false
    this.iceCompleteTimeout = opts.iceCompleteTimeout || ICECOMPLETE_TIMEOUT

    this.destroyed = false
    this.destroying = false
    this._connected = false

    this.remoteAddress = undefined
    this.remoteFamily = undefined
    this.remotePort = undefined
    this.localAddress = undefined
    this.localFamily = undefined
    this.localPort = undefined

    this._wrtc = (opts.wrtc && typeof opts.wrtc === 'object')
      ? opts.wrtc
      : getBrowserRTC()

    if (!this._wrtc) {
      if (typeof window === 'undefined') {
        throw errCode(new Error('No WebRTC support: Specify `opts.wrtc` option in this environment'), 'ERR_WEBRTC_SUPPORT')
      } else {
        throw errCode(new Error('No WebRTC support: Not a supported browser'), 'ERR_WEBRTC_SUPPORT')
      }
    }

    this._pcReady = false
    this._channelReady = false
    this._iceComplete = false // ice candidate trickle done (got null candidate)
    this._iceCompleteTimer = null // send an offer/answer anyway after some timeout
    this._channel = null
    this._pendingCandidates = []

    this._isNegotiating = false // is this peer waiting for negotiation to complete?
    this._firstNegotiation = true
    this._batchedNegotiation = false // batch synchronous negotiations
    this._queuedNegotiation = false // is there a queued negotiation request?
    this._sendersAwaitingStable = []
    this._senderMap = new Map()
    this._closingInterval = null

    this._remoteTracks = []
    this._remoteStreams = []

    this._chunk = null
    this._cb = null
    this._interval = null

    try {
      this._pc = new (this._wrtc.RTCPeerConnection)(this.config)
    } catch (err) {
      this.destroy(errCode(err, 'ERR_PC_CONSTRUCTOR'))
      return
    }

    // We prefer feature detection whenever possible, but sometimes that's not
    // possible for certain implementations.
    this._isReactNativeWebrtc = typeof this._pc._peerConnectionId === 'number'

    this._pc.oniceconnectionstatechange = () => {
      this._onIceStateChange()
    }
    this._pc.onicegatheringstatechange = () => {
      this._onIceStateChange()
    }
    this._pc.onconnectionstatechange = () => {
      this._onConnectionStateChange()
    }
    this._pc.onsignalingstatechange = () => {
      this._onSignalingStateChange()
    }
    this._pc.onicecandidate = event => {
      this._onIceCandidate(event)
    }

    // HACK: Fix for odd Firefox behavior, see: https://github.com/feross/simple-peer/pull/783
    if (typeof this._pc.peerIdentity === 'object') {
      this._pc.peerIdentity.catch(err => {
        this.destroy(errCode(err, 'ERR_PC_PEER_IDENTITY'))
      })
    }

    // Other spec events, unused by this implementation:
    // - onconnectionstatechange
    // - onicecandidateerror
    // - onfingerprintfailure
    // - onnegotiationneeded

    if (this.initiator || this.channelNegotiated) {
      this._setupData({
        channel: this._pc.createDataChannel(this.channelName, this.channelConfig)
      })
    } else {
      this._pc.ondatachannel = event => {
        this._setupData(event)
      }
    }

    if (this.streams) {
      this.streams.forEach(stream => {
        this.addStream(stream)
      })
    }
    this._pc.ontrack = event => {
      this._onTrack(event)
    }

    this._debug('initial negotiation')
    this._needsNegotiation()

    this._onFinishBound = () => {
      this._onFinish()
    }
    this.once('finish', this._onFinishBound)
  }

  get bufferSize () {
    return (this._channel && this._channel.bufferedAmount) || 0
  }

  // HACK: it's possible channel.readyState is "closing" before peer.destroy() fires
  // https://bugs.chromium.org/p/chromium/issues/detail?id=882743
  get connected () {
    return (this._connected && this._channel.readyState === 'open')
  }

  address () {
    return { port: this.localPort, family: this.localFamily, address: this.localAddress }
  }

  signal (data) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot signal after peer is destroyed'), 'ERR_DESTROYED')
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (err) {
        data = {}
      }
    }
    this._debug('signal()')

    if (data.renegotiate && this.initiator) {
      this._debug('got request to renegotiate')
      this._needsNegotiation()
    }
    if (data.transceiverRequest && this.initiator) {
      this._debug('got request for transceiver')
      this.addTransceiver(data.transceiverRequest.kind, data.transceiverRequest.init)
    }
    if (data.candidate) {
      if (this._pc.remoteDescription && this._pc.remoteDescription.type) {
        this._addIceCandidate(data.candidate)
      } else {
        this._pendingCandidates.push(data.candidate)
      }
    }
    if (data.sdp) {
      this._pc.setRemoteDescription(new (this._wrtc.RTCSessionDescription)(data))
        .then(() => {
          if (this.destroyed) return

          this._pendingCandidates.forEach(candidate => {
            this._addIceCandidate(candidate)
          })
          this._pendingCandidates = []

          if (this._pc.remoteDescription.type === 'offer') this._createAnswer()
        })
        .catch(err => {
          this.destroy(errCode(err, 'ERR_SET_REMOTE_DESCRIPTION'))
        })
    }
    if (!data.sdp && !data.candidate && !data.renegotiate && !data.transceiverRequest) {
      this.destroy(errCode(new Error('signal() called with invalid signal data'), 'ERR_SIGNALING'))
    }
  }

  _addIceCandidate (candidate) {
    const iceCandidateObj = new this._wrtc.RTCIceCandidate(candidate)
    this._pc.addIceCandidate(iceCandidateObj)
      .catch(err => {
        if (!iceCandidateObj.address || iceCandidateObj.address.endsWith('.local')) {
          warn('Ignoring unsupported ICE candidate.')
        } else {
          this.destroy(errCode(err, 'ERR_ADD_ICE_CANDIDATE'))
        }
      })
  }

  /**
   * Send text/binary data to the remote peer.
   * @param {ArrayBufferView|ArrayBuffer|Buffer|string|Blob} chunk
   */
  send (chunk) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot send after peer is destroyed'), 'ERR_DESTROYED')
    this._channel.send(chunk)
  }

  /**
   * Add a Transceiver to the connection.
   * @param {String} kind
   * @param {Object} init
   */
  addTransceiver (kind, init) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot addTransceiver after peer is destroyed'), 'ERR_DESTROYED')
    this._debug('addTransceiver()')

    if (this.initiator) {
      try {
        this._pc.addTransceiver(kind, init)
        this._needsNegotiation()
      } catch (err) {
        this.destroy(errCode(err, 'ERR_ADD_TRANSCEIVER'))
      }
    } else {
      this.emit('signal', { // request initiator to renegotiate
        type: 'transceiverRequest',
        transceiverRequest: { kind, init }
      })
    }
  }

  /**
   * Add a MediaStream to the connection.
   * @param {MediaStream} stream
   */
  addStream (stream) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot addStream after peer is destroyed'), 'ERR_DESTROYED')
    this._debug('addStream()')

    stream.getTracks().forEach(track => {
      this.addTrack(track, stream)
    })
  }

  /**
   * Add a MediaStreamTrack to the connection.
   * @param {MediaStreamTrack} track
   * @param {MediaStream} stream
   */
  addTrack (track, stream) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot addTrack after peer is destroyed'), 'ERR_DESTROYED')
    this._debug('addTrack()')

    const submap = this._senderMap.get(track) || new Map() // nested Maps map [track, stream] to sender
    let sender = submap.get(stream)
    if (!sender) {
      sender = this._pc.addTrack(track, stream)
      submap.set(stream, sender)
      this._senderMap.set(track, submap)
      this._needsNegotiation()
    } else if (sender.removed) {
      throw errCode(new Error('Track has been removed. You should enable/disable tracks that you want to re-add.'), 'ERR_SENDER_REMOVED')
    } else {
      throw errCode(new Error('Track has already been added to that stream.'), 'ERR_SENDER_ALREADY_ADDED')
    }
  }

  /**
   * Replace a MediaStreamTrack by another in the connection.
   * @param {MediaStreamTrack} oldTrack
   * @param {MediaStreamTrack} newTrack
   * @param {MediaStream} stream
   */
  replaceTrack (oldTrack, newTrack, stream) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot replaceTrack after peer is destroyed'), 'ERR_DESTROYED')
    this._debug('replaceTrack()')

    const submap = this._senderMap.get(oldTrack)
    const sender = submap ? submap.get(stream) : null
    if (!sender) {
      throw errCode(new Error('Cannot replace track that was never added.'), 'ERR_TRACK_NOT_ADDED')
    }
    if (newTrack) this._senderMap.set(newTrack, submap)

    if (sender.replaceTrack != null) {
      sender.replaceTrack(newTrack)
    } else {
      this.destroy(errCode(new Error('replaceTrack is not supported in this browser'), 'ERR_UNSUPPORTED_REPLACETRACK'))
    }
  }

  /**
   * Remove a MediaStreamTrack from the connection.
   * @param {MediaStreamTrack} track
   * @param {MediaStream} stream
   */
  removeTrack (track, stream) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot removeTrack after peer is destroyed'), 'ERR_DESTROYED')
    this._debug('removeSender()')

    const submap = this._senderMap.get(track)
    const sender = submap ? submap.get(stream) : null
    if (!sender) {
      throw errCode(new Error('Cannot remove track that was never added.'), 'ERR_TRACK_NOT_ADDED')
    }
    try {
      sender.removed = true
      this._pc.removeTrack(sender)
    } catch (err) {
      if (err.name === 'NS_ERROR_UNEXPECTED') {
        this._sendersAwaitingStable.push(sender) // HACK: Firefox must wait until (signalingState === stable) https://bugzilla.mozilla.org/show_bug.cgi?id=1133874
      } else {
        this.destroy(errCode(err, 'ERR_REMOVE_TRACK'))
      }
    }
    this._needsNegotiation()
  }

  /**
   * Remove a MediaStream from the connection.
   * @param {MediaStream} stream
   */
  removeStream (stream) {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot removeStream after peer is destroyed'), 'ERR_DESTROYED')
    this._debug('removeSenders()')

    stream.getTracks().forEach(track => {
      this.removeTrack(track, stream)
    })
  }

  _needsNegotiation () {
    this._debug('_needsNegotiation')
    if (this._batchedNegotiation) return // batch synchronous renegotiations
    this._batchedNegotiation = true
    queueMicrotask(() => {
      this._batchedNegotiation = false
      if (this.initiator || !this._firstNegotiation) {
        this._debug('starting batched negotiation')
        this.negotiate()
      } else {
        this._debug('non-initiator initial negotiation request discarded')
      }
      this._firstNegotiation = false
    })
  }

  negotiate () {
    if (this.destroying) return
    if (this.destroyed) throw errCode(new Error('cannot negotiate after peer is destroyed'), 'ERR_DESTROYED')

    if (this.initiator) {
      if (this._isNegotiating) {
        this._queuedNegotiation = true
        this._debug('already negotiating, queueing')
      } else {
        this._debug('start negotiation')
        setTimeout(() => { // HACK: Chrome crashes if we immediately call createOffer
          this._createOffer()
        }, 0)
      }
    } else {
      if (this._isNegotiating) {
        this._queuedNegotiation = true
        this._debug('already negotiating, queueing')
      } else {
        this._debug('requesting negotiation from initiator')
        this.emit('signal', { // request initiator to renegotiate
          type: 'renegotiate',
          renegotiate: true
        })
      }
    }
    this._isNegotiating = true
  }

  // TODO: Delete this method once readable-stream is updated to contain a default
  // implementation of destroy() that automatically calls _destroy()
  // See: https://github.com/nodejs/readable-stream/issues/283
  destroy (err) {
    this._destroy(err, () => {})
  }

  _destroy (err, cb) {
    if (this.destroyed || this.destroying) return
    this.destroying = true

    this._debug('destroying (error: %s)', err && (err.message || err))

    queueMicrotask(() => { // allow events concurrent with the call to _destroy() to fire (see #692)
      this.destroyed = true
      this.destroying = false

      this._debug('destroy (error: %s)', err && (err.message || err))

      this.readable = this.writable = false

      if (!this._readableState.ended) this.push(null)
      if (!this._writableState.finished) this.end()

      this._connected = false
      this._pcReady = false
      this._channelReady = false
      this._remoteTracks = null
      this._remoteStreams = null
      this._senderMap = null

      clearInterval(this._closingInterval)
      this._closingInterval = null

      clearInterval(this._interval)
      this._interval = null
      this._chunk = null
      this._cb = null

      if (this._onFinishBound) this.removeListener('finish', this._onFinishBound)
      this._onFinishBound = null

      if (this._channel) {
        try {
          this._channel.close()
        } catch (err) {}

        // allow events concurrent with destruction to be handled
        this._channel.onmessage = null
        this._channel.onopen = null
        this._channel.onclose = null
        this._channel.onerror = null
      }
      if (this._pc) {
        try {
          this._pc.close()
        } catch (err) {}

        // allow events concurrent with destruction to be handled
        this._pc.oniceconnectionstatechange = null
        this._pc.onicegatheringstatechange = null
        this._pc.onsignalingstatechange = null
        this._pc.onicecandidate = null
        this._pc.ontrack = null
        this._pc.ondatachannel = null
      }
      this._pc = null
      this._channel = null

      if (err) this.emit('error', err)
      this.emit('close')
      cb()
    })
  }

  _setupData (event) {
    if (!event.channel) {
      // In some situations `pc.createDataChannel()` returns `undefined` (in wrtc),
      // which is invalid behavior. Handle it gracefully.
      // See: https://github.com/feross/simple-peer/issues/163
      return this.destroy(errCode(new Error('Data channel event is missing `channel` property'), 'ERR_DATA_CHANNEL'))
    }

    this._channel = event.channel
    this._channel.binaryType = 'arraybuffer'

    if (typeof this._channel.bufferedAmountLowThreshold === 'number') {
      this._channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT
    }

    this.channelName = this._channel.label

    this._channel.onmessage = event => {
      this._onChannelMessage(event)
    }
    this._channel.onbufferedamountlow = () => {
      this._onChannelBufferedAmountLow()
    }
    this._channel.onopen = () => {
      this._onChannelOpen()
    }
    this._channel.onclose = () => {
      this._onChannelClose()
    }
    this._channel.onerror = event => {
      const err = event.error instanceof Error
        ? event.error
        : new Error(`Datachannel error: ${event.message} ${event.filename}:${event.lineno}:${event.colno}`)
      this.destroy(errCode(err, 'ERR_DATA_CHANNEL'))
    }

    // HACK: Chrome will sometimes get stuck in readyState "closing", let's check for this condition
    // https://bugs.chromium.org/p/chromium/issues/detail?id=882743
    let isClosing = false
    this._closingInterval = setInterval(() => { // No "onclosing" event
      if (this._channel && this._channel.readyState === 'closing') {
        if (isClosing) this._onChannelClose() // closing timed out: equivalent to onclose firing
        isClosing = true
      } else {
        isClosing = false
      }
    }, CHANNEL_CLOSING_TIMEOUT)
  }

  _read () {}

  _write (chunk, encoding, cb) {
    if (this.destroyed) return cb(errCode(new Error('cannot write after peer is destroyed'), 'ERR_DATA_CHANNEL'))

    if (this._connected) {
      try {
        this.send(chunk)
      } catch (err) {
        return this.destroy(errCode(err, 'ERR_DATA_CHANNEL'))
      }
      if (this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        this._debug('start backpressure: bufferedAmount %d', this._channel.bufferedAmount)
        this._cb = cb
      } else {
        cb(null)
      }
    } else {
      this._debug('write before connect')
      this._chunk = chunk
      this._cb = cb
    }
  }

  // When stream finishes writing, close socket. Half open connections are not
  // supported.
  _onFinish () {
    if (this.destroyed) return

    // Wait a bit before destroying so the socket flushes.
    // TODO: is there a more reliable way to accomplish this?
    const destroySoon = () => {
      setTimeout(() => this.destroy(), 1000)
    }

    if (this._connected) {
      destroySoon()
    } else {
      this.once('connect', destroySoon)
    }
  }

  _startIceCompleteTimeout () {
    if (this.destroyed) return
    if (this._iceCompleteTimer) return
    this._debug('started iceComplete timeout')
    this._iceCompleteTimer = setTimeout(() => {
      if (!this._iceComplete) {
        this._iceComplete = true
        this._debug('iceComplete timeout completed')
        this.emit('iceTimeout')
        this.emit('_iceComplete')
      }
    }, this.iceCompleteTimeout)
  }

  _createOffer () {
    if (this.destroyed) return

    this._pc.createOffer(this.offerOptions)
      .then(offer => {
        if (this.destroyed) return
        if (!this.trickle && !this.allowHalfTrickle) offer.sdp = filterTrickle(offer.sdp)
        offer.sdp = this.sdpTransform(offer.sdp)

        const sendOffer = () => {
          if (this.destroyed) return
          const signal = this._pc.localDescription || offer
          this._debug('signal')
          this.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          })
        }

        const onSuccess = () => {
          this._debug('createOffer success')
          if (this.destroyed) return
          if (this.trickle || this._iceComplete) sendOffer()
          else this.once('_iceComplete', sendOffer) // wait for candidates
        }

        const onError = err => {
          this.destroy(errCode(err, 'ERR_SET_LOCAL_DESCRIPTION'))
        }

        this._pc.setLocalDescription(offer)
          .then(onSuccess)
          .catch(onError)
      })
      .catch(err => {
        this.destroy(errCode(err, 'ERR_CREATE_OFFER'))
      })
  }

  _requestMissingTransceivers () {
    if (this._pc.getTransceivers) {
      this._pc.getTransceivers().forEach(transceiver => {
        if (!transceiver.mid && transceiver.sender.track && !transceiver.requested) {
          transceiver.requested = true // HACK: Safari returns negotiated transceivers with a null mid
          this.addTransceiver(transceiver.sender.track.kind)
        }
      })
    }
  }

  _createAnswer () {
    if (this.destroyed) return

    this._pc.createAnswer(this.answerOptions)
      .then(answer => {
        if (this.destroyed) return
        if (!this.trickle && !this.allowHalfTrickle) answer.sdp = filterTrickle(answer.sdp)
        answer.sdp = this.sdpTransform(answer.sdp)

        const sendAnswer = () => {
          if (this.destroyed) return
          const signal = this._pc.localDescription || answer
          this._debug('signal')
          this.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          })
          if (!this.initiator) this._requestMissingTransceivers()
        }

        const onSuccess = () => {
          if (this.destroyed) return
          if (this.trickle || this._iceComplete) sendAnswer()
          else this.once('_iceComplete', sendAnswer)
        }

        const onError = err => {
          this.destroy(errCode(err, 'ERR_SET_LOCAL_DESCRIPTION'))
        }

        this._pc.setLocalDescription(answer)
          .then(onSuccess)
          .catch(onError)
      })
      .catch(err => {
        this.destroy(errCode(err, 'ERR_CREATE_ANSWER'))
      })
  }

  _onConnectionStateChange () {
    if (this.destroyed) return
    if (this._pc.connectionState === 'failed') {
      this.destroy(errCode(new Error('Connection failed.'), 'ERR_CONNECTION_FAILURE'))
    }
  }

  _onIceStateChange () {
    if (this.destroyed) return
    const iceConnectionState = this._pc.iceConnectionState
    const iceGatheringState = this._pc.iceGatheringState

    this._debug(
      'iceStateChange (connection: %s) (gathering: %s)',
      iceConnectionState,
      iceGatheringState
    )
    this.emit('iceStateChange', iceConnectionState, iceGatheringState)

    if (iceConnectionState === 'connected' || iceConnectionState === 'completed') {
      this._pcReady = true
      this._maybeReady()
    }
    if (iceConnectionState === 'failed') {
      this.destroy(errCode(new Error('Ice connection failed.'), 'ERR_ICE_CONNECTION_FAILURE'))
    }
    if (iceConnectionState === 'closed') {
      this.destroy(errCode(new Error('Ice connection closed.'), 'ERR_ICE_CONNECTION_CLOSED'))
    }
  }

  getStats (cb) {
    // statreports can come with a value array instead of properties
    const flattenValues = report => {
      if (Object.prototype.toString.call(report.values) === '[object Array]') {
        report.values.forEach(value => {
          Object.assign(report, value)
        })
      }
      return report
    }

    // Promise-based getStats() (standard)
    if (this._pc.getStats.length === 0 || this._isReactNativeWebrtc) {
      this._pc.getStats()
        .then(res => {
          const reports = []
          res.forEach(report => {
            reports.push(flattenValues(report))
          })
          cb(null, reports)
        }, err => cb(err))

    // Single-parameter callback-based getStats() (non-standard)
    } else if (this._pc.getStats.length > 0) {
      this._pc.getStats(res => {
        // If we destroy connection in `connect` callback this code might happen to run when actual connection is already closed
        if (this.destroyed) return

        const reports = []
        res.result().forEach(result => {
          const report = {}
          result.names().forEach(name => {
            report[name] = result.stat(name)
          })
          report.id = result.id
          report.type = result.type
          report.timestamp = result.timestamp
          reports.push(flattenValues(report))
        })
        cb(null, reports)
      }, err => cb(err))

    // Unknown browser, skip getStats() since it's anyone's guess which style of
    // getStats() they implement.
    } else {
      cb(null, [])
    }
  }

  _maybeReady () {
    this._debug('maybeReady pc %s channel %s', this._pcReady, this._channelReady)
    if (this._connected || this._connecting || !this._pcReady || !this._channelReady) return

    this._connecting = true

    // HACK: We can't rely on order here, for details see https://github.com/js-platform/node-webrtc/issues/339
    const findCandidatePair = () => {
      if (this.destroyed) return

      this.getStats((err, items) => {
        if (this.destroyed) return

        // Treat getStats error as non-fatal. It's not essential.
        if (err) items = []

        const remoteCandidates = {}
        const localCandidates = {}
        const candidatePairs = {}
        let foundSelectedCandidatePair = false

        items.forEach(item => {
          // TODO: Once all browsers support the hyphenated stats report types, remove
          // the non-hypenated ones
          if (item.type === 'remotecandidate' || item.type === 'remote-candidate') {
            remoteCandidates[item.id] = item
          }
          if (item.type === 'localcandidate' || item.type === 'local-candidate') {
            localCandidates[item.id] = item
          }
          if (item.type === 'candidatepair' || item.type === 'candidate-pair') {
            candidatePairs[item.id] = item
          }
        })

        const setSelectedCandidatePair = selectedCandidatePair => {
          foundSelectedCandidatePair = true

          let local = localCandidates[selectedCandidatePair.localCandidateId]

          if (local && (local.ip || local.address)) {
            // Spec
            this.localAddress = local.ip || local.address
            this.localPort = Number(local.port)
          } else if (local && local.ipAddress) {
            // Firefox
            this.localAddress = local.ipAddress
            this.localPort = Number(local.portNumber)
          } else if (typeof selectedCandidatePair.googLocalAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            local = selectedCandidatePair.googLocalAddress.split(':')
            this.localAddress = local[0]
            this.localPort = Number(local[1])
          }
          if (this.localAddress) {
            this.localFamily = this.localAddress.includes(':') ? 'IPv6' : 'IPv4'
          }

          let remote = remoteCandidates[selectedCandidatePair.remoteCandidateId]

          if (remote && (remote.ip || remote.address)) {
            // Spec
            this.remoteAddress = remote.ip || remote.address
            this.remotePort = Number(remote.port)
          } else if (remote && remote.ipAddress) {
            // Firefox
            this.remoteAddress = remote.ipAddress
            this.remotePort = Number(remote.portNumber)
          } else if (typeof selectedCandidatePair.googRemoteAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            remote = selectedCandidatePair.googRemoteAddress.split(':')
            this.remoteAddress = remote[0]
            this.remotePort = Number(remote[1])
          }
          if (this.remoteAddress) {
            this.remoteFamily = this.remoteAddress.includes(':') ? 'IPv6' : 'IPv4'
          }

          this._debug(
            'connect local: %s:%s remote: %s:%s',
            this.localAddress,
            this.localPort,
            this.remoteAddress,
            this.remotePort
          )
        }

        items.forEach(item => {
          // Spec-compliant
          if (item.type === 'transport' && item.selectedCandidatePairId) {
            setSelectedCandidatePair(candidatePairs[item.selectedCandidatePairId])
          }

          // Old implementations
          if (
            (item.type === 'googCandidatePair' && item.googActiveConnection === 'true') ||
            ((item.type === 'candidatepair' || item.type === 'candidate-pair') && item.selected)
          ) {
            setSelectedCandidatePair(item)
          }
        })

        // Ignore candidate pair selection in browsers like Safari 11 that do not have any local or remote candidates
        // But wait until at least 1 candidate pair is available
        if (!foundSelectedCandidatePair && (!Object.keys(candidatePairs).length || Object.keys(localCandidates).length)) {
          setTimeout(findCandidatePair, 100)
          return
        } else {
          this._connecting = false
          this._connected = true
        }

        if (this._chunk) {
          try {
            this.send(this._chunk)
          } catch (err) {
            return this.destroy(errCode(err, 'ERR_DATA_CHANNEL'))
          }
          this._chunk = null
          this._debug('sent chunk from "write before connect"')

          const cb = this._cb
          this._cb = null
          cb(null)
        }

        // If `bufferedAmountLowThreshold` and 'onbufferedamountlow' are unsupported,
        // fallback to using setInterval to implement backpressure.
        if (typeof this._channel.bufferedAmountLowThreshold !== 'number') {
          this._interval = setInterval(() => this._onInterval(), 150)
          if (this._interval.unref) this._interval.unref()
        }

        this._debug('connect')
        this.emit('connect')
      })
    }
    findCandidatePair()
  }

  _onInterval () {
    if (!this._cb || !this._channel || this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      return
    }
    this._onChannelBufferedAmountLow()
  }

  _onSignalingStateChange () {
    if (this.destroyed) return

    if (this._pc.signalingState === 'stable') {
      this._isNegotiating = false

      // HACK: Firefox doesn't yet support removing tracks when signalingState !== 'stable'
      this._debug('flushing sender queue', this._sendersAwaitingStable)
      this._sendersAwaitingStable.forEach(sender => {
        this._pc.removeTrack(sender)
        this._queuedNegotiation = true
      })
      this._sendersAwaitingStable = []

      if (this._queuedNegotiation) {
        this._debug('flushing negotiation queue')
        this._queuedNegotiation = false
        this._needsNegotiation() // negotiate again
      } else {
        this._debug('negotiated')
        this.emit('negotiated')
      }
    }

    this._debug('signalingStateChange %s', this._pc.signalingState)
    this.emit('signalingStateChange', this._pc.signalingState)
  }

  _onIceCandidate (event) {
    if (this.destroyed) return
    if (event.candidate && this.trickle) {
      this.emit('signal', {
        type: 'candidate',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid
        }
      })
    } else if (!event.candidate && !this._iceComplete) {
      this._iceComplete = true
      this.emit('_iceComplete')
    }
    // as soon as we've received one valid candidate start timeout
    if (event.candidate) {
      this._startIceCompleteTimeout()
    }
  }

  _onChannelMessage (event) {
    if (this.destroyed) return
    let data = event.data
    if (data instanceof ArrayBuffer) data = Buffer.from(data)
    this.push(data)
  }

  _onChannelBufferedAmountLow () {
    if (this.destroyed || !this._cb) return
    this._debug('ending backpressure: bufferedAmount %d', this._channel.bufferedAmount)
    const cb = this._cb
    this._cb = null
    cb(null)
  }

  _onChannelOpen () {
    if (this._connected || this.destroyed) return
    this._debug('on channel open')
    this._channelReady = true
    this._maybeReady()
  }

  _onChannelClose () {
    if (this.destroyed) return
    this._debug('on channel close')
    this.destroy()
  }

  _onTrack (event) {
    if (this.destroyed) return

    event.streams.forEach(eventStream => {
      this._debug('on track')
      this.emit('track', event.track, eventStream)

      this._remoteTracks.push({
        track: event.track,
        stream: eventStream
      })

      if (this._remoteStreams.some(remoteStream => {
        return remoteStream.id === eventStream.id
      })) return // Only fire one 'stream' event, even though there may be multiple tracks per stream

      this._remoteStreams.push(eventStream)
      queueMicrotask(() => {
        this._debug('on stream')
        this.emit('stream', eventStream) // ensure all tracks have been added
      })
    })
  }

  _debug () {
    const args = [].slice.call(arguments)
    args[0] = '[' + this._id + '] ' + args[0]
    debug.apply(null, args)
  }
}

Peer.WEBRTC_SUPPORT = !!getBrowserRTC()

/**
 * Expose peer and data channel config for overriding all Peer
 * instances. Otherwise, just set opts.config or opts.channelConfig
 * when constructing a Peer.
 */
Peer.config = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:global.stun.twilio.com:3478'
      ]
    }
  ],
  sdpSemantics: 'unified-plan'
}

Peer.channelConfig = {}

module.exports = Peer

},{"buffer":52,"debug":111,"err-code":115,"get-browser-rtc":134,"queue-microtask":212,"randombytes":214,"readable-stream":254}],240:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],241:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":243,"./_stream_writable":245,"_process":206,"dup":13,"inherits":138}],242:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":244,"dup":14,"inherits":138}],243:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":240,"./_stream_duplex":241,"./internal/streams/async_iterator":246,"./internal/streams/buffer_list":247,"./internal/streams/destroy":248,"./internal/streams/from":250,"./internal/streams/state":252,"./internal/streams/stream":253,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],244:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":240,"./_stream_duplex":241,"dup":16,"inherits":138}],245:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":240,"./_stream_duplex":241,"./internal/streams/destroy":248,"./internal/streams/state":252,"./internal/streams/stream":253,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],246:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":249,"_process":206,"dup":18}],247:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],248:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],249:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":240,"dup":21}],250:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],251:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":240,"./end-of-stream":249,"dup":23}],252:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":240,"dup":24}],253:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],254:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":241,"./lib/_stream_passthrough.js":242,"./lib/_stream_readable.js":243,"./lib/_stream_transform.js":244,"./lib/_stream_writable.js":245,"./lib/internal/streams/end-of-stream.js":249,"./lib/internal/streams/pipeline.js":251,"dup":26}],255:[function(require,module,exports){
/* global self */

const Rusha = require('rusha')
const rushaWorkerSha1 = require('./rusha-worker-sha1')

const rusha = new Rusha()
const scope = typeof window !== 'undefined' ? window : self
const crypto = scope.crypto || scope.msCrypto || {}
let subtle = crypto.subtle || crypto.webkitSubtle

function sha1sync (buf) {
  return rusha.digest(buf)
}

// Browsers throw if they lack support for an algorithm.
// Promise will be rejected on non-secure origins. (http://goo.gl/lq4gCo)
try {
  subtle.digest({ name: 'sha-1' }, new Uint8Array()).catch(function () {
    subtle = false
  })
} catch (err) { subtle = false }

function sha1 (buf, cb) {
  if (!subtle) {
    if (typeof window !== 'undefined') {
      rushaWorkerSha1(buf, function onRushaWorkerSha1 (err, hash) {
        if (err) {
          // On error, fallback to synchronous method which cannot fail
          cb(sha1sync(buf))
          return
        }

        cb(hash)
      })
    } else {
      queueMicrotask(() => cb(sha1sync(buf)))
    }
    return
  }

  if (typeof buf === 'string') {
    buf = uint8array(buf)
  }

  subtle.digest({ name: 'sha-1' }, buf)
    .then(function succeed (result) {
      cb(hex(new Uint8Array(result)))
    },
    function fail () {
      // On error, fallback to synchronous method which cannot fail
      cb(sha1sync(buf))
    })
}

function uint8array (s) {
  const l = s.length
  const array = new Uint8Array(l)
  for (let i = 0; i < l; i++) {
    array[i] = s.charCodeAt(i)
  }
  return array
}

function hex (buf) {
  const l = buf.length
  const chars = []
  for (let i = 0; i < l; i++) {
    const bite = buf[i]
    chars.push((bite >>> 4).toString(16))
    chars.push((bite & 0x0f).toString(16))
  }
  return chars.join('')
}

module.exports = sha1
module.exports.sync = sha1sync

},{"./rusha-worker-sha1":256,"rusha":235}],256:[function(require,module,exports){
const Rusha = require('rusha')

let worker
let nextTaskId
let cbs

function init () {
  worker = Rusha.createWorker()
  nextTaskId = 1
  cbs = {} // taskId -> cb

  worker.onmessage = function onRushaMessage (e) {
    const taskId = e.data.id
    const cb = cbs[taskId]
    delete cbs[taskId]

    if (e.data.error != null) {
      cb(new Error('Rusha worker error: ' + e.data.error))
    } else {
      cb(null, e.data.hash)
    }
  }
}

function sha1 (buf, cb) {
  if (!worker) init()

  cbs[nextTaskId] = cb
  worker.postMessage({ id: nextTaskId, data: buf })
  nextTaskId += 1
}

module.exports = sha1

},{"rusha":235}],257:[function(require,module,exports){
(function (Buffer){(function (){
/*! simple-websocket. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
/* global WebSocket */

const debug = require('debug')('simple-websocket')
const randombytes = require('randombytes')
const stream = require('readable-stream')
const queueMicrotask = require('queue-microtask') // TODO: remove when Node 10 is not supported
const ws = require('ws') // websockets in node - will be empty object in browser

const _WebSocket = typeof ws !== 'function' ? WebSocket : ws

const MAX_BUFFERED_AMOUNT = 64 * 1024

/**
 * WebSocket. Same API as node core `net.Socket`. Duplex stream.
 * @param {Object} opts
 * @param {string=} opts.url websocket server url
 * @param {string=} opts.socket raw websocket instance to wrap
 */
class Socket extends stream.Duplex {
  constructor (opts = {}) {
    // Support simple usage: `new Socket(url)`
    if (typeof opts === 'string') {
      opts = { url: opts }
    }

    opts = Object.assign({
      allowHalfOpen: false
    }, opts)

    super(opts)

    if (opts.url == null && opts.socket == null) {
      throw new Error('Missing required `url` or `socket` option')
    }
    if (opts.url != null && opts.socket != null) {
      throw new Error('Must specify either `url` or `socket` option, not both')
    }

    this._id = randombytes(4).toString('hex').slice(0, 7)
    this._debug('new websocket: %o', opts)

    this.connected = false
    this.destroyed = false

    this._chunk = null
    this._cb = null
    this._interval = null

    if (opts.socket) {
      this.url = opts.socket.url
      this._ws = opts.socket
      this.connected = opts.socket.readyState === _WebSocket.OPEN
    } else {
      this.url = opts.url
      try {
        if (typeof ws === 'function') {
          // `ws` package accepts options
          this._ws = new _WebSocket(opts.url, null, {
            ...opts,
            encoding: undefined // encoding option breaks ws internals
          })
        } else {
          this._ws = new _WebSocket(opts.url)
        }
      } catch (err) {
        queueMicrotask(() => this.destroy(err))
        return
      }
    }

    this._ws.binaryType = 'arraybuffer'

    if (opts.socket && this.connected) {
      queueMicrotask(() => this._handleOpen())
    } else {
      this._ws.onopen = () => this._handleOpen()
    }

    this._ws.onmessage = event => this._handleMessage(event)
    this._ws.onclose = () => this._handleClose()
    this._ws.onerror = err => this._handleError(err)

    this._handleFinishBound = () => this._handleFinish()
    this.once('finish', this._handleFinishBound)
  }

  /**
   * Send text/binary data to the WebSocket server.
   * @param {TypedArrayView|ArrayBuffer|Buffer|string|Blob|Object} chunk
   */
  send (chunk) {
    this._ws.send(chunk)
  }

  // TODO: Delete this method once readable-stream is updated to contain a default
  // implementation of destroy() that automatically calls _destroy()
  // See: https://github.com/nodejs/readable-stream/issues/283
  destroy (err) {
    this._destroy(err, () => {})
  }

  _destroy (err, cb) {
    if (this.destroyed) return

    this._debug('destroy (error: %s)', err && (err.message || err))

    this.readable = this.writable = false
    if (!this._readableState.ended) this.push(null)
    if (!this._writableState.finished) this.end()

    this.connected = false
    this.destroyed = true

    clearInterval(this._interval)
    this._interval = null
    this._chunk = null
    this._cb = null

    if (this._handleFinishBound) {
      this.removeListener('finish', this._handleFinishBound)
    }
    this._handleFinishBound = null

    if (this._ws) {
      const ws = this._ws
      const onClose = () => {
        ws.onclose = null
      }
      if (ws.readyState === _WebSocket.CLOSED) {
        onClose()
      } else {
        try {
          ws.onclose = onClose
          ws.close()
        } catch (err) {
          onClose()
        }
      }

      ws.onopen = null
      ws.onmessage = null
      ws.onerror = () => {}
    }
    this._ws = null

    if (err) this.emit('error', err)
    this.emit('close')
    cb()
  }

  _read () {}

  _write (chunk, encoding, cb) {
    if (this.destroyed) return cb(new Error('cannot write after socket is destroyed'))

    if (this.connected) {
      try {
        this.send(chunk)
      } catch (err) {
        return this.destroy(err)
      }
      if (typeof ws !== 'function' && this._ws.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        this._debug('start backpressure: bufferedAmount %d', this._ws.bufferedAmount)
        this._cb = cb
      } else {
        cb(null)
      }
    } else {
      this._debug('write before connect')
      this._chunk = chunk
      this._cb = cb
    }
  }

  _handleOpen () {
    if (this.connected || this.destroyed) return
    this.connected = true

    if (this._chunk) {
      try {
        this.send(this._chunk)
      } catch (err) {
        return this.destroy(err)
      }
      this._chunk = null
      this._debug('sent chunk from "write before connect"')

      const cb = this._cb
      this._cb = null
      cb(null)
    }

    // Backpressure is not implemented in Node.js. The `ws` module has a buggy
    // `bufferedAmount` property. See: https://github.com/websockets/ws/issues/492
    if (typeof ws !== 'function') {
      this._interval = setInterval(() => this._onInterval(), 150)
      if (this._interval.unref) this._interval.unref()
    }

    this._debug('connect')
    this.emit('connect')
  }

  _handleMessage (event) {
    if (this.destroyed) return
    let data = event.data
    if (data instanceof ArrayBuffer) data = Buffer.from(data)
    this.push(data)
  }

  _handleClose () {
    if (this.destroyed) return
    this._debug('on close')
    this.destroy()
  }

  _handleError (_) {
    this.destroy(new Error(`Error connecting to ${this.url}`))
  }

  // When stream finishes writing, close socket. Half open connections are not
  // supported.
  _handleFinish () {
    if (this.destroyed) return

    // Wait a bit before destroying so the socket flushes.
    // TODO: is there a more reliable way to accomplish this?
    const destroySoon = () => {
      setTimeout(() => this.destroy(), 1000)
    }

    if (this.connected) {
      destroySoon()
    } else {
      this.once('connect', destroySoon)
    }
  }

  _onInterval () {
    if (!this._cb || !this._ws || this._ws.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      return
    }
    this._debug('ending backpressure: bufferedAmount %d', this._ws.bufferedAmount)
    const cb = this._cb
    this._cb = null
    cb(null)
  }

  _debug () {
    const args = [].slice.call(arguments)
    args[0] = '[' + this._id + '] ' + args[0]
    debug.apply(null, args)
  }
}

Socket.WEBSOCKET_SUPPORT = !!_WebSocket

module.exports = Socket

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"debug":111,"queue-microtask":212,"randombytes":214,"readable-stream":272,"ws":48}],258:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],259:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":261,"./_stream_writable":263,"_process":206,"dup":13,"inherits":138}],260:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":262,"dup":14,"inherits":138}],261:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":258,"./_stream_duplex":259,"./internal/streams/async_iterator":264,"./internal/streams/buffer_list":265,"./internal/streams/destroy":266,"./internal/streams/from":268,"./internal/streams/state":270,"./internal/streams/stream":271,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],262:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":258,"./_stream_duplex":259,"dup":16,"inherits":138}],263:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":258,"./_stream_duplex":259,"./internal/streams/destroy":266,"./internal/streams/state":270,"./internal/streams/stream":271,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],264:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":267,"_process":206,"dup":18}],265:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],266:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],267:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":258,"dup":21}],268:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],269:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":258,"./end-of-stream":267,"dup":23}],270:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":258,"dup":24}],271:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],272:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":259,"./lib/_stream_passthrough.js":260,"./lib/_stream_readable.js":261,"./lib/_stream_transform.js":262,"./lib/_stream_writable.js":263,"./lib/internal/streams/end-of-stream.js":267,"./lib/internal/streams/pipeline.js":269,"dup":26}],273:[function(require,module,exports){
var tick = 1
var maxTick = 65535
var resolution = 4
var timer
var inc = function () {
  tick = (tick + 1) & maxTick
}


module.exports = function (seconds) {
  if (!timer) {
    timer = setInterval(inc, (1000 / resolution) | 0)
    if (timer.unref) timer.unref()
  }

  var size = resolution * (seconds || 5)
  var buffer = [0]
  var pointer = 1
  var last = (tick - 1) & maxTick

  return function (delta) {
    var dist = (tick - last) & maxTick
    if (dist > size) dist = size
    last = tick

    while (dist--) {
      if (pointer === size) pointer = 0
      buffer[pointer] = buffer[pointer === 0 ? size - 1 : pointer - 1]
      pointer++
    }

    if (delta) buffer[pointer - 1] += delta

    var top = buffer[pointer - 1]
    var btm = buffer.length < size ? 0 : buffer[pointer === size ? 0 : pointer]

    return buffer.length < resolution ? top : (top - btm) * resolution / buffer.length
  }
}

},{}],274:[function(require,module,exports){
(function (global){(function (){
var ClientRequest = require('./lib/request')
var response = require('./lib/response')
var extend = require('xtend')
var statusCodes = require('builtin-status-codes')
var url = require('url')

var http = exports

http.request = function (opts, cb) {
	if (typeof opts === 'string')
		opts = url.parse(opts)
	else
		opts = extend(opts)

	// Normally, the page is loaded from http or https, so not specifying a protocol
	// will result in a (valid) protocol-relative url. However, this won't work if
	// the protocol is something else, like 'file:'
	var defaultProtocol = global.location.protocol.search(/^https?:$/) === -1 ? 'http:' : ''

	var protocol = opts.protocol || defaultProtocol
	var host = opts.hostname || opts.host
	var port = opts.port
	var path = opts.path || '/'

	// Necessary for IPv6 addresses
	if (host && host.indexOf(':') !== -1)
		host = '[' + host + ']'

	// This may be a relative url. The browser should always be able to interpret it correctly.
	opts.url = (host ? (protocol + '//' + host) : '') + (port ? ':' + port : '') + path
	opts.method = (opts.method || 'GET').toUpperCase()
	opts.headers = opts.headers || {}

	// Also valid opts.auth, opts.mode

	var req = new ClientRequest(opts)
	if (cb)
		req.on('response', cb)
	return req
}

http.get = function get (opts, cb) {
	var req = http.request(opts, cb)
	req.end()
	return req
}

http.ClientRequest = ClientRequest
http.IncomingMessage = response.IncomingMessage

http.Agent = function () {}
http.Agent.defaultMaxSockets = 4

http.globalAgent = new http.Agent()

http.STATUS_CODES = statusCodes

http.METHODS = [
	'CHECKOUT',
	'CONNECT',
	'COPY',
	'DELETE',
	'GET',
	'HEAD',
	'LOCK',
	'M-SEARCH',
	'MERGE',
	'MKACTIVITY',
	'MKCOL',
	'MOVE',
	'NOTIFY',
	'OPTIONS',
	'PATCH',
	'POST',
	'PROPFIND',
	'PROPPATCH',
	'PURGE',
	'PUT',
	'REPORT',
	'SEARCH',
	'SUBSCRIBE',
	'TRACE',
	'UNLOCK',
	'UNSUBSCRIBE'
]
}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./lib/request":276,"./lib/response":277,"builtin-status-codes":53,"url":309,"xtend":339}],275:[function(require,module,exports){
(function (global){(function (){
exports.fetch = isFunction(global.fetch) && isFunction(global.ReadableStream)

exports.writableStream = isFunction(global.WritableStream)

exports.abortController = isFunction(global.AbortController)

// The xhr request to example.com may violate some restrictive CSP configurations,
// so if we're running in a browser that supports `fetch`, avoid calling getXHR()
// and assume support for certain features below.
var xhr
function getXHR () {
	// Cache the xhr value
	if (xhr !== undefined) return xhr

	if (global.XMLHttpRequest) {
		xhr = new global.XMLHttpRequest()
		// If XDomainRequest is available (ie only, where xhr might not work
		// cross domain), use the page location. Otherwise use example.com
		// Note: this doesn't actually make an http request.
		try {
			xhr.open('GET', global.XDomainRequest ? '/' : 'https://example.com')
		} catch(e) {
			xhr = null
		}
	} else {
		// Service workers don't have XHR
		xhr = null
	}
	return xhr
}

function checkTypeSupport (type) {
	var xhr = getXHR()
	if (!xhr) return false
	try {
		xhr.responseType = type
		return xhr.responseType === type
	} catch (e) {}
	return false
}

// If fetch is supported, then arraybuffer will be supported too. Skip calling
// checkTypeSupport(), since that calls getXHR().
exports.arraybuffer = exports.fetch || checkTypeSupport('arraybuffer')

// These next two tests unavoidably show warnings in Chrome. Since fetch will always
// be used if it's available, just return false for these to avoid the warnings.
exports.msstream = !exports.fetch && checkTypeSupport('ms-stream')
exports.mozchunkedarraybuffer = !exports.fetch && checkTypeSupport('moz-chunked-arraybuffer')

// If fetch is supported, then overrideMimeType will be supported too. Skip calling
// getXHR().
exports.overrideMimeType = exports.fetch || (getXHR() ? isFunction(getXHR().overrideMimeType) : false)

function isFunction (value) {
	return typeof value === 'function'
}

xhr = null // Help gc

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],276:[function(require,module,exports){
(function (process,global,Buffer){(function (){
var capability = require('./capability')
var inherits = require('inherits')
var response = require('./response')
var stream = require('readable-stream')

var IncomingMessage = response.IncomingMessage
var rStates = response.readyStates

function decideMode (preferBinary, useFetch) {
	if (capability.fetch && useFetch) {
		return 'fetch'
	} else if (capability.mozchunkedarraybuffer) {
		return 'moz-chunked-arraybuffer'
	} else if (capability.msstream) {
		return 'ms-stream'
	} else if (capability.arraybuffer && preferBinary) {
		return 'arraybuffer'
	} else {
		return 'text'
	}
}

var ClientRequest = module.exports = function (opts) {
	var self = this
	stream.Writable.call(self)

	self._opts = opts
	self._body = []
	self._headers = {}
	if (opts.auth)
		self.setHeader('Authorization', 'Basic ' + Buffer.from(opts.auth).toString('base64'))
	Object.keys(opts.headers).forEach(function (name) {
		self.setHeader(name, opts.headers[name])
	})

	var preferBinary
	var useFetch = true
	if (opts.mode === 'disable-fetch' || ('requestTimeout' in opts && !capability.abortController)) {
		// If the use of XHR should be preferred. Not typically needed.
		useFetch = false
		preferBinary = true
	} else if (opts.mode === 'prefer-streaming') {
		// If streaming is a high priority but binary compatibility and
		// the accuracy of the 'content-type' header aren't
		preferBinary = false
	} else if (opts.mode === 'allow-wrong-content-type') {
		// If streaming is more important than preserving the 'content-type' header
		preferBinary = !capability.overrideMimeType
	} else if (!opts.mode || opts.mode === 'default' || opts.mode === 'prefer-fast') {
		// Use binary if text streaming may corrupt data or the content-type header, or for speed
		preferBinary = true
	} else {
		throw new Error('Invalid value for opts.mode')
	}
	self._mode = decideMode(preferBinary, useFetch)
	self._fetchTimer = null
	self._socketTimeout = null
	self._socketTimer = null

	self.on('finish', function () {
		self._onFinish()
	})
}

inherits(ClientRequest, stream.Writable)

ClientRequest.prototype.setHeader = function (name, value) {
	var self = this
	var lowerName = name.toLowerCase()
	// This check is not necessary, but it prevents warnings from browsers about setting unsafe
	// headers. To be honest I'm not entirely sure hiding these warnings is a good thing, but
	// http-browserify did it, so I will too.
	if (unsafeHeaders.indexOf(lowerName) !== -1)
		return

	self._headers[lowerName] = {
		name: name,
		value: value
	}
}

ClientRequest.prototype.getHeader = function (name) {
	var header = this._headers[name.toLowerCase()]
	if (header)
		return header.value
	return null
}

ClientRequest.prototype.removeHeader = function (name) {
	var self = this
	delete self._headers[name.toLowerCase()]
}

ClientRequest.prototype._onFinish = function () {
	var self = this

	if (self._destroyed)
		return
	var opts = self._opts

	if ('timeout' in opts && opts.timeout !== 0) {
		self.setTimeout(opts.timeout)
	}

	var headersObj = self._headers
	var body = null
	if (opts.method !== 'GET' && opts.method !== 'HEAD') {
        body = new Blob(self._body, {
            type: (headersObj['content-type'] || {}).value || ''
        });
    }

	// create flattened list of headers
	var headersList = []
	Object.keys(headersObj).forEach(function (keyName) {
		var name = headersObj[keyName].name
		var value = headersObj[keyName].value
		if (Array.isArray(value)) {
			value.forEach(function (v) {
				headersList.push([name, v])
			})
		} else {
			headersList.push([name, value])
		}
	})

	if (self._mode === 'fetch') {
		var signal = null
		if (capability.abortController) {
			var controller = new AbortController()
			signal = controller.signal
			self._fetchAbortController = controller

			if ('requestTimeout' in opts && opts.requestTimeout !== 0) {
				self._fetchTimer = global.setTimeout(function () {
					self.emit('requestTimeout')
					if (self._fetchAbortController)
						self._fetchAbortController.abort()
				}, opts.requestTimeout)
			}
		}

		global.fetch(self._opts.url, {
			method: self._opts.method,
			headers: headersList,
			body: body || undefined,
			mode: 'cors',
			credentials: opts.withCredentials ? 'include' : 'same-origin',
			signal: signal
		}).then(function (response) {
			self._fetchResponse = response
			self._resetTimers(false)
			self._connect()
		}, function (reason) {
			self._resetTimers(true)
			if (!self._destroyed)
				self.emit('error', reason)
		})
	} else {
		var xhr = self._xhr = new global.XMLHttpRequest()
		try {
			xhr.open(self._opts.method, self._opts.url, true)
		} catch (err) {
			process.nextTick(function () {
				self.emit('error', err)
			})
			return
		}

		// Can't set responseType on really old browsers
		if ('responseType' in xhr)
			xhr.responseType = self._mode

		if ('withCredentials' in xhr)
			xhr.withCredentials = !!opts.withCredentials

		if (self._mode === 'text' && 'overrideMimeType' in xhr)
			xhr.overrideMimeType('text/plain; charset=x-user-defined')

		if ('requestTimeout' in opts) {
			xhr.timeout = opts.requestTimeout
			xhr.ontimeout = function () {
				self.emit('requestTimeout')
			}
		}

		headersList.forEach(function (header) {
			xhr.setRequestHeader(header[0], header[1])
		})

		self._response = null
		xhr.onreadystatechange = function () {
			switch (xhr.readyState) {
				case rStates.LOADING:
				case rStates.DONE:
					self._onXHRProgress()
					break
			}
		}
		// Necessary for streaming in Firefox, since xhr.response is ONLY defined
		// in onprogress, not in onreadystatechange with xhr.readyState = 3
		if (self._mode === 'moz-chunked-arraybuffer') {
			xhr.onprogress = function () {
				self._onXHRProgress()
			}
		}

		xhr.onerror = function () {
			if (self._destroyed)
				return
			self._resetTimers(true)
			self.emit('error', new Error('XHR error'))
		}

		try {
			xhr.send(body)
		} catch (err) {
			process.nextTick(function () {
				self.emit('error', err)
			})
			return
		}
	}
}

/**
 * Checks if xhr.status is readable and non-zero, indicating no error.
 * Even though the spec says it should be available in readyState 3,
 * accessing it throws an exception in IE8
 */
function statusValid (xhr) {
	try {
		var status = xhr.status
		return (status !== null && status !== 0)
	} catch (e) {
		return false
	}
}

ClientRequest.prototype._onXHRProgress = function () {
	var self = this

	self._resetTimers(false)

	if (!statusValid(self._xhr) || self._destroyed)
		return

	if (!self._response)
		self._connect()

	self._response._onXHRProgress(self._resetTimers.bind(self))
}

ClientRequest.prototype._connect = function () {
	var self = this

	if (self._destroyed)
		return

	self._response = new IncomingMessage(self._xhr, self._fetchResponse, self._mode, self._resetTimers.bind(self))
	self._response.on('error', function(err) {
		self.emit('error', err)
	})

	self.emit('response', self._response)
}

ClientRequest.prototype._write = function (chunk, encoding, cb) {
	var self = this

	self._body.push(chunk)
	cb()
}

ClientRequest.prototype._resetTimers = function (done) {
	var self = this

	global.clearTimeout(self._socketTimer)
	self._socketTimer = null

	if (done) {
		global.clearTimeout(self._fetchTimer)
		self._fetchTimer = null
	} else if (self._socketTimeout) {
		self._socketTimer = global.setTimeout(function () {
			self.emit('timeout')
		}, self._socketTimeout)
	}
}

ClientRequest.prototype.abort = ClientRequest.prototype.destroy = function (err) {
	var self = this
	self._destroyed = true
	self._resetTimers(true)
	if (self._response)
		self._response._destroyed = true
	if (self._xhr)
		self._xhr.abort()
	else if (self._fetchAbortController)
		self._fetchAbortController.abort()

	if (err)
		self.emit('error', err)
}

ClientRequest.prototype.end = function (data, encoding, cb) {
	var self = this
	if (typeof data === 'function') {
		cb = data
		data = undefined
	}

	stream.Writable.prototype.end.call(self, data, encoding, cb)
}

ClientRequest.prototype.setTimeout = function (timeout, cb) {
	var self = this

	if (cb)
		self.once('timeout', cb)

	self._socketTimeout = timeout
	self._resetTimers(false)
}

ClientRequest.prototype.flushHeaders = function () {}
ClientRequest.prototype.setNoDelay = function () {}
ClientRequest.prototype.setSocketKeepAlive = function () {}

// Taken from http://www.w3.org/TR/XMLHttpRequest/#the-setrequestheader%28%29-method
var unsafeHeaders = [
	'accept-charset',
	'accept-encoding',
	'access-control-request-headers',
	'access-control-request-method',
	'connection',
	'content-length',
	'cookie',
	'cookie2',
	'date',
	'dnt',
	'expect',
	'host',
	'keep-alive',
	'origin',
	'referer',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'via'
]

}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"./capability":275,"./response":277,"_process":206,"buffer":52,"inherits":138,"readable-stream":292}],277:[function(require,module,exports){
(function (process,global,Buffer){(function (){
var capability = require('./capability')
var inherits = require('inherits')
var stream = require('readable-stream')

var rStates = exports.readyStates = {
	UNSENT: 0,
	OPENED: 1,
	HEADERS_RECEIVED: 2,
	LOADING: 3,
	DONE: 4
}

var IncomingMessage = exports.IncomingMessage = function (xhr, response, mode, resetTimers) {
	var self = this
	stream.Readable.call(self)

	self._mode = mode
	self.headers = {}
	self.rawHeaders = []
	self.trailers = {}
	self.rawTrailers = []

	// Fake the 'close' event, but only once 'end' fires
	self.on('end', function () {
		// The nextTick is necessary to prevent the 'request' module from causing an infinite loop
		process.nextTick(function () {
			self.emit('close')
		})
	})

	if (mode === 'fetch') {
		self._fetchResponse = response

		self.url = response.url
		self.statusCode = response.status
		self.statusMessage = response.statusText
		
		response.headers.forEach(function (header, key){
			self.headers[key.toLowerCase()] = header
			self.rawHeaders.push(key, header)
		})

		if (capability.writableStream) {
			var writable = new WritableStream({
				write: function (chunk) {
					resetTimers(false)
					return new Promise(function (resolve, reject) {
						if (self._destroyed) {
							reject()
						} else if(self.push(Buffer.from(chunk))) {
							resolve()
						} else {
							self._resumeFetch = resolve
						}
					})
				},
				close: function () {
					resetTimers(true)
					if (!self._destroyed)
						self.push(null)
				},
				abort: function (err) {
					resetTimers(true)
					if (!self._destroyed)
						self.emit('error', err)
				}
			})

			try {
				response.body.pipeTo(writable).catch(function (err) {
					resetTimers(true)
					if (!self._destroyed)
						self.emit('error', err)
				})
				return
			} catch (e) {} // pipeTo method isn't defined. Can't find a better way to feature test this
		}
		// fallback for when writableStream or pipeTo aren't available
		var reader = response.body.getReader()
		function read () {
			reader.read().then(function (result) {
				if (self._destroyed)
					return
				resetTimers(result.done)
				if (result.done) {
					self.push(null)
					return
				}
				self.push(Buffer.from(result.value))
				read()
			}).catch(function (err) {
				resetTimers(true)
				if (!self._destroyed)
					self.emit('error', err)
			})
		}
		read()
	} else {
		self._xhr = xhr
		self._pos = 0

		self.url = xhr.responseURL
		self.statusCode = xhr.status
		self.statusMessage = xhr.statusText
		var headers = xhr.getAllResponseHeaders().split(/\r?\n/)
		headers.forEach(function (header) {
			var matches = header.match(/^([^:]+):\s*(.*)/)
			if (matches) {
				var key = matches[1].toLowerCase()
				if (key === 'set-cookie') {
					if (self.headers[key] === undefined) {
						self.headers[key] = []
					}
					self.headers[key].push(matches[2])
				} else if (self.headers[key] !== undefined) {
					self.headers[key] += ', ' + matches[2]
				} else {
					self.headers[key] = matches[2]
				}
				self.rawHeaders.push(matches[1], matches[2])
			}
		})

		self._charset = 'x-user-defined'
		if (!capability.overrideMimeType) {
			var mimeType = self.rawHeaders['mime-type']
			if (mimeType) {
				var charsetMatch = mimeType.match(/;\s*charset=([^;])(;|$)/)
				if (charsetMatch) {
					self._charset = charsetMatch[1].toLowerCase()
				}
			}
			if (!self._charset)
				self._charset = 'utf-8' // best guess
		}
	}
}

inherits(IncomingMessage, stream.Readable)

IncomingMessage.prototype._read = function () {
	var self = this

	var resolve = self._resumeFetch
	if (resolve) {
		self._resumeFetch = null
		resolve()
	}
}

IncomingMessage.prototype._onXHRProgress = function (resetTimers) {
	var self = this

	var xhr = self._xhr

	var response = null
	switch (self._mode) {
		case 'text':
			response = xhr.responseText
			if (response.length > self._pos) {
				var newData = response.substr(self._pos)
				if (self._charset === 'x-user-defined') {
					var buffer = Buffer.alloc(newData.length)
					for (var i = 0; i < newData.length; i++)
						buffer[i] = newData.charCodeAt(i) & 0xff

					self.push(buffer)
				} else {
					self.push(newData, self._charset)
				}
				self._pos = response.length
			}
			break
		case 'arraybuffer':
			if (xhr.readyState !== rStates.DONE || !xhr.response)
				break
			response = xhr.response
			self.push(Buffer.from(new Uint8Array(response)))
			break
		case 'moz-chunked-arraybuffer': // take whole
			response = xhr.response
			if (xhr.readyState !== rStates.LOADING || !response)
				break
			self.push(Buffer.from(new Uint8Array(response)))
			break
		case 'ms-stream':
			response = xhr.response
			if (xhr.readyState !== rStates.LOADING)
				break
			var reader = new global.MSStreamReader()
			reader.onprogress = function () {
				if (reader.result.byteLength > self._pos) {
					self.push(Buffer.from(new Uint8Array(reader.result.slice(self._pos))))
					self._pos = reader.result.byteLength
				}
			}
			reader.onload = function () {
				resetTimers(true)
				self.push(null)
			}
			// reader.onerror = ??? // TODO: this
			reader.readAsArrayBuffer(response)
			break
	}

	// The ms-stream case handles end separately in reader.onload()
	if (self._xhr.readyState === rStates.DONE && self._mode !== 'ms-stream') {
		resetTimers(true)
		self.push(null)
	}
}

}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"./capability":275,"_process":206,"buffer":52,"inherits":138,"readable-stream":292}],278:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],279:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":281,"./_stream_writable":283,"_process":206,"dup":13,"inherits":138}],280:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":282,"dup":14,"inherits":138}],281:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":278,"./_stream_duplex":279,"./internal/streams/async_iterator":284,"./internal/streams/buffer_list":285,"./internal/streams/destroy":286,"./internal/streams/from":288,"./internal/streams/state":290,"./internal/streams/stream":291,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],282:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":278,"./_stream_duplex":279,"dup":16,"inherits":138}],283:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":278,"./_stream_duplex":279,"./internal/streams/destroy":286,"./internal/streams/state":290,"./internal/streams/stream":291,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],284:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":287,"_process":206,"dup":18}],285:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],286:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],287:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":278,"dup":21}],288:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],289:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":278,"./end-of-stream":287,"dup":23}],290:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":278,"dup":24}],291:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],292:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":279,"./lib/_stream_passthrough.js":280,"./lib/_stream_readable.js":281,"./lib/_stream_transform.js":282,"./lib/_stream_writable.js":283,"./lib/internal/streams/end-of-stream.js":287,"./lib/internal/streams/pipeline.js":289,"dup":26}],293:[function(require,module,exports){
/*! stream-to-blob-url. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = getBlobURL

const getBlob = require('stream-to-blob')

async function getBlobURL (stream, mimeType) {
  const blob = await getBlob(stream, mimeType)
  const url = URL.createObjectURL(blob)
  return url
}

},{"stream-to-blob":294}],294:[function(require,module,exports){
/*! stream-to-blob. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
/* global Blob */

module.exports = streamToBlob

function streamToBlob (stream, mimeType) {
  if (mimeType != null && typeof mimeType !== 'string') {
    throw new Error('Invalid mimetype, expected string.')
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    stream
      .on('data', chunk => chunks.push(chunk))
      .once('end', () => {
        const blob = mimeType != null
          ? new Blob(chunks, { type: mimeType })
          : new Blob(chunks)
        resolve(blob)
      })
      .once('error', reject)
  })
}

},{}],295:[function(require,module,exports){
(function (Buffer){(function (){
/*! stream-with-known-length-to-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
var once = require('once')

module.exports = function getBuffer (stream, length, cb) {
  cb = once(cb)
  var buf = Buffer.alloc(length)
  var offset = 0
  stream
    .on('data', function (chunk) {
      chunk.copy(buf, offset)
      offset += chunk.length
    })
    .on('end', function () { cb(null, buf) })
    .on('error', cb)
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"once":201}],296:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

/*<replacement>*/

var Buffer = require('safe-buffer').Buffer;
/*</replacement>*/

var isEncoding = Buffer.isEncoding || function (encoding) {
  encoding = '' + encoding;
  switch (encoding && encoding.toLowerCase()) {
    case 'hex':case 'utf8':case 'utf-8':case 'ascii':case 'binary':case 'base64':case 'ucs2':case 'ucs-2':case 'utf16le':case 'utf-16le':case 'raw':
      return true;
    default:
      return false;
  }
};

function _normalizeEncoding(enc) {
  if (!enc) return 'utf8';
  var retried;
  while (true) {
    switch (enc) {
      case 'utf8':
      case 'utf-8':
        return 'utf8';
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return 'utf16le';
      case 'latin1':
      case 'binary':
        return 'latin1';
      case 'base64':
      case 'ascii':
      case 'hex':
        return enc;
      default:
        if (retried) return; // undefined
        enc = ('' + enc).toLowerCase();
        retried = true;
    }
  }
};

// Do not cache `Buffer.isEncoding` when checking encoding names as some
// modules monkey-patch it to support additional encodings
function normalizeEncoding(enc) {
  var nenc = _normalizeEncoding(enc);
  if (typeof nenc !== 'string' && (Buffer.isEncoding === isEncoding || !isEncoding(enc))) throw new Error('Unknown encoding: ' + enc);
  return nenc || enc;
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters.
exports.StringDecoder = StringDecoder;
function StringDecoder(encoding) {
  this.encoding = normalizeEncoding(encoding);
  var nb;
  switch (this.encoding) {
    case 'utf16le':
      this.text = utf16Text;
      this.end = utf16End;
      nb = 4;
      break;
    case 'utf8':
      this.fillLast = utf8FillLast;
      nb = 4;
      break;
    case 'base64':
      this.text = base64Text;
      this.end = base64End;
      nb = 3;
      break;
    default:
      this.write = simpleWrite;
      this.end = simpleEnd;
      return;
  }
  this.lastNeed = 0;
  this.lastTotal = 0;
  this.lastChar = Buffer.allocUnsafe(nb);
}

StringDecoder.prototype.write = function (buf) {
  if (buf.length === 0) return '';
  var r;
  var i;
  if (this.lastNeed) {
    r = this.fillLast(buf);
    if (r === undefined) return '';
    i = this.lastNeed;
    this.lastNeed = 0;
  } else {
    i = 0;
  }
  if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
  return r || '';
};

StringDecoder.prototype.end = utf8End;

// Returns only complete characters in a Buffer
StringDecoder.prototype.text = utf8Text;

// Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
StringDecoder.prototype.fillLast = function (buf) {
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
  this.lastNeed -= buf.length;
};

// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
// continuation byte. If an invalid byte is detected, -2 is returned.
function utf8CheckByte(byte) {
  if (byte <= 0x7F) return 0;else if (byte >> 5 === 0x06) return 2;else if (byte >> 4 === 0x0E) return 3;else if (byte >> 3 === 0x1E) return 4;
  return byte >> 6 === 0x02 ? -1 : -2;
}

// Checks at most 3 bytes at the end of a Buffer in order to detect an
// incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
// needed to complete the UTF-8 character (if applicable) are returned.
function utf8CheckIncomplete(self, buf, i) {
  var j = buf.length - 1;
  if (j < i) return 0;
  var nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 1;
    return nb;
  }
  if (--j < i || nb === -2) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 2;
    return nb;
  }
  if (--j < i || nb === -2) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) {
      if (nb === 2) nb = 0;else self.lastNeed = nb - 3;
    }
    return nb;
  }
  return 0;
}

// Validates as many continuation bytes for a multi-byte UTF-8 character as
// needed or are available. If we see a non-continuation byte where we expect
// one, we "replace" the validated continuation bytes we've seen so far with
// a single UTF-8 replacement character ('\ufffd'), to match v8's UTF-8 decoding
// behavior. The continuation byte check is included three times in the case
// where all of the continuation bytes for a character exist in the same buffer.
// It is also done this way as a slight performance increase instead of using a
// loop.
function utf8CheckExtraBytes(self, buf, p) {
  if ((buf[0] & 0xC0) !== 0x80) {
    self.lastNeed = 0;
    return '\ufffd';
  }
  if (self.lastNeed > 1 && buf.length > 1) {
    if ((buf[1] & 0xC0) !== 0x80) {
      self.lastNeed = 1;
      return '\ufffd';
    }
    if (self.lastNeed > 2 && buf.length > 2) {
      if ((buf[2] & 0xC0) !== 0x80) {
        self.lastNeed = 2;
        return '\ufffd';
      }
    }
  }
}

// Attempts to complete a multi-byte UTF-8 character using bytes from a Buffer.
function utf8FillLast(buf) {
  var p = this.lastTotal - this.lastNeed;
  var r = utf8CheckExtraBytes(this, buf, p);
  if (r !== undefined) return r;
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, p, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, p, 0, buf.length);
  this.lastNeed -= buf.length;
}

// Returns all complete UTF-8 characters in a Buffer. If the Buffer ended on a
// partial character, the character's bytes are buffered until the required
// number of bytes are available.
function utf8Text(buf, i) {
  var total = utf8CheckIncomplete(this, buf, i);
  if (!this.lastNeed) return buf.toString('utf8', i);
  this.lastTotal = total;
  var end = buf.length - (total - this.lastNeed);
  buf.copy(this.lastChar, 0, end);
  return buf.toString('utf8', i, end);
}

// For UTF-8, a replacement character is added when ending on a partial
// character.
function utf8End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) return r + '\ufffd';
  return r;
}

// UTF-16LE typically needs two bytes per character, but even if we have an even
// number of bytes available, we need to check if we end on a leading/high
// surrogate. In that case, we need to wait for the next two bytes in order to
// decode the last character properly.
function utf16Text(buf, i) {
  if ((buf.length - i) % 2 === 0) {
    var r = buf.toString('utf16le', i);
    if (r) {
      var c = r.charCodeAt(r.length - 1);
      if (c >= 0xD800 && c <= 0xDBFF) {
        this.lastNeed = 2;
        this.lastTotal = 4;
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
        return r.slice(0, -1);
      }
    }
    return r;
  }
  this.lastNeed = 1;
  this.lastTotal = 2;
  this.lastChar[0] = buf[buf.length - 1];
  return buf.toString('utf16le', i, buf.length - 1);
}

// For UTF-16LE we do not explicitly append special replacement characters if we
// end on a partial character, we simply let v8 handle that.
function utf16End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) {
    var end = this.lastTotal - this.lastNeed;
    return r + this.lastChar.toString('utf16le', 0, end);
  }
  return r;
}

function base64Text(buf, i) {
  var n = (buf.length - i) % 3;
  if (n === 0) return buf.toString('base64', i);
  this.lastNeed = 3 - n;
  this.lastTotal = 3;
  if (n === 1) {
    this.lastChar[0] = buf[buf.length - 1];
  } else {
    this.lastChar[0] = buf[buf.length - 2];
    this.lastChar[1] = buf[buf.length - 1];
  }
  return buf.toString('base64', i, buf.length - n);
}

function base64End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) return r + this.lastChar.toString('base64', 0, 3 - this.lastNeed);
  return r;
}

// Pass bytes on through for single-byte encodings (e.g. ascii, latin1, hex)
function simpleWrite(buf) {
  return buf.toString(this.encoding);
}

function simpleEnd(buf) {
  return buf && buf.length ? this.write(buf) : '';
}
},{"safe-buffer":236}],297:[function(require,module,exports){
/*                                                                              
Copyright (c) 2011, Chris Umbel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in      
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN 
THE SOFTWARE.
*/

var base32 = require('./thirty-two');

exports.encode = base32.encode;
exports.decode = base32.decode;

},{"./thirty-two":298}],298:[function(require,module,exports){
(function (Buffer){(function (){
/*
Copyright (c) 2011, Chris Umbel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
'use strict';

var charTable = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var byteTable = [
    0xff, 0xff, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
    0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16,
    0x17, 0x18, 0x19, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
    0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16,
    0x17, 0x18, 0x19, 0xff, 0xff, 0xff, 0xff, 0xff
];

function quintetCount(buff) {
    var quintets = Math.floor(buff.length / 5);
    return buff.length % 5 === 0 ? quintets: quintets + 1;
}

exports.encode = function(plain) {
    if(!Buffer.isBuffer(plain)){
    	plain = new Buffer(plain);
    }
    var i = 0;
    var j = 0;
    var shiftIndex = 0;
    var digit = 0;
    var encoded = new Buffer(quintetCount(plain) * 8);

    /* byte by byte isn't as pretty as quintet by quintet but tests a bit
        faster. will have to revisit. */
    while(i < plain.length) {
        var current = plain[i];

        if(shiftIndex > 3) {
            digit = current & (0xff >> shiftIndex);
            shiftIndex = (shiftIndex + 5) % 8;
            digit = (digit << shiftIndex) | ((i + 1 < plain.length) ?
                plain[i + 1] : 0) >> (8 - shiftIndex);
            i++;
        } else {
            digit = (current >> (8 - (shiftIndex + 5))) & 0x1f;
            shiftIndex = (shiftIndex + 5) % 8;
            if(shiftIndex === 0) i++;
        }

        encoded[j] = charTable.charCodeAt(digit);
        j++;
    }

    for(i = j; i < encoded.length; i++) {
        encoded[i] = 0x3d; //'='.charCodeAt(0)
    }

    return encoded;
};

exports.decode = function(encoded) {
    var shiftIndex = 0;
    var plainDigit = 0;
    var plainChar;
    var plainPos = 0;
    if(!Buffer.isBuffer(encoded)){
    	encoded = new Buffer(encoded);
    }
    var decoded = new Buffer(Math.ceil(encoded.length * 5 / 8));

    /* byte by byte isn't as pretty as octet by octet but tests a bit
        faster. will have to revisit. */
    for(var i = 0; i < encoded.length; i++) {
    	if(encoded[i] === 0x3d){ //'='
    		break;
    	}

        var encodedByte = encoded[i] - 0x30;

        if(encodedByte < byteTable.length) {
            plainDigit = byteTable[encodedByte];

            if(shiftIndex <= 3) {
                shiftIndex = (shiftIndex + 5) % 8;

                if(shiftIndex === 0) {
                    plainChar |= plainDigit;
                    decoded[plainPos] = plainChar;
                    plainPos++;
                    plainChar = 0;
                } else {
                    plainChar |= 0xff & (plainDigit << (8 - shiftIndex));
                }
            } else {
                shiftIndex = (shiftIndex + 5) % 8;
                plainChar |= 0xff & (plainDigit >>> shiftIndex);
                decoded[plainPos] = plainChar;
                plainPos++;

                plainChar = 0xff & (plainDigit << (8 - shiftIndex));
            }
        } else {
        	throw new Error('Invalid input - it is not base32 encoded string');
        }
    }

    return decoded.slice(0, plainPos);
};

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],299:[function(require,module,exports){
module.exports = throttle;

/**
 * Returns a new function that, when invoked, invokes `func` at most once per `wait` milliseconds.
 *
 * @param {Function} func Function to wrap.
 * @param {Number} wait Number of milliseconds that must elapse between `func` invocations.
 * @return {Function} A new function that wraps the `func` function passed in.
 */

function throttle (func, wait) {
  var ctx, args, rtn, timeoutID; // caching
  var last = 0;

  return function throttled () {
    ctx = this;
    args = arguments;
    var delta = new Date() - last;
    if (!timeoutID)
      if (delta >= wait) call();
      else timeoutID = setTimeout(call, wait - delta);
    return rtn;
  };

  function call () {
    timeoutID = 0;
    last = +new Date();
    rtn = func.apply(ctx, args);
    ctx = null;
    args = null;
  }
}

},{}],300:[function(require,module,exports){
(function (process){(function (){
'use strict'

var nextTick = nextTickArgs
process.nextTick(upgrade, 42) // pass 42 and see if upgrade is called with it

module.exports = thunky

function thunky (fn) {
  var state = run
  return thunk

  function thunk (callback) {
    state(callback || noop)
  }

  function run (callback) {
    var stack = [callback]
    state = wait
    fn(done)

    function wait (callback) {
      stack.push(callback)
    }

    function done (err) {
      var args = arguments
      state = isError(err) ? run : finished
      while (stack.length) finished(stack.shift())

      function finished (callback) {
        nextTick(apply, callback, args)
      }
    }
  }
}

function isError (err) { // inlined from util so this works in the browser
  return Object.prototype.toString.call(err) === '[object Error]'
}

function noop () {}

function apply (callback, args) {
  callback.apply(null, args)
}

function upgrade (val) {
  if (val === 42) nextTick = process.nextTick
}

function nextTickArgs (fn, a, b) {
  process.nextTick(function () {
    fn(a, b)
  })
}

}).call(this)}).call(this,require('_process'))
},{"_process":206}],301:[function(require,module,exports){
(function (setImmediate,clearImmediate){(function (){
var nextTick = require('process/browser.js').nextTick;
var apply = Function.prototype.apply;
var slice = Array.prototype.slice;
var immediateIds = {};
var nextImmediateId = 0;

// DOM APIs, for completeness

exports.setTimeout = function() {
  return new Timeout(apply.call(setTimeout, window, arguments), clearTimeout);
};
exports.setInterval = function() {
  return new Timeout(apply.call(setInterval, window, arguments), clearInterval);
};
exports.clearTimeout =
exports.clearInterval = function(timeout) { timeout.close(); };

function Timeout(id, clearFn) {
  this._id = id;
  this._clearFn = clearFn;
}
Timeout.prototype.unref = Timeout.prototype.ref = function() {};
Timeout.prototype.close = function() {
  this._clearFn.call(window, this._id);
};

// Does not start the time, just sets up the members needed.
exports.enroll = function(item, msecs) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = msecs;
};

exports.unenroll = function(item) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = -1;
};

exports._unrefActive = exports.active = function(item) {
  clearTimeout(item._idleTimeoutId);

  var msecs = item._idleTimeout;
  if (msecs >= 0) {
    item._idleTimeoutId = setTimeout(function onTimeout() {
      if (item._onTimeout)
        item._onTimeout();
    }, msecs);
  }
};

// That's not how node.js implements it but the exposed api is the same.
exports.setImmediate = typeof setImmediate === "function" ? setImmediate : function(fn) {
  var id = nextImmediateId++;
  var args = arguments.length < 2 ? false : slice.call(arguments, 1);

  immediateIds[id] = true;

  nextTick(function onNextTick() {
    if (immediateIds[id]) {
      // fn.call() is faster so we optimize for the common use-case
      // @see http://jsperf.com/call-apply-segu
      if (args) {
        fn.apply(null, args);
      } else {
        fn.call(null);
      }
      // Prevent ids from leaking
      exports.clearImmediate(id);
    }
  });

  return id;
};

exports.clearImmediate = typeof clearImmediate === "function" ? clearImmediate : function(id) {
  delete immediateIds[id];
};
}).call(this)}).call(this,require("timers").setImmediate,require("timers").clearImmediate)
},{"process/browser.js":206,"timers":301}],302:[function(require,module,exports){
var Buffer = require('buffer').Buffer

module.exports = function (buf) {
	// If the buffer is backed by a Uint8Array, a faster version will work
	if (buf instanceof Uint8Array) {
		// If the buffer isn't a subarray, return the underlying ArrayBuffer
		if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
			return buf.buffer
		} else if (typeof buf.buffer.slice === 'function') {
			// Otherwise we need to get a proper copy
			return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
		}
	}

	if (Buffer.isBuffer(buf)) {
		// This is the slow version that will work with any Buffer
		// implementation (even in old browsers)
		var arrayCopy = new Uint8Array(buf.length)
		var len = buf.length
		for (var i = 0; i < len; i++) {
			arrayCopy[i] = buf[i]
		}
		return arrayCopy.buffer
	} else {
		throw new Error('Argument must be a Buffer')
	}
}

},{"buffer":52}],303:[function(require,module,exports){
(function (process){(function (){
/*! torrent-discovery. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
const debug = require('debug')('torrent-discovery')
const DHT = require('bittorrent-dht/client') // empty object in browser
const EventEmitter = require('events').EventEmitter
const parallel = require('run-parallel')
const Tracker = require('bittorrent-tracker/client')
const LSD = require('bittorrent-lsd')

class Discovery extends EventEmitter {
  constructor (opts) {
    super()

    if (!opts.peerId) throw new Error('Option `peerId` is required')
    if (!opts.infoHash) throw new Error('Option `infoHash` is required')
    if (!process.browser && !opts.port) throw new Error('Option `port` is required')

    this.peerId = typeof opts.peerId === 'string'
      ? opts.peerId
      : opts.peerId.toString('hex')
    this.infoHash = typeof opts.infoHash === 'string'
      ? opts.infoHash.toLowerCase()
      : opts.infoHash.toString('hex')
    this._port = opts.port // torrent port
    this._userAgent = opts.userAgent // User-Agent header for http requests

    this.destroyed = false

    this._announce = opts.announce || []
    this._intervalMs = opts.intervalMs || (15 * 60 * 1000)
    this._trackerOpts = null
    this._dhtAnnouncing = false
    this._dhtTimeout = false
    this._internalDHT = false // is the DHT created internally?

    this._onWarning = err => {
      this.emit('warning', err)
    }
    this._onError = err => {
      this.emit('error', err)
    }
    this._onDHTPeer = (peer, infoHash) => {
      if (infoHash.toString('hex') !== this.infoHash) return
      this.emit('peer', `${peer.host}:${peer.port}`, 'dht')
    }
    this._onTrackerPeer = peer => {
      this.emit('peer', peer, 'tracker')
    }
    this._onTrackerAnnounce = () => {
      this.emit('trackerAnnounce')
    }
    this._onLSDPeer = (peer, infoHash) => {
      this.emit('peer', peer, 'lsd')
    }

    const createDHT = (port, opts) => {
      const dht = new DHT(opts)
      dht.on('warning', this._onWarning)
      dht.on('error', this._onError)
      dht.listen(port)
      this._internalDHT = true
      return dht
    }

    if (opts.tracker === false) {
      this.tracker = null
    } else if (opts.tracker && typeof opts.tracker === 'object') {
      this._trackerOpts = Object.assign({}, opts.tracker)
      this.tracker = this._createTracker()
    } else {
      this.tracker = this._createTracker()
    }

    if (opts.dht === false || typeof DHT !== 'function') {
      this.dht = null
    } else if (opts.dht && typeof opts.dht.addNode === 'function') {
      this.dht = opts.dht
    } else if (opts.dht && typeof opts.dht === 'object') {
      this.dht = createDHT(opts.dhtPort, opts.dht)
    } else {
      this.dht = createDHT(opts.dhtPort)
    }

    if (this.dht) {
      this.dht.on('peer', this._onDHTPeer)
      this._dhtAnnounce()
    }

    if (opts.lsd === false || typeof LSD !== 'function') {
      this.lsd = null
    } else {
      this.lsd = this._createLSD()
    }
  }

  updatePort (port) {
    if (port === this._port) return
    this._port = port

    if (this.dht) this._dhtAnnounce()

    if (this.tracker) {
      this.tracker.stop()
      this.tracker.destroy(() => {
        this.tracker = this._createTracker()
      })
    }
  }

  complete (opts) {
    if (this.tracker) {
      this.tracker.complete(opts)
    }
  }

  destroy (cb) {
    if (this.destroyed) return
    this.destroyed = true

    clearTimeout(this._dhtTimeout)

    const tasks = []

    if (this.tracker) {
      this.tracker.stop()
      this.tracker.removeListener('warning', this._onWarning)
      this.tracker.removeListener('error', this._onError)
      this.tracker.removeListener('peer', this._onTrackerPeer)
      this.tracker.removeListener('update', this._onTrackerAnnounce)
      tasks.push(cb => {
        this.tracker.destroy(cb)
      })
    }

    if (this.dht) {
      this.dht.removeListener('peer', this._onDHTPeer)
    }

    if (this._internalDHT) {
      this.dht.removeListener('warning', this._onWarning)
      this.dht.removeListener('error', this._onError)
      tasks.push(cb => {
        this.dht.destroy(cb)
      })
    }

    if (this.lsd) {
      this.lsd.removeListener('warning', this._onWarning)
      this.lsd.removeListener('error', this._onError)
      this.lsd.removeListener('peer', this._onLSDPeer)
      tasks.push(cb => {
        this.lsd.destroy(cb)
      })
    }

    parallel(tasks, cb)

    // cleanup
    this.dht = null
    this.tracker = null
    this.lsd = null
    this._announce = null
  }

  _createTracker () {
    const opts = Object.assign({}, this._trackerOpts, {
      infoHash: this.infoHash,
      announce: this._announce,
      peerId: this.peerId,
      port: this._port,
      userAgent: this._userAgent
    })

    const tracker = new Tracker(opts)
    tracker.on('warning', this._onWarning)
    tracker.on('error', this._onError)
    tracker.on('peer', this._onTrackerPeer)
    tracker.on('update', this._onTrackerAnnounce)
    tracker.setInterval(this._intervalMs)
    tracker.start()
    return tracker
  }

  _dhtAnnounce () {
    if (this._dhtAnnouncing) return
    debug('dht announce')

    this._dhtAnnouncing = true
    clearTimeout(this._dhtTimeout)

    this.dht.announce(this.infoHash, this._port, err => {
      this._dhtAnnouncing = false
      debug('dht announce complete')

      if (err) this.emit('warning', err)
      this.emit('dhtAnnounce')

      if (!this.destroyed) {
        this._dhtTimeout = setTimeout(() => {
          this._dhtAnnounce()
        }, this._intervalMs + Math.floor(Math.random() * this._intervalMs / 5))
        if (this._dhtTimeout.unref) this._dhtTimeout.unref()
      }
    })
  }

  _createLSD () {
    const opts = Object.assign({}, {
      infoHash: this.infoHash,
      peerId: this.peerId,
      port: this._port
    })

    const lsd = new LSD(opts)
    lsd.on('warning', this._onWarning)
    lsd.on('error', this._onError)
    lsd.on('peer', this._onLSDPeer)
    lsd.start()
    return lsd
  }
}

module.exports = Discovery

}).call(this)}).call(this,require('_process'))
},{"_process":206,"bittorrent-dht/client":48,"bittorrent-lsd":48,"bittorrent-tracker/client":27,"debug":111,"events":117,"run-parallel":234}],304:[function(require,module,exports){
(function (Buffer){(function (){
/*! torrent-piece. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
const BLOCK_LENGTH = 1 << 14

class Piece {
  constructor (length) {
    this.length = length
    this.missing = length
    this.sources = null

    this._chunks = Math.ceil(length / BLOCK_LENGTH)
    this._remainder = (length % BLOCK_LENGTH) || BLOCK_LENGTH
    this._buffered = 0
    this._buffer = null
    this._cancellations = null
    this._reservations = 0
    this._flushed = false
  }

  chunkLength (i) {
    return i === this._chunks - 1 ? this._remainder : BLOCK_LENGTH
  }

  chunkLengthRemaining (i) {
    return this.length - (i * BLOCK_LENGTH)
  }

  chunkOffset (i) {
    return i * BLOCK_LENGTH
  }

  reserve () {
    if (!this.init()) return -1
    if (this._cancellations.length) return this._cancellations.pop()
    if (this._reservations < this._chunks) return this._reservations++
    return -1
  }

  reserveRemaining () {
    if (!this.init()) return -1
    if (this._cancellations.length || this._reservations < this._chunks) {
      let min = this._reservations
      while (this._cancellations.length) {
        min = Math.min(min, this._cancellations.pop())
      }
      this._reservations = this._chunks
      return min
    }
    return -1
  }

  cancel (i) {
    if (!this.init()) return
    this._cancellations.push(i)
  }

  cancelRemaining (i) {
    if (!this.init()) return
    this._reservations = i
  }

  get (i) {
    if (!this.init()) return null
    return this._buffer[i]
  }

  set (i, data, source) {
    if (!this.init()) return false
    const len = data.length
    const blocks = Math.ceil(len / BLOCK_LENGTH)
    for (let j = 0; j < blocks; j++) {
      if (!this._buffer[i + j]) {
        const offset = j * BLOCK_LENGTH
        const splitData = data.slice(offset, offset + BLOCK_LENGTH)
        this._buffered++
        this._buffer[i + j] = splitData
        this.missing -= splitData.length
        if (!this.sources.includes(source)) {
          this.sources.push(source)
        }
      }
    }
    return this._buffered === this._chunks
  }

  flush () {
    if (!this._buffer || this._chunks !== this._buffered) return null
    const buffer = Buffer.concat(this._buffer, this.length)
    this._buffer = null
    this._cancellations = null
    this.sources = null
    this._flushed = true
    return buffer
  }

  init () {
    if (this._flushed) return false
    if (this._buffer) return true
    this._buffer = new Array(this._chunks)
    this._cancellations = []
    this.sources = []
    return true
  }
}

Object.defineProperty(Piece, 'BLOCK_LENGTH', { value: BLOCK_LENGTH })

module.exports = Piece

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52}],305:[function(require,module,exports){
(function (Buffer){(function (){
/**
 * Convert a typed array to a Buffer without a copy
 *
 * Author:   Feross Aboukhadijeh <https://feross.org>
 * License:  MIT
 *
 * `npm install typedarray-to-buffer`
 */

var isTypedArray = require('is-typedarray').strict

module.exports = function typedarrayToBuffer (arr) {
  if (isTypedArray(arr)) {
    // To avoid a copy, use the typed array's underlying ArrayBuffer to back new Buffer
    var buf = Buffer.from(arr.buffer)
    if (arr.byteLength !== arr.buffer.byteLength) {
      // Respect the "view", i.e. byteOffset and byteLength, without doing a copy
      buf = buf.slice(arr.byteOffset, arr.byteOffset + arr.byteLength)
    }
    return buf
  } else {
    // Pass through all other types to `Buffer.from`
    return Buffer.from(arr)
  }
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":52,"is-typedarray":140}],306:[function(require,module,exports){
var bufferAlloc = require('buffer-alloc')

var UINT_32_MAX = Math.pow(2, 32)

exports.encodingLength = function () {
  return 8
}

exports.encode = function (num, buf, offset) {
  if (!buf) buf = bufferAlloc(8)
  if (!offset) offset = 0

  var top = Math.floor(num / UINT_32_MAX)
  var rem = num - top * UINT_32_MAX

  buf.writeUInt32BE(top, offset)
  buf.writeUInt32BE(rem, offset + 4)
  return buf
}

exports.decode = function (buf, offset) {
  if (!offset) offset = 0

  var top = buf.readUInt32BE(offset)
  var rem = buf.readUInt32BE(offset + 4)

  return top * UINT_32_MAX + rem
}

exports.encode.bytes = 8
exports.decode.bytes = 8

},{"buffer-alloc":50}],307:[function(require,module,exports){
module.exports = remove

function remove (arr, i) {
  if (i >= arr.length || i < 0) return
  var last = arr.pop()
  if (i < arr.length) {
    var tmp = arr[i]
    arr[i] = last
    return tmp
  }
  return last
}

},{}],308:[function(require,module,exports){
module.exports = function (elem, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (typeof opts === 'string') opts = { type: opts };
    
    elem.addEventListener('change', function (ev) {
        if (elem.files.length === 0) return cb(null, []);
        
        var reader = new FileReader;
        var index = 0;
        var results = [];
        
        reader.addEventListener('load', function (e) {
            results.push({
                file: elem.files[index],
                target: e.target
            });
            index ++;
            if (index === elem.files.length) cb(null, results)
            else read(index)
        });
        read(index);
        
        function read (index) {
            var file = elem.files[index];
            if (opts.type === 'text') {
                reader.readAsText(file);
            }
            else if (opts.type === 'url') {
                reader.readAsDataURL(file);
            }
            else reader.readAsArrayBuffer(file);
        }
    });
};

},{}],309:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var punycode = require('punycode');
var util = require('./util');

exports.parse = urlParse;
exports.resolve = urlResolve;
exports.resolveObject = urlResolveObject;
exports.format = urlFormat;

exports.Url = Url;

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
var protocolPattern = /^([a-z0-9.+-]+:)/i,
    portPattern = /:[0-9]*$/,

    // Special case for a simple path URL
    simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,

    // RFC 2396: characters reserved for delimiting URLs.
    // We actually just auto-escape these.
    delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

    // RFC 2396: characters not allowed for various reasons.
    unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

    // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
    autoEscape = ['\''].concat(unwise),
    // Characters that are never ever allowed in a hostname.
    // Note that any invalid chars are also handled, but these
    // are the ones that are *expected* to be seen, so we fast-path
    // them.
    nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
    hostEndingChars = ['/', '?', '#'],
    hostnameMaxLen = 255,
    hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/,
    hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/,
    // protocols that can allow "unsafe" and "unwise" chars.
    unsafeProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that never have a hostname.
    hostlessProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that always contain a // bit.
    slashedProtocol = {
      'http': true,
      'https': true,
      'ftp': true,
      'gopher': true,
      'file': true,
      'http:': true,
      'https:': true,
      'ftp:': true,
      'gopher:': true,
      'file:': true
    },
    querystring = require('querystring');

function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url && util.isObject(url) && url instanceof Url) return url;

  var u = new Url;
  u.parse(url, parseQueryString, slashesDenoteHost);
  return u;
}

Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
  if (!util.isString(url)) {
    throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
  }

  // Copy chrome, IE, opera backslash-handling behavior.
  // Back slashes before the query string get converted to forward slashes
  // See: https://code.google.com/p/chromium/issues/detail?id=25916
  var queryIndex = url.indexOf('?'),
      splitter =
          (queryIndex !== -1 && queryIndex < url.indexOf('#')) ? '?' : '#',
      uSplit = url.split(splitter),
      slashRegex = /\\/g;
  uSplit[0] = uSplit[0].replace(slashRegex, '/');
  url = uSplit.join(splitter);

  var rest = url;

  // trim before proceeding.
  // This is to support parse stuff like "  http://foo.com  \n"
  rest = rest.trim();

  if (!slashesDenoteHost && url.split('#').length === 1) {
    // Try fast path regexp
    var simplePath = simplePathPattern.exec(rest);
    if (simplePath) {
      this.path = rest;
      this.href = rest;
      this.pathname = simplePath[1];
      if (simplePath[2]) {
        this.search = simplePath[2];
        if (parseQueryString) {
          this.query = querystring.parse(this.search.substr(1));
        } else {
          this.query = this.search.substr(1);
        }
      } else if (parseQueryString) {
        this.search = '';
        this.query = {};
      }
      return this;
    }
  }

  var proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    this.protocol = lowerProto;
    rest = rest.substr(proto.length);
  }

  // figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
    var slashes = rest.substr(0, 2) === '//';
    if (slashes && !(proto && hostlessProtocol[proto])) {
      rest = rest.substr(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol[proto] &&
      (slashes || (proto && !slashedProtocol[proto]))) {

    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the last @ sign, unless some host-ending character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:c path:/?@c

    // v0.12 TODO(isaacs): This is not quite how Chrome does things.
    // Review our test case against browsers more comprehensively.

    // find the first instance of any hostEndingChars
    var hostEnd = -1;
    for (var i = 0; i < hostEndingChars.length; i++) {
      var hec = rest.indexOf(hostEndingChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }

    // at this point, either we have an explicit point where the
    // auth portion cannot go past, or the last @ char is the decider.
    var auth, atSign;
    if (hostEnd === -1) {
      // atSign can be anywhere.
      atSign = rest.lastIndexOf('@');
    } else {
      // atSign must be in auth portion.
      // http://a@b/c@d => host:b auth:a path:/c@d
      atSign = rest.lastIndexOf('@', hostEnd);
    }

    // Now we have a portion which is definitely the auth.
    // Pull that off.
    if (atSign !== -1) {
      auth = rest.slice(0, atSign);
      rest = rest.slice(atSign + 1);
      this.auth = decodeURIComponent(auth);
    }

    // the host is the remaining to the left of the first non-host char
    hostEnd = -1;
    for (var i = 0; i < nonHostChars.length; i++) {
      var hec = rest.indexOf(nonHostChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }
    // if we still have not hit it, then the entire thing is a host.
    if (hostEnd === -1)
      hostEnd = rest.length;

    this.host = rest.slice(0, hostEnd);
    rest = rest.slice(hostEnd);

    // pull out port.
    this.parseHost();

    // we've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    this.hostname = this.hostname || '';

    // if hostname begins with [ and ends with ]
    // assume that it's an IPv6 address.
    var ipv6Hostname = this.hostname[0] === '[' &&
        this.hostname[this.hostname.length - 1] === ']';

    // validate a little.
    if (!ipv6Hostname) {
      var hostparts = this.hostname.split(/\./);
      for (var i = 0, l = hostparts.length; i < l; i++) {
        var part = hostparts[i];
        if (!part) continue;
        if (!part.match(hostnamePartPattern)) {
          var newpart = '';
          for (var j = 0, k = part.length; j < k; j++) {
            if (part.charCodeAt(j) > 127) {
              // we replace non-ASCII char with a temporary placeholder
              // we need this to make sure size of hostname is not
              // broken by replacing non-ASCII by nothing
              newpart += 'x';
            } else {
              newpart += part[j];
            }
          }
          // we test again with ASCII char only
          if (!newpart.match(hostnamePartPattern)) {
            var validParts = hostparts.slice(0, i);
            var notHost = hostparts.slice(i + 1);
            var bit = part.match(hostnamePartStart);
            if (bit) {
              validParts.push(bit[1]);
              notHost.unshift(bit[2]);
            }
            if (notHost.length) {
              rest = '/' + notHost.join('.') + rest;
            }
            this.hostname = validParts.join('.');
            break;
          }
        }
      }
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = '';
    } else {
      // hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (!ipv6Hostname) {
      // IDNA Support: Returns a punycoded representation of "domain".
      // It only converts parts of the domain name that
      // have non-ASCII characters, i.e. it doesn't matter if
      // you call it with a domain that already is ASCII-only.
      this.hostname = punycode.toASCII(this.hostname);
    }

    var p = this.port ? ':' + this.port : '';
    var h = this.hostname || '';
    this.host = h + p;
    this.href += this.host;

    // strip [ and ] from the hostname
    // the host field still retains them, though
    if (ipv6Hostname) {
      this.hostname = this.hostname.substr(1, this.hostname.length - 2);
      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  // now rest is set to the post-host stuff.
  // chop off any delim chars.
  if (!unsafeProtocol[lowerProto]) {

    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    for (var i = 0, l = autoEscape.length; i < l; i++) {
      var ae = autoEscape[i];
      if (rest.indexOf(ae) === -1)
        continue;
      var esc = encodeURIComponent(ae);
      if (esc === ae) {
        esc = escape(ae);
      }
      rest = rest.split(ae).join(esc);
    }
  }


  // chop off from the tail first.
  var hash = rest.indexOf('#');
  if (hash !== -1) {
    // got a fragment string.
    this.hash = rest.substr(hash);
    rest = rest.slice(0, hash);
  }
  var qm = rest.indexOf('?');
  if (qm !== -1) {
    this.search = rest.substr(qm);
    this.query = rest.substr(qm + 1);
    if (parseQueryString) {
      this.query = querystring.parse(this.query);
    }
    rest = rest.slice(0, qm);
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    this.search = '';
    this.query = {};
  }
  if (rest) this.pathname = rest;
  if (slashedProtocol[lowerProto] &&
      this.hostname && !this.pathname) {
    this.pathname = '/';
  }

  //to support http.request
  if (this.pathname || this.search) {
    var p = this.pathname || '';
    var s = this.search || '';
    this.path = p + s;
  }

  // finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

// format a parsed object into a url string
function urlFormat(obj) {
  // ensure it's an object, and not a string url.
  // If it's an obj, this is a no-op.
  // this way, you can call url_format() on strings
  // to clean up potentially wonky urls.
  if (util.isString(obj)) obj = urlParse(obj);
  if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
  return obj.format();
}

Url.prototype.format = function() {
  var auth = this.auth || '';
  if (auth) {
    auth = encodeURIComponent(auth);
    auth = auth.replace(/%3A/i, ':');
    auth += '@';
  }

  var protocol = this.protocol || '',
      pathname = this.pathname || '',
      hash = this.hash || '',
      host = false,
      query = '';

  if (this.host) {
    host = auth + this.host;
  } else if (this.hostname) {
    host = auth + (this.hostname.indexOf(':') === -1 ?
        this.hostname :
        '[' + this.hostname + ']');
    if (this.port) {
      host += ':' + this.port;
    }
  }

  if (this.query &&
      util.isObject(this.query) &&
      Object.keys(this.query).length) {
    query = querystring.stringify(this.query);
  }

  var search = this.search || (query && ('?' + query)) || '';

  if (protocol && protocol.substr(-1) !== ':') protocol += ':';

  // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (this.slashes ||
      (!protocol || slashedProtocol[protocol]) && host !== false) {
    host = '//' + (host || '');
    if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
  } else if (!host) {
    host = '';
  }

  if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
  if (search && search.charAt(0) !== '?') search = '?' + search;

  pathname = pathname.replace(/[?#]/g, function(match) {
    return encodeURIComponent(match);
  });
  search = search.replace('#', '%23');

  return protocol + host + pathname + search + hash;
};

function urlResolve(source, relative) {
  return urlParse(source, false, true).resolve(relative);
}

Url.prototype.resolve = function(relative) {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

function urlResolveObject(source, relative) {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}

Url.prototype.resolveObject = function(relative) {
  if (util.isString(relative)) {
    var rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  var result = new Url();
  var tkeys = Object.keys(this);
  for (var tk = 0; tk < tkeys.length; tk++) {
    var tkey = tkeys[tk];
    result[tkey] = this[tkey];
  }

  // hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;

  // if the relative url is empty, then there's nothing left to do here.
  if (relative.href === '') {
    result.href = result.format();
    return result;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // take everything except the protocol from relative
    var rkeys = Object.keys(relative);
    for (var rk = 0; rk < rkeys.length; rk++) {
      var rkey = rkeys[rk];
      if (rkey !== 'protocol')
        result[rkey] = relative[rkey];
    }

    //urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[result.protocol] &&
        result.hostname && !result.pathname) {
      result.path = result.pathname = '/';
    }

    result.href = result.format();
    return result;
  }

  if (relative.protocol && relative.protocol !== result.protocol) {
    // if it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol[relative.protocol]) {
      var keys = Object.keys(relative);
      for (var v = 0; v < keys.length; v++) {
        var k = keys[v];
        result[k] = relative[k];
      }
      result.href = result.format();
      return result;
    }

    result.protocol = relative.protocol;
    if (!relative.host && !hostlessProtocol[relative.protocol]) {
      var relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      result.pathname = relPath.join('/');
    } else {
      result.pathname = relative.pathname;
    }
    result.search = relative.search;
    result.query = relative.query;
    result.host = relative.host || '';
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result.port = relative.port;
    // to support http.request
    if (result.pathname || result.search) {
      var p = result.pathname || '';
      var s = result.search || '';
      result.path = p + s;
    }
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  }

  var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
      isRelAbs = (
          relative.host ||
          relative.pathname && relative.pathname.charAt(0) === '/'
      ),
      mustEndAbs = (isRelAbs || isSourceAbs ||
                    (result.host && relative.pathname)),
      removeAllDots = mustEndAbs,
      srcPath = result.pathname && result.pathname.split('/') || [],
      relPath = relative.pathname && relative.pathname.split('/') || [],
      psychotic = result.protocol && !slashedProtocol[result.protocol];

  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {
    result.hostname = '';
    result.port = null;
    if (result.host) {
      if (srcPath[0] === '') srcPath[0] = result.host;
      else srcPath.unshift(result.host);
    }
    result.host = '';
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      relative.host = null;
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }

  if (isRelAbs) {
    // it's absolute.
    result.host = (relative.host || relative.host === '') ?
                  relative.host : result.host;
    result.hostname = (relative.hostname || relative.hostname === '') ?
                      relative.hostname : result.hostname;
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else if (!util.isNullOrUndefined(relative.search)) {
    // just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      result.hostname = result.host = srcPath.shift();
      //occationaly the auth can get stuck only in host
      //this especially happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      var authInHost = result.host && result.host.indexOf('@') > 0 ?
                       result.host.split('@') : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result.query = relative.query;
    //to support http.request
    if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
      result.path = (result.pathname ? result.pathname : '') +
                    (result.search ? result.search : '');
    }
    result.href = result.format();
    return result;
  }

  if (!srcPath.length) {
    // no path at all.  easy.
    // we've already handled the other stuff above.
    result.pathname = null;
    //to support http.request
    if (result.search) {
      result.path = '/' + result.search;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash = (
      (result.host || relative.host || srcPath.length > 1) &&
      (last === '.' || last === '..') || last === '');

  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last === '.') {
      srcPath.splice(i, 1);
    } else if (last === '..') {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift('..');
    }
  }

  if (mustEndAbs && srcPath[0] !== '' &&
      (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
    srcPath.unshift('');
  }

  if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
    srcPath.push('');
  }

  var isAbsolute = srcPath[0] === '' ||
      (srcPath[0] && srcPath[0].charAt(0) === '/');

  // put the host back
  if (psychotic) {
    result.hostname = result.host = isAbsolute ? '' :
                                    srcPath.length ? srcPath.shift() : '';
    //occationaly the auth can get stuck only in host
    //this especially happens in cases like
    //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    var authInHost = result.host && result.host.indexOf('@') > 0 ?
                     result.host.split('@') : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }

  mustEndAbs = mustEndAbs || (result.host && srcPath.length);

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift('');
  }

  if (!srcPath.length) {
    result.pathname = null;
    result.path = null;
  } else {
    result.pathname = srcPath.join('/');
  }

  //to support request.http
  if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
    result.path = (result.pathname ? result.pathname : '') +
                  (result.search ? result.search : '');
  }
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result.href = result.format();
  return result;
};

Url.prototype.parseHost = function() {
  var host = this.host;
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    if (port !== ':') {
      this.port = port.substr(1);
    }
    host = host.substr(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

},{"./util":310,"punycode":208,"querystring":211}],310:[function(require,module,exports){
'use strict';

module.exports = {
  isString: function(arg) {
    return typeof(arg) === 'string';
  },
  isObject: function(arg) {
    return typeof(arg) === 'object' && arg !== null;
  },
  isNull: function(arg) {
    return arg === null;
  },
  isNullOrUndefined: function(arg) {
    return arg == null;
  }
};

},{}],311:[function(require,module,exports){
(function (Buffer){(function (){
/*! ut_metadata. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
const { EventEmitter } = require('events')
const bencode = require('bencode')
const BitField = require('bitfield').default
const debug = require('debug')('ut_metadata')
const sha1 = require('simple-sha1')

const MAX_METADATA_SIZE = 1E7 // 10 MB
const BITFIELD_GROW = 1E3
const PIECE_LENGTH = 1 << 14 // 16 KiB

module.exports = metadata => {
  class utMetadata extends EventEmitter {
    constructor (wire) {
      super()

      this._wire = wire

      this._fetching = false
      this._metadataComplete = false
      this._metadataSize = null
      // how many reject messages to tolerate before quitting
      this._remainingRejects = null

      // The largest torrent file that I know of is ~1-2MB, which is ~100
      // pieces. Therefore, cap the bitfield to 10x that (1000 pieces) so a
      // malicious peer can't make it grow to fill all memory.
      this._bitfield = new BitField(0, { grow: BITFIELD_GROW })

      if (Buffer.isBuffer(metadata)) {
        this.setMetadata(metadata)
      }
    }

    onHandshake (infoHash, peerId, extensions) {
      this._infoHash = infoHash
    }

    onExtendedHandshake (handshake) {
      if (!handshake.m || !handshake.m.ut_metadata) {
        return this.emit('warning', new Error('Peer does not support ut_metadata'))
      }
      if (!handshake.metadata_size) {
        return this.emit('warning', new Error('Peer does not have metadata'))
      }
      if (typeof handshake.metadata_size !== 'number' ||
          MAX_METADATA_SIZE < handshake.metadata_size ||
          handshake.metadata_size <= 0) {
        return this.emit('warning', new Error('Peer gave invalid metadata size'))
      }

      this._metadataSize = handshake.metadata_size
      this._numPieces = Math.ceil(this._metadataSize / PIECE_LENGTH)
      this._remainingRejects = this._numPieces * 2

      this._requestPieces()
    }

    onMessage (buf) {
      let dict
      let trailer
      try {
        const str = buf.toString()
        const trailerIndex = str.indexOf('ee') + 2
        dict = bencode.decode(str.substring(0, trailerIndex))
        trailer = buf.slice(trailerIndex)
      } catch (err) {
        // drop invalid messages
        return
      }

      switch (dict.msg_type) {
        case 0:
          // ut_metadata request (from peer)
          // example: { 'msg_type': 0, 'piece': 0 }
          this._onRequest(dict.piece)
          break
        case 1:
          // ut_metadata data (in response to our request)
          // example: { 'msg_type': 1, 'piece': 0, 'total_size': 3425 }
          this._onData(dict.piece, trailer, dict.total_size)
          break
        case 2:
          // ut_metadata reject (peer doesn't have piece we requested)
          // { 'msg_type': 2, 'piece': 0 }
          this._onReject(dict.piece)
          break
      }
    }

    /**
     * Ask the peer to send metadata.
     * @public
     */
    fetch () {
      if (this._metadataComplete) {
        return
      }
      this._fetching = true
      if (this._metadataSize) {
        this._requestPieces()
      }
    }

    /**
     * Stop asking the peer to send metadata.
     * @public
     */
    cancel () {
      this._fetching = false
    }

    setMetadata (metadata) {
      if (this._metadataComplete) return true
      debug('set metadata')

      // if full torrent dictionary was passed in, pull out just `info` key
      try {
        const info = bencode.decode(metadata).info
        if (info) {
          metadata = bencode.encode(info)
        }
      } catch (err) {}

      // check hash
      if (this._infoHash && this._infoHash !== sha1.sync(metadata)) {
        return false
      }

      this.cancel()

      this.metadata = metadata
      this._metadataComplete = true
      this._metadataSize = this.metadata.length
      this._wire.extendedHandshake.metadata_size = this._metadataSize

      this.emit('metadata', bencode.encode({
        info: bencode.decode(this.metadata)
      }))

      return true
    }

    _send (dict, trailer) {
      let buf = bencode.encode(dict)
      if (Buffer.isBuffer(trailer)) {
        buf = Buffer.concat([buf, trailer])
      }
      this._wire.extended('ut_metadata', buf)
    }

    _request (piece) {
      this._send({ msg_type: 0, piece })
    }

    _data (piece, buf, totalSize) {
      const msg = { msg_type: 1, piece }
      if (typeof totalSize === 'number') {
        msg.total_size = totalSize
      }
      this._send(msg, buf)
    }

    _reject (piece) {
      this._send({ msg_type: 2, piece })
    }

    _onRequest (piece) {
      if (!this._metadataComplete) {
        this._reject(piece)
        return
      }
      const start = piece * PIECE_LENGTH
      let end = start + PIECE_LENGTH
      if (end > this._metadataSize) {
        end = this._metadataSize
      }
      const buf = this.metadata.slice(start, end)
      this._data(piece, buf, this._metadataSize)
    }

    _onData (piece, buf, totalSize) {
      if (buf.length > PIECE_LENGTH || !this._fetching) {
        return
      }
      buf.copy(this.metadata, piece * PIECE_LENGTH)
      this._bitfield.set(piece)
      this._checkDone()
    }

    _onReject (piece) {
      if (this._remainingRejects > 0 && this._fetching) {
        // If we haven't been rejected too much,
        // then try to request the piece again
        this._request(piece)
        this._remainingRejects -= 1
      } else {
        this.emit('warning', new Error('Peer sent "reject" too much'))
      }
    }

    _requestPieces () {
      if (!this._fetching) return
      this.metadata = Buffer.alloc(this._metadataSize)
      for (let piece = 0; piece < this._numPieces; piece++) {
        this._request(piece)
      }
    }

    _checkDone () {
      let done = true
      for (let piece = 0; piece < this._numPieces; piece++) {
        if (!this._bitfield.get(piece)) {
          done = false
          break
        }
      }
      if (!done) return

      // attempt to set metadata -- may fail sha1 check
      const success = this.setMetadata(this.metadata)

      if (!success) {
        this._failedMetadata()
      }
    }

    _failedMetadata () {
      // reset bitfield & try again
      this._bitfield = new BitField(0, { grow: BITFIELD_GROW })
      this._remainingRejects -= this._numPieces
      if (this._remainingRejects > 0) {
        this._requestPieces()
      } else {
        this.emit('warning', new Error('Peer sent invalid metadata'))
      }
    }
  }

  // Name of the bittorrent-protocol extension
  utMetadata.prototype.name = 'ut_metadata'

  return utMetadata
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"bencode":7,"bitfield":10,"buffer":52,"debug":111,"events":117,"simple-sha1":255}],312:[function(require,module,exports){
(function (global){(function (){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],313:[function(require,module,exports){
(function (Buffer){(function (){
const bs = require('binary-search')
const EventEmitter = require('events')
const mp4 = require('mp4-stream')
const Box = require('mp4-box-encoding')
const RangeSliceStream = require('range-slice-stream')

// if we want to ignore more than this many bytes, request a new stream.
// if we want to ignore fewer, just skip them.
const FIND_MOOV_SEEK_SIZE = 4096

class MP4Remuxer extends EventEmitter {
  constructor (file) {
    super()

    this._tracks = []
    this._file = file
    this._decoder = null
    this._findMoov(0)
  }

  _findMoov (offset) {
    if (this._decoder) {
      this._decoder.destroy()
    }

    let toSkip = 0
    this._decoder = mp4.decode()
    const fileStream = this._file.createReadStream({
      start: offset
    })
    fileStream.pipe(this._decoder)

    const boxHandler = headers => {
      if (headers.type === 'moov') {
        this._decoder.removeListener('box', boxHandler)
        this._decoder.decode(moov => {
          fileStream.destroy()
          try {
            this._processMoov(moov)
          } catch (err) {
            err.message = `Cannot parse mp4 file: ${err.message}`
            this.emit('error', err)
          }
        })
      } else if (headers.length < FIND_MOOV_SEEK_SIZE) {
        toSkip += headers.length
        this._decoder.ignore()
      } else {
        this._decoder.removeListener('box', boxHandler)
        toSkip += headers.length
        fileStream.destroy()
        this._decoder.destroy()
        this._findMoov(offset + toSkip)
      }
    }
    this._decoder.on('box', boxHandler)

  }

  _processMoov (moov) {
    const traks = moov.traks
    this._tracks = []
    this._hasVideo = false
    this._hasAudio = false
    for (let i = 0; i < traks.length; i++) {
      const trak = traks[i]
      const stbl = trak.mdia.minf.stbl
      const stsdEntry = stbl.stsd.entries[0]
      const handlerType = trak.mdia.hdlr.handlerType
      let codec
      let mime
      if (handlerType === 'vide' && stsdEntry.type === 'avc1') {
        if (this._hasVideo) {
          continue
        }
        this._hasVideo = true
        codec = 'avc1'
        if (stsdEntry.avcC) {
          codec += `.${stsdEntry.avcC.mimeCodec}`
        }
        mime = `video/mp4; codecs="${codec}"`
      } else if (handlerType === 'soun' && stsdEntry.type === 'mp4a') {
        if (this._hasAudio) {
          continue
        }
        this._hasAudio = true
        codec = 'mp4a'
        if (stsdEntry.esds && stsdEntry.esds.mimeCodec) {
          codec += `.${stsdEntry.esds.mimeCodec}`
        }
        mime = `audio/mp4; codecs="${codec}"`
      } else {
        continue
      }

      const samples = []
      let sample = 0

      // Chunk/position data
      let sampleInChunk = 0
      let chunk = 0
      let offsetInChunk = 0
      let sampleToChunkIndex = 0

      // Time data
      let dts = 0
      const decodingTimeEntry = new RunLengthIndex(stbl.stts.entries)
      let presentationOffsetEntry = null
      if (stbl.ctts) {
        presentationOffsetEntry = new RunLengthIndex(stbl.ctts.entries)
      }

      // Sync table index
      let syncSampleIndex = 0

      while (true) {
        var currChunkEntry = stbl.stsc.entries[sampleToChunkIndex]

        // Compute size
        const size = stbl.stsz.entries[sample]

        // Compute time data
        const duration = decodingTimeEntry.value.duration
        const presentationOffset = presentationOffsetEntry ? presentationOffsetEntry.value.compositionOffset : 0

        // Compute sync
        let sync = true
        if (stbl.stss) {
          sync = stbl.stss.entries[syncSampleIndex] === sample + 1
        }

        // Create new sample entry
        const chunkOffsetTable = stbl.stco || stbl.co64
        samples.push({
          size,
          duration,
          dts,
          presentationOffset,
          sync,
          offset: offsetInChunk + chunkOffsetTable.entries[chunk]
        })

        // Go to next sample
        sample++
        if (sample >= stbl.stsz.entries.length) {
          break
        }

        // Move position/chunk
        sampleInChunk++
        offsetInChunk += size
        if (sampleInChunk >= currChunkEntry.samplesPerChunk) {
          // Move to new chunk
          sampleInChunk = 0
          offsetInChunk = 0
          chunk++
          // Move sample to chunk box index
          const nextChunkEntry = stbl.stsc.entries[sampleToChunkIndex + 1]
          if (nextChunkEntry && chunk + 1 >= nextChunkEntry.firstChunk) {
            sampleToChunkIndex++
          }
        }

        // Move time forward
        dts += duration
        decodingTimeEntry.inc()
        presentationOffsetEntry && presentationOffsetEntry.inc()

        // Move sync table index
        if (sync) {
          syncSampleIndex++
        }
      }

      trak.mdia.mdhd.duration = 0
      trak.tkhd.duration = 0

      const defaultSampleDescriptionIndex = currChunkEntry.sampleDescriptionId

      const trackMoov = {
        type: 'moov',
        mvhd: moov.mvhd,
        traks: [{
          tkhd: trak.tkhd,
          mdia: {
            mdhd: trak.mdia.mdhd,
            hdlr: trak.mdia.hdlr,
            elng: trak.mdia.elng,
            minf: {
              vmhd: trak.mdia.minf.vmhd,
              smhd: trak.mdia.minf.smhd,
              dinf: trak.mdia.minf.dinf,
              stbl: {
                stsd: stbl.stsd,
                stts: empty(),
                ctts: empty(),
                stsc: empty(),
                stsz: empty(),
                stco: empty(),
                stss: empty()
              }
            }
          }
        }],
        mvex: {
          mehd: {
            fragmentDuration: moov.mvhd.duration
          },
          trexs: [{
            trackId: trak.tkhd.trackId,
            defaultSampleDescriptionIndex,
            defaultSampleDuration: 0,
            defaultSampleSize: 0,
            defaultSampleFlags: 0
          }]
        }
      }

      this._tracks.push({
        fragmentSequence: 1,
        trackId: trak.tkhd.trackId,
        timeScale: trak.mdia.mdhd.timeScale,
        samples,
        currSample: null,
        currTime: null,
        moov: trackMoov,
        mime
      })
    }

    if (this._tracks.length === 0) {
      this.emit('error', new Error('no playable tracks'))
      return
    }

    // Must be set last since this is used above
    moov.mvhd.duration = 0

    this._ftyp = {
      type: 'ftyp',
      brand: 'iso5',
      brandVersion: 0,
      compatibleBrands: [
        'iso5'
      ]
    }

    const ftypBuf = Box.encode(this._ftyp)
    const data = this._tracks.map(track => {
      const moovBuf = Box.encode(track.moov)
      return {
        mime: track.mime,
        init: Buffer.concat([ftypBuf, moovBuf])
      }
    })

    this.emit('ready', data)
  }

  seek (time) {
    if (!this._tracks) {
      throw new Error('Not ready yet; wait for \'ready\' event')
    }

    if (this._fileStream) {
      this._fileStream.destroy()
      this._fileStream = null
    }

    let startOffset = -1
    this._tracks.map((track, i) => {
      // find the keyframe before the time
      // stream from there
      if (track.outStream) {
        track.outStream.destroy()
      }
      if (track.inStream) {
        track.inStream.destroy()
        track.inStream = null
      }
      const outStream = track.outStream = mp4.encode()
      const fragment = this._generateFragment(i, time)
      if (!fragment) {
        return outStream.finalize()
      }

      if (startOffset === -1 || fragment.ranges[0].start < startOffset) {
        startOffset = fragment.ranges[0].start
      }

      const writeFragment = (frag) => {
        if (outStream.destroyed) return
        outStream.box(frag.moof, err => {
          if (err) return this.emit('error', err)
          if (outStream.destroyed) return
          const slicedStream = track.inStream.slice(frag.ranges)
          slicedStream.pipe(outStream.mediaData(frag.length, err => {
            if (err) return this.emit('error', err)
            if (outStream.destroyed) return
            const nextFrag = this._generateFragment(i)
            if (!nextFrag) {
              return outStream.finalize()
            }
            writeFragment(nextFrag)
          }))
        })
      }
      writeFragment(fragment)
    })

    if (startOffset >= 0) {
      const fileStream = this._fileStream = this._file.createReadStream({
        start: startOffset
      })

      this._tracks.forEach(track => {
        track.inStream = new RangeSliceStream(startOffset, {
          // Allow up to a 10MB offset between audio and video,
          // which should be fine for any reasonable interleaving
          // interval and bitrate
          highWaterMark: 10000000
        })
        fileStream.pipe(track.inStream)
      })
    }

    return this._tracks.map(track => {
      return track.outStream
    })
  }

  _findSampleBefore (trackInd, time) {
    const track = this._tracks[trackInd]
    const scaledTime = Math.floor(track.timeScale * time)
    let sample = bs(track.samples, scaledTime, (sample, t) => {
      const pts = sample.dts + sample.presentationOffset// - track.editShift
      return pts - t
    })
    if (sample === -1) {
      sample = 0
    } else if (sample < 0) {
      sample = -sample - 2
    }
    // sample is now the last sample with dts <= time
    // Find the preceeding sync sample
    while (!track.samples[sample].sync) {
      sample--
    }
    return sample
  }

  _generateFragment (track, time) {
    /*
        1. Find correct sample
        2. Process backward until sync sample found
        3. Process forward until next sync sample after MIN_FRAGMENT_DURATION found
        */
    const currTrack = this._tracks[track]
    let firstSample
    if (time !== undefined) {
      firstSample = this._findSampleBefore(track, time)
    } else {
      firstSample = currTrack.currSample
    }

    if (firstSample >= currTrack.samples.length) { return null }

    const startDts = currTrack.samples[firstSample].dts

    let totalLen = 0
    const ranges = []
    for (var currSample = firstSample; currSample < currTrack.samples.length; currSample++) {
      const sample = currTrack.samples[currSample]
      if (sample.sync && sample.dts - startDts >= currTrack.timeScale * MIN_FRAGMENT_DURATION) {
        break // This is a reasonable place to end the fragment
      }

      totalLen += sample.size
      const currRange = ranges.length - 1
      if (currRange < 0 || ranges[currRange].end !== sample.offset) {
        // Push a new range
        ranges.push({
          start: sample.offset,
          end: sample.offset + sample.size
        })
      } else {
        ranges[currRange].end += sample.size
      }
    }

    currTrack.currSample = currSample

    return {
      moof: this._generateMoof(track, firstSample, currSample),
      ranges,
      length: totalLen
    }
  }

  _generateMoof (track, firstSample, lastSample) {
    const currTrack = this._tracks[track]

    const entries = []
    let trunVersion = 0
    for (let j = firstSample; j < lastSample; j++) {
      const currSample = currTrack.samples[j]
      if (currSample.presentationOffset < 0) { trunVersion = 1 }
      entries.push({
        sampleDuration: currSample.duration,
        sampleSize: currSample.size,
        sampleFlags: currSample.sync ? 0x2000000 : 0x1010000,
        sampleCompositionTimeOffset: currSample.presentationOffset
      })
    }

    const moof = {
      type: 'moof',
      mfhd: {
        sequenceNumber: currTrack.fragmentSequence++
      },
      trafs: [{
        tfhd: {
          flags: 0x20000, // default-base-is-moof
          trackId: currTrack.trackId
        },
        tfdt: {
          baseMediaDecodeTime: currTrack.samples[firstSample].dts
        },
        trun: {
          flags: 0xf01,
          dataOffset: 8, // The moof size has to be added to this later as well
          entries,
          version: trunVersion
        }
      }]
    }

    // Update the offset
    moof.trafs[0].trun.dataOffset += Box.encodingLength(moof)

    return moof
  }
}

class RunLengthIndex {
  constructor (entries, countName) {
    this._entries = entries
    this._countName = countName || 'count'
    this._index = 0
    this._offset = 0

    this.value = this._entries[0]
  }

  inc () {
    this._offset++
    if (this._offset >= this._entries[this._index][this._countName]) {
      this._index++
      this._offset = 0
    }

    this.value = this._entries[this._index]
  }
}

function empty () {
  return {
    version: 0,
    flags: 0,
    entries: []
  }
}

const MIN_FRAGMENT_DURATION = 1 // second

module.exports = MP4Remuxer

}).call(this)}).call(this,require("buffer").Buffer)
},{"binary-search":9,"buffer":52,"events":117,"mp4-box-encoding":164,"mp4-stream":167,"range-slice-stream":215}],314:[function(require,module,exports){
const MediaElementWrapper = require('mediasource')
const pump = require('pump')

const MP4Remuxer = require('./mp4-remuxer')

function VideoStream (file, mediaElem, opts = {}) {
  if (!(this instanceof VideoStream)) {
    console.warn("Don't invoke VideoStream without the 'new' keyword.")
    return new VideoStream(file, mediaElem, opts)
  }

  this.detailedError = null

  this._elem = mediaElem
  this._elemWrapper = new MediaElementWrapper(mediaElem)
  this._waitingFired = false
  this._trackMeta = null
  this._file = file
  this._tracks = null

  if (this._elem.preload !== 'none') {
    this._createMuxer()
  }

  this._onError = () => {
    this.detailedError = this._elemWrapper.detailedError
    this.destroy() // don't pass err though so the user doesn't need to listen for errors
  }

  this._onWaiting = () => {
    this._waitingFired = true
    if (!this._muxer) {
      this._createMuxer()
    } else if (this._tracks) {
      this._pump()
    }
  }

  if (mediaElem.autoplay) { mediaElem.preload = 'auto' }
  mediaElem.addEventListener('waiting', this._onWaiting)
  mediaElem.addEventListener('error', this._onError)
}

VideoStream.prototype = {
  _createMuxer () {
    this._muxer = new MP4Remuxer(this._file)
    this._muxer.on('ready', data => {
      this._tracks = data.map(trackData => {
        const mediaSource = this._elemWrapper.createWriteStream(trackData.mime)
        mediaSource.on('error', err => {
          this._elemWrapper.error(err)
        })
        const track = {
          muxed: null,
          mediaSource,
          initFlushed: false,
          onInitFlushed: null
        }
        mediaSource.write(trackData.init, err => {
          track.initFlushed = true
          if (track.onInitFlushed) {
            track.onInitFlushed(err)
          }
        })
        return track
      })

      if (this._waitingFired || this._elem.preload === 'auto') {
        this._pump()
      }
    })

    this._muxer.on('error', err => {
      this._elemWrapper.error(err)
    })
  },
  _pump () {
    const muxed = this._muxer.seek(this._elem.currentTime, !this._tracks)

    this._tracks.forEach((track, i) => {
      const pumpTrack = () => {
        if (track.muxed) {
          track.muxed.destroy()
          track.mediaSource = this._elemWrapper.createWriteStream(track.mediaSource)
          track.mediaSource.on('error', err => {
            this._elemWrapper.error(err)
          })
        }
        track.muxed = muxed[i]
        pump(track.muxed, track.mediaSource)
      }
      if (!track.initFlushed) {
        track.onInitFlushed = err => {
          if (err) {
            this._elemWrapper.error(err)
            return
          }
          pumpTrack()
        }
      } else {
        pumpTrack()
      }
    })
  },
  destroy () {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    this._elem.removeEventListener('waiting', this._onWaiting)
    this._elem.removeEventListener('error', this._onError)

    if (this._tracks) {
      this._tracks.forEach(track => {
        if (track.muxed) {
          track.muxed.destroy()
        }
      })
    }

    this._elem.src = ''
  }
}

module.exports = VideoStream

},{"./mp4-remuxer":313,"mediasource":145,"pump":207}],315:[function(require,module,exports){
(function (global,Buffer){(function (){
/*! webtorrent. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */
/* global FileList */

const { EventEmitter } = require('events')
const concat = require('simple-concat')
const createTorrent = require('create-torrent')
const debug = require('debug')('webtorrent')
const DHT = require('bittorrent-dht/client') // browser exclude
const loadIPSet = require('load-ip-set') // browser exclude
const parallel = require('run-parallel')
const parseTorrent = require('parse-torrent')
const path = require('path')
const Peer = require('simple-peer')
const randombytes = require('randombytes')
const speedometer = require('speedometer')
const queueMicrotask = require('queue-microtask')

const ConnPool = require('./lib/conn-pool') // browser exclude
const Torrent = require('./lib/torrent')
const VERSION = require('./package.json').version

/**
 * Version number in Azureus-style. Generated from major and minor semver version.
 * For example:
 *   '0.16.1' -> '0016'
 *   '1.2.5' -> '0102'
 */
const VERSION_STR = VERSION
  .replace(/\d*./g, v => `0${v % 100}`.slice(-2))
  .slice(0, 4)

/**
 * Version prefix string (used in peer ID). WebTorrent uses the Azureus-style
 * encoding: '-', two characters for client id ('WW'), four ascii digits for version
 * number, '-', followed by random numbers.
 * For example:
 *   '-WW0102-'...
 */
const VERSION_PREFIX = `-WW${VERSION_STR}-`

/**
 * WebTorrent Client
 * @param {Object=} opts
 */
class WebTorrent extends EventEmitter {
  constructor (opts = {}) {
    super()

    if (typeof opts.peerId === 'string') {
      this.peerId = opts.peerId
    } else if (Buffer.isBuffer(opts.peerId)) {
      this.peerId = opts.peerId.toString('hex')
    } else {
      this.peerId = Buffer.from(VERSION_PREFIX + randombytes(9).toString('base64')).toString('hex')
    }
    this.peerIdBuffer = Buffer.from(this.peerId, 'hex')

    if (typeof opts.nodeId === 'string') {
      this.nodeId = opts.nodeId
    } else if (Buffer.isBuffer(opts.nodeId)) {
      this.nodeId = opts.nodeId.toString('hex')
    } else {
      this.nodeId = randombytes(20).toString('hex')
    }
    this.nodeIdBuffer = Buffer.from(this.nodeId, 'hex')

    this._debugId = this.peerId.toString('hex').substring(0, 7)

    this.destroyed = false
    this.listening = false
    this.torrentPort = opts.torrentPort || 0
    this.dhtPort = opts.dhtPort || 0
    this.tracker = opts.tracker !== undefined ? opts.tracker : {}
    this.lsd = opts.lsd !== false
    this.torrents = []
    this.maxConns = Number(opts.maxConns) || 55
    this.utp = opts.utp === true

    this._debug(
      'new webtorrent (peerId %s, nodeId %s, port %s)',
      this.peerId, this.nodeId, this.torrentPort
    )

    if (this.tracker) {
      if (typeof this.tracker !== 'object') this.tracker = {}
      if (opts.rtcConfig) {
        // TODO: remove in v1
        console.warn('WebTorrent: opts.rtcConfig is deprecated. Use opts.tracker.rtcConfig instead')
        this.tracker.rtcConfig = opts.rtcConfig
      }
      if (opts.wrtc) {
        // TODO: remove in v1
        console.warn('WebTorrent: opts.wrtc is deprecated. Use opts.tracker.wrtc instead')
        this.tracker.wrtc = opts.wrtc
      }
      if (global.WRTC && !this.tracker.wrtc) {
        this.tracker.wrtc = global.WRTC
      }
    }

    if (typeof ConnPool === 'function') {
      this._connPool = new ConnPool(this)
    } else {
      queueMicrotask(() => {
        this._onListening()
      })
    }

    // stats
    this._downloadSpeed = speedometer()
    this._uploadSpeed = speedometer()

    if (opts.dht !== false && typeof DHT === 'function' /* browser exclude */) {
      // use a single DHT instance for all torrents, so the routing table can be reused
      this.dht = new DHT(Object.assign({}, { nodeId: this.nodeId }, opts.dht))

      this.dht.once('error', err => {
        this._destroy(err)
      })

      this.dht.once('listening', () => {
        const address = this.dht.address()
        if (address) this.dhtPort = address.port
      })

      // Ignore warning when there are > 10 torrents in the client
      this.dht.setMaxListeners(0)

      this.dht.listen(this.dhtPort)
    } else {
      this.dht = false
    }

    // Enable or disable BEP19 (Web Seeds). Enabled by default:
    this.enableWebSeeds = opts.webSeeds !== false

    const ready = () => {
      if (this.destroyed) return
      this.ready = true
      this.emit('ready')
    }

    if (typeof loadIPSet === 'function' && opts.blocklist != null) {
      loadIPSet(opts.blocklist, {
        headers: {
          'user-agent': `WebTorrent/${VERSION} (https://webtorrent.io)`
        }
      }, (err, ipSet) => {
        if (err) return this.error(`Failed to load blocklist: ${err.message}`)
        this.blocked = ipSet
        ready()
      })
    } else {
      queueMicrotask(ready)
    }
  }

  get downloadSpeed () { return this._downloadSpeed() }

  get uploadSpeed () { return this._uploadSpeed() }

  get progress () {
    const torrents = this.torrents.filter(torrent => torrent.progress !== 1)
    const downloaded = torrents.reduce((total, torrent) => total + torrent.downloaded, 0)
    const length = torrents.reduce((total, torrent) => total + (torrent.length || 0), 0) || 1
    return downloaded / length
  }

  get ratio () {
    const uploaded = this.torrents.reduce((total, torrent) => total + torrent.uploaded, 0)
    const received = this.torrents.reduce((total, torrent) => total + torrent.received, 0) || 1
    return uploaded / received
  }

  /**
   * Returns the torrent with the given `torrentId`. Convenience method. Easier than
   * searching through the `client.torrents` array. Returns `null` if no matching torrent
   * found.
   *
   * @param  {string|Buffer|Object|Torrent} torrentId
   * @return {Torrent|null}
   */
  get (torrentId) {
    if (torrentId instanceof Torrent) {
      if (this.torrents.includes(torrentId)) return torrentId
    } else {
      let parsed
      try { parsed = parseTorrent(torrentId) } catch (err) {}

      if (!parsed) return null
      if (!parsed.infoHash) throw new Error('Invalid torrent identifier')

      for (const torrent of this.torrents) {
        if (torrent.infoHash === parsed.infoHash) return torrent
      }
    }
    return null
  }

  // TODO: remove in v1
  download (torrentId, opts, ontorrent) {
    console.warn('WebTorrent: client.download() is deprecated. Use client.add() instead')
    return this.add(torrentId, opts, ontorrent)
  }

  /**
   * Start downloading a new torrent. Aliased as `client.download`.
   * @param {string|Buffer|Object} torrentId
   * @param {Object} opts torrent-specific options
   * @param {function=} ontorrent called when the torrent is ready (has metadata)
   */
  add (torrentId, opts = {}, ontorrent = () => {}) {
    if (this.destroyed) throw new Error('client is destroyed')
    if (typeof opts === 'function') [opts, ontorrent] = [{}, opts]

    const onInfoHash = () => {
      if (this.destroyed) return
      for (const t of this.torrents) {
        if (t.infoHash === torrent.infoHash && t !== torrent) {
          torrent._destroy(new Error(`Cannot add duplicate torrent ${torrent.infoHash}`))
          return
        }
      }
    }

    const onReady = () => {
      if (this.destroyed) return
      ontorrent(torrent)
      this.emit('torrent', torrent)
    }

    function onClose () {
      torrent.removeListener('_infoHash', onInfoHash)
      torrent.removeListener('ready', onReady)
      torrent.removeListener('close', onClose)
    }

    this._debug('add')
    opts = opts ? Object.assign({}, opts) : {}

    const torrent = new Torrent(torrentId, this, opts)
    this.torrents.push(torrent)

    torrent.once('_infoHash', onInfoHash)
    torrent.once('ready', onReady)
    torrent.once('close', onClose)

    return torrent
  }

  /**
   * Start seeding a new file/folder.
   * @param  {string|File|FileList|Buffer|Array.<string|File|Buffer>} input
   * @param  {Object=} opts
   * @param  {function=} onseed called when torrent is seeding
   */
  seed (input, opts, onseed) {
    if (this.destroyed) throw new Error('client is destroyed')
    if (typeof opts === 'function') [opts, onseed] = [{}, opts]

    this._debug('seed')
    opts = opts ? Object.assign({}, opts) : {}

    // no need to verify the hashes we create
    opts.skipVerify = true

    const isFilePath = typeof input === 'string'

    // When seeding from fs path, initialize store from that path to avoid a copy
    if (isFilePath) opts.path = path.dirname(input)
    if (!opts.createdBy) opts.createdBy = `WebTorrent/${VERSION_STR}`

    const onTorrent = torrent => {
      const tasks = [
        cb => {
          // when a filesystem path is specified or the store is preloaded, files are already in the FS store
          if (isFilePath || opts.preloadedStore) return cb()
          torrent.load(streams, cb)
        }
      ]
      if (this.dht) {
        tasks.push(cb => {
          torrent.once('dhtAnnounce', cb)
        })
      }
      parallel(tasks, err => {
        if (this.destroyed) return
        if (err) return torrent._destroy(err)
        _onseed(torrent)
      })
    }

    const _onseed = torrent => {
      this._debug('on seed')
      if (typeof onseed === 'function') onseed(torrent)
      torrent.emit('seed')
      this.emit('seed', torrent)
    }

    const torrent = this.add(null, opts, onTorrent)
    let streams

    if (isFileList(input)) input = Array.from(input)
    else if (!Array.isArray(input)) input = [input]

    parallel(input.map(item => cb => {
      if (!opts.preloadedStore && isReadable(item)) {
        concat(item, (err, buf) => {
          if (err) return cb(err)
          buf.name = item.name
          cb(null, buf)
        })
      } else {
        cb(null, item)
      }
    }), (err, input) => {
      if (this.destroyed) return
      if (err) return torrent._destroy(err)

      createTorrent.parseInput(input, opts, (err, files) => {
        if (this.destroyed) return
        if (err) return torrent._destroy(err)

        streams = files.map(file => file.getStream)

        createTorrent(input, opts, (err, torrentBuf) => {
          if (this.destroyed) return
          if (err) return torrent._destroy(err)

          const existingTorrent = this.get(torrentBuf)
          if (existingTorrent) {
            torrent._destroy(new Error(`Cannot add duplicate torrent ${existingTorrent.infoHash}`))
          } else {
            torrent._onTorrentId(torrentBuf)
          }
        })
      })
    })

    return torrent
  }

  /**
   * Remove a torrent from the client.
   * @param  {string|Buffer|Torrent}   torrentId
   * @param  {function} cb
   */
  remove (torrentId, opts, cb) {
    if (typeof opts === 'function') return this.remove(torrentId, null, opts)

    this._debug('remove')
    const torrent = this.get(torrentId)
    if (!torrent) throw new Error(`No torrent with id ${torrentId}`)
    this._remove(torrentId, opts, cb)
  }

  _remove (torrentId, opts, cb) {
    if (typeof opts === 'function') return this._remove(torrentId, null, opts)

    const torrent = this.get(torrentId)
    if (!torrent) return
    this.torrents.splice(this.torrents.indexOf(torrent), 1)
    torrent.destroy(opts, cb)
  }

  address () {
    if (!this.listening) return null
    return this._connPool
      ? this._connPool.tcpServer.address()
      : { address: '0.0.0.0', family: 'IPv4', port: 0 }
  }

  /**
   * Destroy the client, including all torrents and connections to peers.
   * @param  {function} cb
   */
  destroy (cb) {
    if (this.destroyed) throw new Error('client already destroyed')
    this._destroy(null, cb)
  }

  _destroy (err, cb) {
    this._debug('client destroy')
    this.destroyed = true

    const tasks = this.torrents.map(torrent => cb => {
      torrent.destroy(cb)
    })

    if (this._connPool) {
      tasks.push(cb => {
        this._connPool.destroy(cb)
      })
    }

    if (this.dht) {
      tasks.push(cb => {
        this.dht.destroy(cb)
      })
    }

    parallel(tasks, cb)

    if (err) this.emit('error', err)

    this.torrents = []
    this._connPool = null
    this.dht = null
  }

  _onListening () {
    this._debug('listening')
    this.listening = true

    if (this._connPool) {
      // Sometimes server.address() returns `null` in Docker.
      const address = this._connPool.tcpServer.address()
      if (address) this.torrentPort = address.port
    }

    this.emit('listening')
  }

  _debug () {
    const args = [].slice.call(arguments)
    args[0] = `[${this._debugId}] ${args[0]}`
    debug(...args)
  }
}

WebTorrent.WEBRTC_SUPPORT = Peer.WEBRTC_SUPPORT
WebTorrent.VERSION = VERSION

/**
 * Check if `obj` is a node Readable stream
 * @param  {*} obj
 * @return {boolean}
 */
function isReadable (obj) {
  return typeof obj === 'object' && obj != null && typeof obj.pipe === 'function'
}

/**
 * Check if `obj` is a W3C `FileList` object
 * @param  {*} obj
 * @return {boolean}
 */
function isFileList (obj) {
  return typeof FileList !== 'undefined' && obj instanceof FileList
}

module.exports = WebTorrent

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"./lib/conn-pool":48,"./lib/torrent":320,"./package.json":337,"bittorrent-dht/client":48,"buffer":52,"create-torrent":71,"debug":111,"events":117,"load-ip-set":48,"parse-torrent":202,"path":203,"queue-microtask":212,"randombytes":214,"run-parallel":234,"simple-concat":237,"simple-peer":239,"speedometer":273}],316:[function(require,module,exports){
const debug = require('debug')('webtorrent:file-stream')
const stream = require('readable-stream')

/**
 * Readable stream of a torrent file
 *
 * @param {File} file
 * @param {Object} opts
 * @param {number} opts.start stream slice of file, starting from this byte (inclusive)
 * @param {number} opts.end stream slice of file, ending with this byte (inclusive)
 */
class FileStream extends stream.Readable {
  constructor (file, opts) {
    super(opts)

    this.destroyed = false
    this._torrent = file._torrent

    const start = (opts && opts.start) || 0
    const end = (opts && opts.end && opts.end < file.length)
      ? opts.end
      : file.length - 1

    const pieceLength = file._torrent.pieceLength

    this._startPiece = (start + file.offset) / pieceLength | 0
    this._endPiece = (end + file.offset) / pieceLength | 0

    this._piece = this._startPiece
    this._offset = (start + file.offset) - (this._startPiece * pieceLength)

    this._missing = end - start + 1
    this._reading = false
    this._notifying = false
    this._criticalLength = Math.min((1024 * 1024 / pieceLength) | 0, 2)
  }

  _read () {
    if (this._reading) return
    this._reading = true
    this._notify()
  }

  _notify () {
    if (!this._reading || this._missing === 0) return
    if (!this._torrent.bitfield.get(this._piece)) {
      return this._torrent.critical(this._piece, this._piece + this._criticalLength)
    }

    if (this._notifying) return
    this._notifying = true

    if (this._torrent.destroyed) return this._destroy(new Error('Torrent removed'))

    const p = this._piece

    const getOpts = {}
    // Specify length for the last piece in case it is zero-padded
    if (p === this._torrent.pieces.length - 1) {
      getOpts.length = this._torrent.lastPieceLength
    }
    this._torrent.store.get(p, getOpts, (err, buffer) => {
      this._notifying = false
      if (this.destroyed) return
      debug('read %s (length %s) (err %s)', p, buffer && buffer.length, err && err.message)

      if (err) return this._destroy(err)

      if (this._offset) {
        buffer = buffer.slice(this._offset)
        this._offset = 0
      }

      if (this._missing < buffer.length) {
        buffer = buffer.slice(0, this._missing)
      }
      this._missing -= buffer.length

      debug('pushing buffer of length %s', buffer.length)
      this._reading = false
      this.push(buffer)

      if (this._missing === 0) this.push(null)
    })
    this._piece += 1
  }

  _destroy (err) {
    if (this.destroyed) return
    this.destroyed = true

    if (!this._torrent.destroyed) {
      this._torrent.deselect(this._startPiece, this._endPiece, true)
    }

    if (err) this.emit('error', err)
    this.emit('close')
  }
}

module.exports = FileStream

},{"debug":111,"readable-stream":336}],317:[function(require,module,exports){
const { EventEmitter } = require('events')
const { PassThrough } = require('readable-stream')
const eos = require('end-of-stream')
const path = require('path')
const render = require('render-media')
const streamToBlob = require('stream-to-blob')
const streamToBlobURL = require('stream-to-blob-url')
const streamToBuffer = require('stream-with-known-length-to-buffer')
const FileStream = require('./file-stream')
const queueMicrotask = require('queue-microtask')

class File extends EventEmitter {
  constructor (torrent, file) {
    super()

    this._torrent = torrent
    this._destroyed = false

    this.name = file.name
    this.path = file.path
    this.length = file.length
    this.offset = file.offset

    this.done = false

    const start = file.offset
    const end = start + file.length - 1

    this._startPiece = start / this._torrent.pieceLength | 0
    this._endPiece = end / this._torrent.pieceLength | 0

    if (this.length === 0) {
      this.done = true
      this.emit('done')
    }
  }

  get downloaded () {
    if (this._destroyed || !this._torrent.bitfield) return 0

    const { pieces, bitfield, pieceLength, lastPieceLength } = this._torrent
    const { _startPiece: start, _endPiece: end } = this

    const getPieceLength = (pieceIndex) => (
      pieceIndex === pieces.length - 1 ? lastPieceLength : pieceLength
    )

    const getPieceDownloaded = (pieceIndex) => {
      const len = pieceIndex === pieces.length - 1 ? lastPieceLength : pieceLength
      if (bitfield.get(pieceIndex)) {
        // verified data
        return len
      } else {
        // "in progress" data
        return len - pieces[pieceIndex].missing
      }
    }

    let downloaded = 0
    for (let index = start; index <= end; index += 1) {
      const pieceDownloaded = getPieceDownloaded(index)
      downloaded += pieceDownloaded

      if (index === start) {
        // First piece may have an offset, e.g. irrelevant bytes from the end of
        // the previous file
        const irrelevantFirstPieceBytes = this.offset % pieceLength
        downloaded -= Math.min(irrelevantFirstPieceBytes, pieceDownloaded)
      }

      if (index === end) {
        // Last piece may have an offset, e.g. irrelevant bytes from the start
        // of the next file
        const irrelevantLastPieceBytes = getPieceLength(end) - (this.offset + this.length) % pieceLength
        downloaded -= Math.min(irrelevantLastPieceBytes, pieceDownloaded)
      }
    }

    return downloaded
  }

  get progress () {
    return this.length ? this.downloaded / this.length : 0
  }

  select (priority) {
    if (this.length === 0) return
    this._torrent.select(this._startPiece, this._endPiece, priority)
  }

  deselect () {
    if (this.length === 0) return
    this._torrent.deselect(this._startPiece, this._endPiece, false)
  }

  createReadStream (opts) {
    if (this.length === 0) {
      const empty = new PassThrough()
      queueMicrotask(() => {
        empty.end()
      })
      return empty
    }

    const fileStream = new FileStream(this, opts)
    this._torrent.select(fileStream._startPiece, fileStream._endPiece, true, () => {
      fileStream._notify()
    })
    eos(fileStream, () => {
      if (this._destroyed) return
      if (!this._torrent.destroyed) {
        this._torrent.deselect(fileStream._startPiece, fileStream._endPiece, true)
      }
    })
    return fileStream
  }

  getBuffer (cb) {
    streamToBuffer(this.createReadStream(), this.length, cb)
  }

  getBlob (cb) {
    if (typeof window === 'undefined') throw new Error('browser-only method')
    streamToBlob(this.createReadStream(), this._getMimeType())
      .then(
        blob => cb(null, blob),
        err => cb(err)
      )
  }

  getBlobURL (cb) {
    if (typeof window === 'undefined') throw new Error('browser-only method')
    streamToBlobURL(this.createReadStream(), this._getMimeType())
      .then(
        blobUrl => cb(null, blobUrl),
        err => cb(err)
      )
  }

  appendTo (elem, opts, cb) {
    if (typeof window === 'undefined') throw new Error('browser-only method')
    render.append(this, elem, opts, cb)
  }

  renderTo (elem, opts, cb) {
    if (typeof window === 'undefined') throw new Error('browser-only method')
    render.render(this, elem, opts, cb)
  }

  _getMimeType () {
    return render.mime[path.extname(this.name).toLowerCase()]
  }

  _destroy () {
    this._destroyed = true
    this._torrent = null
  }
}

module.exports = File

},{"./file-stream":316,"end-of-stream":114,"events":117,"path":203,"queue-microtask":212,"readable-stream":336,"render-media":231,"stream-to-blob":294,"stream-to-blob-url":293,"stream-with-known-length-to-buffer":295}],318:[function(require,module,exports){
const arrayRemove = require('unordered-array-remove')
const debug = require('debug')('webtorrent:peer')
const Wire = require('bittorrent-protocol')

const CONNECT_TIMEOUT_TCP = 5000
const CONNECT_TIMEOUT_UTP = 5000
const CONNECT_TIMEOUT_WEBRTC = 25000
const HANDSHAKE_TIMEOUT = 25000

/**
 * WebRTC peer connections start out connected, because WebRTC peers require an
 * "introduction" (i.e. WebRTC signaling), and there's no equivalent to an IP address
 * that lets you refer to a WebRTC endpoint.
 */
exports.createWebRTCPeer = (conn, swarm) => {
  const peer = new Peer(conn.id, 'webrtc')
  peer.conn = conn
  peer.swarm = swarm

  if (peer.conn.connected) {
    peer.onConnect()
  } else {
    const cleanup = () => {
      peer.conn.removeListener('connect', onConnect)
      peer.conn.removeListener('error', onError)
    }
    const onConnect = () => {
      cleanup()
      peer.onConnect()
    }
    const onError = err => {
      cleanup()
      peer.destroy(err)
    }
    peer.conn.once('connect', onConnect)
    peer.conn.once('error', onError)
    peer.startConnectTimeout()
  }

  return peer
}

/**
 * Incoming TCP peers start out connected, because the remote peer connected to the
 * listening port of the TCP server. Until the remote peer sends a handshake, we don't
 * know what swarm the connection is intended for.
 */
exports.createTCPIncomingPeer = conn => {
  return _createIncomingPeer(conn, 'tcpIncoming')
}

/**
 * Incoming uTP peers start out connected, because the remote peer connected to the
 * listening port of the uTP server. Until the remote peer sends a handshake, we don't
 * know what swarm the connection is intended for.
 */
exports.createUTPIncomingPeer = conn => {
  return _createIncomingPeer(conn, 'utpIncoming')
}

/**
 * Outgoing TCP peers start out with just an IP address. At some point (when there is an
 * available connection), the client can attempt to connect to the address.
 */
exports.createTCPOutgoingPeer = (addr, swarm) => {
  return _createOutgoingPeer(addr, swarm, 'tcpOutgoing')
}

/**
 * Outgoing uTP peers start out with just an IP address. At some point (when there is an
 * available connection), the client can attempt to connect to the address.
 */
exports.createUTPOutgoingPeer = (addr, swarm) => {
  return _createOutgoingPeer(addr, swarm, 'utpOutgoing')
}

const _createIncomingPeer = (conn, type) => {
  const addr = `${conn.remoteAddress}:${conn.remotePort}`
  const peer = new Peer(addr, type)
  peer.conn = conn
  peer.addr = addr

  peer.onConnect()

  return peer
}

const _createOutgoingPeer = (addr, swarm, type) => {
  const peer = new Peer(addr, type)
  peer.addr = addr
  peer.swarm = swarm

  return peer
}

/**
 * Peer that represents a Web Seed (BEP17 / BEP19).
 */
exports.createWebSeedPeer = (conn, id, swarm) => {
  const peer = new Peer(id, 'webSeed')
  peer.swarm = swarm
  peer.conn = conn

  peer.onConnect()

  return peer
}

/**
 * Peer. Represents a peer in the torrent swarm.
 *
 * @param {string} id "ip:port" string, peer id (for WebRTC peers), or url (for Web Seeds)
 * @param {string} type the type of the peer
 */
class Peer {
  constructor (id, type) {
    this.id = id
    this.type = type

    debug('new %s Peer %s', type, id)

    this.addr = null
    this.conn = null
    this.swarm = null
    this.wire = null

    this.connected = false
    this.destroyed = false
    this.timeout = null // handshake timeout
    this.retries = 0 // outgoing TCP connection retry count

    this.sentHandshake = false
  }

  /**
   * Called once the peer is connected (i.e. fired 'connect' event)
   * @param {Socket} conn
   */
  onConnect () {
    if (this.destroyed) return
    this.connected = true

    debug('Peer %s connected', this.id)

    clearTimeout(this.connectTimeout)

    const conn = this.conn
    conn.once('end', () => {
      this.destroy()
    })
    conn.once('close', () => {
      this.destroy()
    })
    conn.once('finish', () => {
      this.destroy()
    })
    conn.once('error', err => {
      this.destroy(err)
    })

    const wire = this.wire = new Wire()
    wire.type = this.type
    wire.once('end', () => {
      this.destroy()
    })
    wire.once('close', () => {
      this.destroy()
    })
    wire.once('finish', () => {
      this.destroy()
    })
    wire.once('error', err => {
      this.destroy(err)
    })

    wire.once('handshake', (infoHash, peerId) => {
      this.onHandshake(infoHash, peerId)
    })
    this.startHandshakeTimeout()

    conn.pipe(wire).pipe(conn)
    if (this.swarm && !this.sentHandshake) this.handshake()
  }

  /**
   * Called when handshake is received from remote peer.
   * @param {string} infoHash
   * @param {string} peerId
   */
  onHandshake (infoHash, peerId) {
    if (!this.swarm) return // `this.swarm` not set yet, so do nothing
    if (this.destroyed) return

    if (this.swarm.destroyed) {
      return this.destroy(new Error('swarm already destroyed'))
    }
    if (infoHash !== this.swarm.infoHash) {
      return this.destroy(new Error('unexpected handshake info hash for this swarm'))
    }
    if (peerId === this.swarm.peerId) {
      return this.destroy(new Error('refusing to connect to ourselves'))
    }

    debug('Peer %s got handshake %s', this.id, infoHash)

    clearTimeout(this.handshakeTimeout)

    this.retries = 0

    let addr = this.addr
    if (!addr && this.conn.remoteAddress && this.conn.remotePort) {
      addr = `${this.conn.remoteAddress}:${this.conn.remotePort}`
    }
    this.swarm._onWire(this.wire, addr)

    // swarm could be destroyed in user's 'wire' event handler
    if (!this.swarm || this.swarm.destroyed) return

    if (!this.sentHandshake) this.handshake()
  }

  handshake () {
    const opts = {
      dht: this.swarm.private ? false : !!this.swarm.client.dht
    }
    this.wire.handshake(this.swarm.infoHash, this.swarm.client.peerId, opts)
    this.sentHandshake = true
  }

  startConnectTimeout () {
    clearTimeout(this.connectTimeout)

    const connectTimeoutValues = {
      webrtc: CONNECT_TIMEOUT_WEBRTC,
      tcpOutgoing: CONNECT_TIMEOUT_TCP,
      utpOutgoing: CONNECT_TIMEOUT_UTP
    }

    this.connectTimeout = setTimeout(() => {
      this.destroy(new Error('connect timeout'))
    }, connectTimeoutValues[this.type])
    if (this.connectTimeout.unref) this.connectTimeout.unref()
  }

  startHandshakeTimeout () {
    clearTimeout(this.handshakeTimeout)
    this.handshakeTimeout = setTimeout(() => {
      this.destroy(new Error('handshake timeout'))
    }, HANDSHAKE_TIMEOUT)
    if (this.handshakeTimeout.unref) this.handshakeTimeout.unref()
  }

  destroy (err) {
    if (this.destroyed) return
    this.destroyed = true
    this.connected = false

    debug('destroy %s %s (error: %s)', this.type, this.id, err && (err.message || err))

    clearTimeout(this.connectTimeout)
    clearTimeout(this.handshakeTimeout)

    const swarm = this.swarm
    const conn = this.conn
    const wire = this.wire

    this.swarm = null
    this.conn = null
    this.wire = null

    if (swarm && wire) {
      arrayRemove(swarm.wires, swarm.wires.indexOf(wire))
    }
    if (conn) {
      conn.on('error', () => {})
      conn.destroy()
    }
    if (wire) wire.destroy()
    if (swarm) swarm.removePeer(this.id)
  }
}

},{"bittorrent-protocol":11,"debug":111,"unordered-array-remove":307}],319:[function(require,module,exports){

/**
 * Mapping of torrent pieces to their respective availability in the torrent swarm. Used
 * by the torrent manager for implementing the rarest piece first selection strategy.
 */
class RarityMap {
  constructor (torrent) {
    this._torrent = torrent
    this._numPieces = torrent.pieces.length
    this._pieces = new Array(this._numPieces)

    this._onWire = wire => {
      this.recalculate()
      this._initWire(wire)
    }
    this._onWireHave = index => {
      this._pieces[index] += 1
    }
    this._onWireBitfield = () => {
      this.recalculate()
    }

    this._torrent.wires.forEach(wire => {
      this._initWire(wire)
    })
    this._torrent.on('wire', this._onWire)
    this.recalculate()
  }

  /**
   * Get the index of the rarest piece. Optionally, pass a filter function to exclude
   * certain pieces (for instance, those that we already have).
   *
   * @param {function} pieceFilterFunc
   * @return {number} index of rarest piece, or -1
   */
  getRarestPiece (pieceFilterFunc) {
    let candidates = []
    let min = Infinity

    for (let i = 0; i < this._numPieces; ++i) {
      if (pieceFilterFunc && !pieceFilterFunc(i)) continue

      const availability = this._pieces[i]
      if (availability === min) {
        candidates.push(i)
      } else if (availability < min) {
        candidates = [i]
        min = availability
      }
    }

    if (candidates.length) {
      // if there are multiple pieces with the same availability, choose one randomly
      return candidates[Math.random() * candidates.length | 0]
    } else {
      return -1
    }
  }

  destroy () {
    this._torrent.removeListener('wire', this._onWire)
    this._torrent.wires.forEach(wire => {
      this._cleanupWireEvents(wire)
    })
    this._torrent = null
    this._pieces = null

    this._onWire = null
    this._onWireHave = null
    this._onWireBitfield = null
  }

  _initWire (wire) {
    wire._onClose = () => {
      this._cleanupWireEvents(wire)
      for (let i = 0; i < this._numPieces; ++i) {
        this._pieces[i] -= wire.peerPieces.get(i)
      }
    }

    wire.on('have', this._onWireHave)
    wire.on('bitfield', this._onWireBitfield)
    wire.once('close', wire._onClose)
  }

  /**
   * Recalculates piece availability across all peers in the torrent.
   */
  recalculate () {
    this._pieces.fill(0)

    for (const wire of this._torrent.wires) {
      for (let i = 0; i < this._numPieces; ++i) {
        this._pieces[i] += wire.peerPieces.get(i)
      }
    }
  }

  _cleanupWireEvents (wire) {
    wire.removeListener('have', this._onWireHave)
    wire.removeListener('bitfield', this._onWireBitfield)
    if (wire._onClose) wire.removeListener('close', wire._onClose)
    wire._onClose = null
  }
}

module.exports = RarityMap

},{}],320:[function(require,module,exports){
(function (process,global){(function (){
/* global Blob */

const addrToIPPort = require('addr-to-ip-port')
const BitField = require('bitfield').default
const ChunkStoreWriteStream = require('chunk-store-stream/write')
const cpus = require('cpus')
const debug = require('debug')('webtorrent:torrent')
const Discovery = require('torrent-discovery')
const EventEmitter = require('events').EventEmitter
const fs = require('fs')
const FSChunkStore = require('fs-chunk-store') // browser: `memory-chunk-store`
const get = require('simple-get')
const ImmediateChunkStore = require('immediate-chunk-store')
const ltDontHave = require('lt_donthave')
const MultiStream = require('multistream')
const net = require('net') // browser exclude
const os = require('os') // browser exclude
const parallel = require('run-parallel')
const parallelLimit = require('run-parallel-limit')
const parseTorrent = require('parse-torrent')
const path = require('path')
const Piece = require('torrent-piece')
const pump = require('pump')
const queueMicrotask = require('queue-microtask')
const randomIterate = require('random-iterate')
const sha1 = require('simple-sha1')
const speedometer = require('speedometer')
const utMetadata = require('ut_metadata')
const utp = require('utp-native') // browser exclude
const utPex = require('ut_pex') // browser exclude

const File = require('./file')
const Peer = require('./peer')
const RarityMap = require('./rarity-map')
const Server = require('./server') // browser exclude
const WebConn = require('./webconn')

const MAX_BLOCK_LENGTH = 128 * 1024
const PIECE_TIMEOUT = 30000
const CHOKE_TIMEOUT = 5000
const SPEED_THRESHOLD = 3 * Piece.BLOCK_LENGTH

const PIPELINE_MIN_DURATION = 0.5
const PIPELINE_MAX_DURATION = 1

const RECHOKE_INTERVAL = 10000 // 10 seconds
const RECHOKE_OPTIMISTIC_DURATION = 2 // 30 seconds

// IndexedDB chunk stores used in the browser benefit from high concurrency
const FILESYSTEM_CONCURRENCY = process.browser ? cpus().length : 2

const RECONNECT_WAIT = [1000, 5000, 15000]

const VERSION = require('../package.json').version
const USER_AGENT = `WebTorrent/${VERSION} (https://webtorrent.io)`

let TMP
try {
  TMP = path.join(fs.statSync('/tmp') && '/tmp', 'webtorrent')
} catch (err) {
  TMP = path.join(typeof os.tmpdir === 'function' ? os.tmpdir() : '/', 'webtorrent')
}

class Torrent extends EventEmitter {
  constructor (torrentId, client, opts) {
    super()

    this._debugId = 'unknown infohash'
    this.client = client

    this.announce = opts.announce
    this.urlList = opts.urlList

    this.path = opts.path
    this.skipVerify = !!opts.skipVerify
    this._store = opts.store || FSChunkStore
    this._preloadedStore = opts.preloadedStore || null
    this._destroyStoreOnDestroy = opts.destroyStoreOnDestroy || false
    this._getAnnounceOpts = opts.getAnnounceOpts

    // if defined, `opts.private` overrides default privacy of torrent
    if (typeof opts.private === 'boolean') this.private = opts.private

    this.strategy = opts.strategy || 'sequential'

    this.maxWebConns = opts.maxWebConns || 4

    this._rechokeNumSlots = (opts.uploads === false || opts.uploads === 0)
      ? 0
      : (+opts.uploads || 10)
    this._rechokeOptimisticWire = null
    this._rechokeOptimisticTime = 0
    this._rechokeIntervalId = null

    this.ready = false
    this.destroyed = false
    this.paused = false
    this.done = false

    this.metadata = null
    this.store = null
    this.files = []
    this.pieces = []

    this._amInterested = false
    this._selections = []
    this._critical = []

    this.wires = [] // open wires (added *after* handshake)

    this._queue = [] // queue of outgoing tcp peers to connect to
    this._peers = {} // connected peers (addr/peerId -> Peer)
    this._peersLength = 0 // number of elements in `this._peers` (cache, for perf)

    // stats
    this.received = 0
    this.uploaded = 0
    this._downloadSpeed = speedometer()
    this._uploadSpeed = speedometer()

    // for cleanup
    this._servers = []
    this._xsRequests = []

    // TODO: remove this and expose a hook instead
    // optimization: don't recheck every file if it hasn't changed
    this._fileModtimes = opts.fileModtimes

    if (torrentId !== null) this._onTorrentId(torrentId)

    this._debug('new torrent')
  }

  get timeRemaining () {
    if (this.done) return 0
    if (this.downloadSpeed === 0) return Infinity
    return ((this.length - this.downloaded) / this.downloadSpeed) * 1000
  }

  get downloaded () {
    if (!this.bitfield) return 0
    let downloaded = 0
    for (let index = 0, len = this.pieces.length; index < len; ++index) {
      if (this.bitfield.get(index)) { // verified data
        downloaded += (index === len - 1) ? this.lastPieceLength : this.pieceLength
      } else { // "in progress" data
        const piece = this.pieces[index]
        downloaded += (piece.length - piece.missing)
      }
    }
    return downloaded
  }

  // TODO: re-enable this. The number of missing pieces. Used to implement 'end game' mode.
  // Object.defineProperty(Storage.prototype, 'numMissing', {
  //   get: function () {
  //     var self = this
  //     var numMissing = self.pieces.length
  //     for (var index = 0, len = self.pieces.length; index < len; index++) {
  //       numMissing -= self.bitfield.get(index)
  //     }
  //     return numMissing
  //   }
  // })

  get downloadSpeed () { return this._downloadSpeed() }

  get uploadSpeed () { return this._uploadSpeed() }

  get progress () { return this.length ? this.downloaded / this.length : 0 }

  get ratio () { return this.uploaded / (this.received || this.length) }

  get numPeers () { return this.wires.length }

  get torrentFileBlobURL () {
    if (typeof window === 'undefined') throw new Error('browser-only property')
    if (!this.torrentFile) return null
    return URL.createObjectURL(
      new Blob([this.torrentFile], { type: 'application/x-bittorrent' })
    )
  }

  get _numQueued () {
    return this._queue.length + (this._peersLength - this._numConns)
  }

  get _numConns () {
    let numConns = 0
    for (const id in this._peers) {
      if (this._peers[id].connected) numConns += 1
    }
    return numConns
  }

  // TODO: remove in v1
  get swarm () {
    console.warn('WebTorrent: `torrent.swarm` is deprecated. Use `torrent` directly instead.')
    return this
  }

  _onTorrentId (torrentId) {
    if (this.destroyed) return

    let parsedTorrent
    try { parsedTorrent = parseTorrent(torrentId) } catch (err) {}
    if (parsedTorrent) {
      // Attempt to set infoHash property synchronously
      this.infoHash = parsedTorrent.infoHash
      this._debugId = parsedTorrent.infoHash.toString('hex').substring(0, 7)
      queueMicrotask(() => {
        if (this.destroyed) return
        this._onParsedTorrent(parsedTorrent)
      })
    } else {
      // If torrentId failed to parse, it could be in a form that requires an async
      // operation, i.e. http/https link, filesystem path, or Blob.
      parseTorrent.remote(torrentId, (err, parsedTorrent) => {
        if (this.destroyed) return
        if (err) return this._destroy(err)
        this._onParsedTorrent(parsedTorrent)
      })
    }
  }

  _onParsedTorrent (parsedTorrent) {
    if (this.destroyed) return

    this._processParsedTorrent(parsedTorrent)

    if (!this.infoHash) {
      return this._destroy(new Error('Malformed torrent data: No info hash'))
    }

    if (!this.path) this.path = path.join(TMP, this.infoHash)

    this._rechokeIntervalId = setInterval(() => {
      this._rechoke()
    }, RECHOKE_INTERVAL)
    if (this._rechokeIntervalId.unref) this._rechokeIntervalId.unref()

    // Private 'infoHash' event allows client.add to check for duplicate torrents and
    // destroy them before the normal 'infoHash' event is emitted. Prevents user
    // applications from needing to deal with duplicate 'infoHash' events.
    this.emit('_infoHash', this.infoHash)
    if (this.destroyed) return

    this.emit('infoHash', this.infoHash)
    if (this.destroyed) return // user might destroy torrent in event handler

    if (this.client.listening) {
      this._onListening()
    } else {
      this.client.once('listening', () => {
        this._onListening()
      })
    }
  }

  _processParsedTorrent (parsedTorrent) {
    this._debugId = parsedTorrent.infoHash.toString('hex').substring(0, 7)

    if (typeof this.private !== 'undefined') {
      // `private` option overrides default, only if it's defined
      parsedTorrent.private = this.private
    }

    if (this.announce) {
      // Allow specifying trackers via `opts` parameter
      parsedTorrent.announce = parsedTorrent.announce.concat(this.announce)
    }

    if (this.client.tracker && global.WEBTORRENT_ANNOUNCE && !parsedTorrent.private) {
      // So `webtorrent-hybrid` can force specific trackers to be used
      parsedTorrent.announce = parsedTorrent.announce.concat(global.WEBTORRENT_ANNOUNCE)
    }

    if (this.urlList) {
      // Allow specifying web seeds via `opts` parameter
      parsedTorrent.urlList = parsedTorrent.urlList.concat(this.urlList)
    }

    // remove duplicates by converting to Set and back
    parsedTorrent.announce = Array.from(new Set(parsedTorrent.announce))
    parsedTorrent.urlList = Array.from(new Set(parsedTorrent.urlList))

    Object.assign(this, parsedTorrent)

    this.magnetURI = parseTorrent.toMagnetURI(parsedTorrent)
    this.torrentFile = parseTorrent.toTorrentFile(parsedTorrent)
  }

  _onListening () {
    if (this.destroyed) return

    if (this.info) {
      // if full metadata was included in initial torrent id, use it immediately. Otherwise,
      // wait for torrent-discovery to find peers and ut_metadata to get the metadata.
      this._onMetadata(this)
    } else {
      if (this.xs) this._getMetadataFromServer()
      this._startDiscovery()
    }
  }

  _startDiscovery () {
    if (this.discovery || this.destroyed) return

    let trackerOpts = this.client.tracker
    if (trackerOpts) {
      trackerOpts = Object.assign({}, this.client.tracker, {
        getAnnounceOpts: () => {
          const opts = {
            uploaded: this.uploaded,
            downloaded: this.downloaded,
            left: Math.max(this.length - this.downloaded, 0)
          }
          if (this.client.tracker.getAnnounceOpts) {
            Object.assign(opts, this.client.tracker.getAnnounceOpts())
          }
          if (this._getAnnounceOpts) {
            // TODO: consider deprecating this, as it's redundant with the former case
            Object.assign(opts, this._getAnnounceOpts())
          }
          return opts
        }
      })
    }

    // add BEP09 peer-address
    if (this.peerAddresses) {
      this.peerAddresses.forEach(peer => this.addPeer(peer))
    }

    // begin discovering peers via DHT and trackers
    this.discovery = new Discovery({
      infoHash: this.infoHash,
      announce: this.announce,
      peerId: this.client.peerId,
      dht: !this.private && this.client.dht,
      tracker: trackerOpts,
      port: this.client.torrentPort,
      userAgent: USER_AGENT,
      lsd: this.client.lsd
    })

    this.discovery.on('error', (err) => {
      this._destroy(err)
    })

    this.discovery.on('peer', (peer, source) => {
      this._debug('peer %s discovered via %s', peer, source)
      // Don't create new outgoing TCP connections when torrent is done
      if (typeof peer === 'string' && this.done) return
      this.addPeer(peer)
    })

    this.discovery.on('trackerAnnounce', () => {
      this.emit('trackerAnnounce')
      if (this.numPeers === 0) this.emit('noPeers', 'tracker')
    })

    this.discovery.on('dhtAnnounce', () => {
      this.emit('dhtAnnounce')
      if (this.numPeers === 0) this.emit('noPeers', 'dht')
    })

    this.discovery.on('warning', (err) => {
      this.emit('warning', err)
    })
  }

  _getMetadataFromServer () {
    // to allow function hoisting
    const self = this

    const urls = Array.isArray(this.xs) ? this.xs : [this.xs]

    const tasks = urls.map(url => cb => {
      getMetadataFromURL(url, cb)
    })
    parallel(tasks)

    function getMetadataFromURL (url, cb) {
      if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
        self.emit('warning', new Error(`skipping non-http xs param: ${url}`))
        return cb(null)
      }

      const opts = {
        url,
        method: 'GET',
        headers: {
          'user-agent': USER_AGENT
        }
      }
      let req
      try {
        req = get.concat(opts, onResponse)
      } catch (err) {
        self.emit('warning', new Error(`skipping invalid url xs param: ${url}`))
        return cb(null)
      }

      self._xsRequests.push(req)

      function onResponse (err, res, torrent) {
        if (self.destroyed) return cb(null)
        if (self.metadata) return cb(null)

        if (err) {
          self.emit('warning', new Error(`http error from xs param: ${url}`))
          return cb(null)
        }
        if (res.statusCode !== 200) {
          self.emit('warning', new Error(`non-200 status code ${res.statusCode} from xs param: ${url}`))
          return cb(null)
        }

        let parsedTorrent
        try {
          parsedTorrent = parseTorrent(torrent)
        } catch (err) {}

        if (!parsedTorrent) {
          self.emit('warning', new Error(`got invalid torrent file from xs param: ${url}`))
          return cb(null)
        }

        if (parsedTorrent.infoHash !== self.infoHash) {
          self.emit('warning', new Error(`got torrent file with incorrect info hash from xs param: ${url}`))
          return cb(null)
        }

        self._onMetadata(parsedTorrent)
        cb(null)
      }
    }
  }

  /**
   * Called when the full torrent metadata is received.
   */
  _onMetadata (metadata) {
    if (this.metadata || this.destroyed) return
    this._debug('got metadata')

    this._xsRequests.forEach(req => {
      req.abort()
    })
    this._xsRequests = []

    let parsedTorrent
    if (metadata && metadata.infoHash) {
      // `metadata` is a parsed torrent (from parse-torrent module)
      parsedTorrent = metadata
    } else {
      try {
        parsedTorrent = parseTorrent(metadata)
      } catch (err) {
        return this._destroy(err)
      }
    }

    this._processParsedTorrent(parsedTorrent)
    this.metadata = this.torrentFile

    // add web seed urls (BEP19)
    if (this.client.enableWebSeeds) {
      this.urlList.forEach(url => {
        this.addWebSeed(url)
      })
    }

    this._rarityMap = new RarityMap(this)

    this.store = new ImmediateChunkStore(
      this._preloadedStore || new this._store(this.pieceLength, {
        torrent: {
          infoHash: this.infoHash
        },
        files: this.files.map(file => ({
          path: path.join(this.path, file.path),
          length: file.length,
          offset: file.offset
        })),
        length: this.length,
        name: this.infoHash
      })
    )

    this.files = this.files.map(file => new File(this, file))

    // Select only specified files (BEP53) http://www.bittorrent.org/beps/bep_0053.html
    if (this.so) {
      this.files.forEach((v, i) => {
        if (this.so.includes(i)) {
          this.files[i].select()
        } else {
          this.files[i].deselect()
        }
      })
    } else {
      // start off selecting the entire torrent with low priority
      if (this.pieces.length !== 0) {
        this.select(0, this.pieces.length - 1, false)
      }
    }

    this._hashes = this.pieces

    this.pieces = this.pieces.map((hash, i) => {
      const pieceLength = (i === this.pieces.length - 1)
        ? this.lastPieceLength
        : this.pieceLength
      return new Piece(pieceLength)
    })

    this._reservations = this.pieces.map(() => [])

    this.bitfield = new BitField(this.pieces.length)

    this.wires.forEach(wire => {
      // If we didn't have the metadata at the time ut_metadata was initialized for this
      // wire, we still want to make it available to the peer in case they request it.
      if (wire.ut_metadata) wire.ut_metadata.setMetadata(this.metadata)

      this._onWireWithMetadata(wire)
    })

    // Emit 'metadata' before 'ready' and 'done'
    this.emit('metadata')

    // User might destroy torrent in response to 'metadata' event
    if (this.destroyed) return

    if (this.skipVerify) {
      // Skip verifying exisitng data and just assume it's correct
      this._markAllVerified()
      this._onStore()
    } else {
      const onPiecesVerified = (err) => {
        if (err) return this._destroy(err)
        this._debug('done verifying')
        this._onStore()
      }

      this._debug('verifying existing torrent data')
      if (this._fileModtimes && this._store === FSChunkStore) {
        // don't verify if the files haven't been modified since we last checked
        this.getFileModtimes((err, fileModtimes) => {
          if (err) return this._destroy(err)

          const unchanged = this.files.map((_, index) => fileModtimes[index] === this._fileModtimes[index]).every(x => x)

          if (unchanged) {
            this._markAllVerified()
            this._onStore()
          } else {
            this._verifyPieces(onPiecesVerified)
          }
        })
      } else {
        this._verifyPieces(onPiecesVerified)
      }
    }
  }

  /*
   * TODO: remove this
   * Gets the last modified time of every file on disk for this torrent.
   * Only valid in Node, not in the browser.
   */
  getFileModtimes (cb) {
    const ret = []
    parallelLimit(this.files.map((file, index) => cb => {
      fs.stat(path.join(this.path, file.path), (err, stat) => {
        if (err && err.code !== 'ENOENT') return cb(err)
        ret[index] = stat && stat.mtime.getTime()
        cb(null)
      })
    }), FILESYSTEM_CONCURRENCY, err => {
      this._debug('done getting file modtimes')
      cb(err, ret)
    })
  }

  _verifyPieces (cb) {
    parallelLimit(this.pieces.map((piece, index) => cb => {
      if (this.destroyed) return cb(new Error('torrent is destroyed'))

      const getOpts = {}
      // Specify length for the last piece in case it is zero-padded
      if (index === this.pieces.length - 1) {
        getOpts.length = this.lastPieceLength
      }
      this.store.get(index, getOpts, (err, buf) => {
        if (this.destroyed) return cb(new Error('torrent is destroyed'))

        if (err) return queueMicrotask(() => cb(null)) // ignore error
        sha1(buf, hash => {
          if (this.destroyed) return cb(new Error('torrent is destroyed'))

          if (hash === this._hashes[index]) {
            this._debug('piece verified %s', index)
            this._markVerified(index)
          } else {
            this._debug('piece invalid %s', index)
          }
          cb(null)
        })
      })
    }), FILESYSTEM_CONCURRENCY, cb)
  }

  rescanFiles (cb) {
    if (this.destroyed) throw new Error('torrent is destroyed')
    if (!cb) cb = noop

    this._verifyPieces((err) => {
      if (err) {
        this._destroy(err)
        return cb(err)
      }

      this._checkDone()
      cb(null)
    })
  }

  _markAllVerified () {
    for (let index = 0; index < this.pieces.length; index++) {
      this._markVerified(index)
    }
  }

  _markVerified (index) {
    this.pieces[index] = null
    this._reservations[index] = null
    this.bitfield.set(index, true)
  }

  /**
   * Called when the metadata, listening server, and underlying chunk store is initialized.
   */
  _onStore () {
    if (this.destroyed) return
    this._debug('on store')

    // Start discovery before emitting 'ready'
    this._startDiscovery()

    this.ready = true
    this.emit('ready')

    // Files may start out done if the file was already in the store
    this._checkDone()

    // In case any selections were made before torrent was ready
    this._updateSelections()
  }

  destroy (opts, cb) {
    if (typeof opts === 'function') return this.destroy(null, opts)

    this._destroy(null, opts, cb)
  }

  _destroy (err, opts, cb) {
    if (typeof opts === 'function') return this._destroy(err, null, opts)
    if (this.destroyed) return
    this.destroyed = true
    this._debug('destroy')

    this.client._remove(this)

    clearInterval(this._rechokeIntervalId)

    this._xsRequests.forEach(req => {
      req.abort()
    })

    if (this._rarityMap) {
      this._rarityMap.destroy()
    }

    for (const id in this._peers) {
      this.removePeer(id)
    }

    this.files.forEach(file => {
      if (file instanceof File) file._destroy()
    })

    const tasks = this._servers.map(server => cb => {
      server.destroy(cb)
    })

    if (this.discovery) {
      tasks.push(cb => {
        this.discovery.destroy(cb)
      })
    }

    if (this.store) {
      let destroyStore = this._destroyStoreOnDestroy
      if (opts && opts.destroyStore !== undefined) {
        destroyStore = opts.destroyStore
      }
      tasks.push(cb => {
        if (destroyStore) {
          this.store.destroy(cb)
        } else {
          this.store.close(cb)
        }
      })
    }

    parallel(tasks, cb)

    if (err) {
      // Torrent errors are emitted at `torrent.on('error')`. If there are no 'error'
      // event handlers on the torrent instance, then the error will be emitted at
      // `client.on('error')`. This prevents throwing an uncaught exception
      // (unhandled 'error' event), but it makes it impossible to distinguish client
      // errors versus torrent errors. Torrent errors are not fatal, and the client
      // is still usable afterwards. Therefore, always listen for errors in both
      // places (`client.on('error')` and `torrent.on('error')`).
      if (this.listenerCount('error') === 0) {
        this.client.emit('error', err)
      } else {
        this.emit('error', err)
      }
    }

    this.emit('close')

    this.client = null
    this.files = []
    this.discovery = null
    this.store = null
    this._rarityMap = null
    this._peers = null
    this._servers = null
    this._xsRequests = null
  }

  addPeer (peer) {
    if (this.destroyed) throw new Error('torrent is destroyed')
    if (!this.infoHash) throw new Error('addPeer() must not be called before the `infoHash` event')

    if (this.client.blocked) {
      let host
      if (typeof peer === 'string') {
        let parts
        try {
          parts = addrToIPPort(peer)
        } catch (e) {
          this._debug('ignoring peer: invalid %s', peer)
          this.emit('invalidPeer', peer)
          return false
        }
        host = parts[0]
      } else if (typeof peer.remoteAddress === 'string') {
        host = peer.remoteAddress
      }

      if (host && this.client.blocked.contains(host)) {
        this._debug('ignoring peer: blocked %s', peer)
        if (typeof peer !== 'string') peer.destroy()
        this.emit('blockedPeer', peer)
        return false
      }
    }

    // if the utp connection fails to connect, then it is replaced with a tcp connection to the same ip:port
    const wasAdded = !!this._addPeer(peer, this.client.utp ? 'utp' : 'tcp')
    if (wasAdded) {
      this.emit('peer', peer)
    } else {
      this.emit('invalidPeer', peer)
    }
    return wasAdded
  }

  _addPeer (peer, type) {
    if (this.destroyed) {
      if (typeof peer !== 'string') peer.destroy()
      return null
    }
    if (typeof peer === 'string' && !this._validAddr(peer)) {
      this._debug('ignoring peer: invalid %s', peer)
      return null
    }

    const id = (peer && peer.id) || peer
    if (this._peers[id]) {
      this._debug('ignoring peer: duplicate (%s)', id)
      if (typeof peer !== 'string') peer.destroy()
      return null
    }

    if (this.paused) {
      this._debug('ignoring peer: torrent is paused')
      if (typeof peer !== 'string') peer.destroy()
      return null
    }

    this._debug('add peer %s', id)

    let newPeer
    if (typeof peer === 'string') {
      // `peer` is an addr ("ip:port" string)
      newPeer = type === 'utp' ? Peer.createUTPOutgoingPeer(peer, this) : Peer.createTCPOutgoingPeer(peer, this)
    } else {
      // `peer` is a WebRTC connection (simple-peer)
      newPeer = Peer.createWebRTCPeer(peer, this)
    }

    this._peers[newPeer.id] = newPeer
    this._peersLength += 1

    if (typeof peer === 'string') {
      // `peer` is an addr ("ip:port" string)
      this._queue.push(newPeer)
      this._drain()
    }

    return newPeer
  }

  addWebSeed (urlOrConn) {
    if (this.destroyed) throw new Error('torrent is destroyed')

    let id
    let conn
    if (typeof urlOrConn === 'string') {
      id = urlOrConn

      if (!/^https?:\/\/.+/.test(id)) {
        this.emit('warning', new Error(`ignoring invalid web seed: ${id}`))
        this.emit('invalidPeer', id)
        return
      }

      if (this._peers[id]) {
        this.emit('warning', new Error(`ignoring duplicate web seed: ${id}`))
        this.emit('invalidPeer', id)
        return
      }

      conn = new WebConn(id, this)
    } else if (urlOrConn && typeof urlOrConn.connId === 'string') {
      conn = urlOrConn
      id = conn.connId

      if (this._peers[id]) {
        this.emit('warning', new Error(`ignoring duplicate web seed: ${id}`))
        this.emit('invalidPeer', id)
        return
      }
    } else {
      this.emit('warning', new Error('addWebSeed must be passed a string or connection object with id property'))
      return
    }

    this._debug('add web seed %s', id)

    const newPeer = Peer.createWebSeedPeer(conn, id, this)
    this._peers[newPeer.id] = newPeer
    this._peersLength += 1

    this.emit('peer', id)
  }

  /**
   * Called whenever a new incoming TCP peer connects to this torrent swarm. Called with a
   * peer that has already sent a handshake.
   */
  _addIncomingPeer (peer) {
    if (this.destroyed) return peer.destroy(new Error('torrent is destroyed'))
    if (this.paused) return peer.destroy(new Error('torrent is paused'))

    this._debug('add incoming peer %s', peer.id)

    this._peers[peer.id] = peer
    this._peersLength += 1
  }

  removePeer (peer) {
    const id = (peer && peer.id) || peer
    peer = this._peers[id]

    if (!peer) return

    this._debug('removePeer %s', id)

    delete this._peers[id]
    this._peersLength -= 1

    peer.destroy()

    // If torrent swarm was at capacity before, try to open a new connection now
    this._drain()
  }

  select (start, end, priority, notify) {
    if (this.destroyed) throw new Error('torrent is destroyed')

    if (start < 0 || end < start || this.pieces.length <= end) {
      throw new Error(`invalid selection ${start} : ${end}`)
    }
    priority = Number(priority) || 0

    this._debug('select %s-%s (priority %s)', start, end, priority)

    this._selections.push({
      from: start,
      to: end,
      offset: 0,
      priority,
      notify: notify || noop
    })

    this._selections.sort((a, b) => b.priority - a.priority)

    this._updateSelections()
  }

  deselect (start, end, priority) {
    if (this.destroyed) throw new Error('torrent is destroyed')

    priority = Number(priority) || 0
    this._debug('deselect %s-%s (priority %s)', start, end, priority)

    for (let i = 0; i < this._selections.length; ++i) {
      const s = this._selections[i]
      if (s.from === start && s.to === end && s.priority === priority) {
        this._selections.splice(i, 1)
        break
      }
    }

    this._updateSelections()
  }

  critical (start, end) {
    if (this.destroyed) throw new Error('torrent is destroyed')

    this._debug('critical %s-%s', start, end)

    for (let i = start; i <= end; ++i) {
      this._critical[i] = true
    }

    this._updateSelections()
  }

  _onWire (wire, addr) {
    this._debug('got wire %s (%s)', wire._debugId, addr || 'Unknown')

    wire.on('download', downloaded => {
      if (this.destroyed) return
      this.received += downloaded
      this._downloadSpeed(downloaded)
      this.client._downloadSpeed(downloaded)
      this.emit('download', downloaded)
      if (this.destroyed) return
      this.client.emit('download', downloaded)
    })

    wire.on('upload', uploaded => {
      if (this.destroyed) return
      this.uploaded += uploaded
      this._uploadSpeed(uploaded)
      this.client._uploadSpeed(uploaded)
      this.emit('upload', uploaded)
      if (this.destroyed) return
      this.client.emit('upload', uploaded)
    })

    this.wires.push(wire)

    if (addr) {
      // Sometimes RTCPeerConnection.getStats() doesn't return an ip:port for peers
      const parts = addrToIPPort(addr)
      wire.remoteAddress = parts[0]
      wire.remotePort = parts[1]
    }

    // When peer sends PORT message, add that DHT node to routing table
    if (this.client.dht && this.client.dht.listening) {
      wire.on('port', port => {
        if (this.destroyed || this.client.dht.destroyed) {
          return
        }
        if (!wire.remoteAddress) {
          return this._debug('ignoring PORT from peer with no address')
        }
        if (port === 0 || port > 65536) {
          return this._debug('ignoring invalid PORT from peer')
        }

        this._debug('port: %s (from %s)', port, addr)
        this.client.dht.addNode({ host: wire.remoteAddress, port })
      })
    }

    wire.on('timeout', () => {
      this._debug('wire timeout (%s)', addr)
      // TODO: this might be destroying wires too eagerly
      wire.destroy()
    })

    // Timeout for piece requests to this peer
    if (wire.type !== 'webSeed') { // webseeds always send 'unhave' on http timeout
      wire.setTimeout(PIECE_TIMEOUT, true)
    }

    // Send KEEP-ALIVE (every 60s) so peers will not disconnect the wire
    wire.setKeepAlive(true)

    // use ut_metadata extension
    wire.use(utMetadata(this.metadata))

    wire.ut_metadata.on('warning', err => {
      this._debug('ut_metadata warning: %s', err.message)
    })

    if (!this.metadata) {
      wire.ut_metadata.on('metadata', metadata => {
        this._debug('got metadata via ut_metadata')
        this._onMetadata(metadata)
      })
      wire.ut_metadata.fetch()
    }

    // use ut_pex extension if the torrent is not flagged as private
    if (typeof utPex === 'function' && !this.private) {
      wire.use(utPex())

      wire.ut_pex.on('peer', peer => {
        // Only add potential new peers when we're not seeding
        if (this.done) return
        this._debug('ut_pex: got peer: %s (from %s)', peer, addr)
        this.addPeer(peer)
      })

      wire.ut_pex.on('dropped', peer => {
        // the remote peer believes a given peer has been dropped from the torrent swarm.
        // if we're not currently connected to it, then remove it from the queue.
        const peerObj = this._peers[peer]
        if (peerObj && !peerObj.connected) {
          this._debug('ut_pex: dropped peer: %s (from %s)', peer, addr)
          this.removePeer(peer)
        }
      })

      wire.once('close', () => {
        // Stop sending updates to remote peer
        wire.ut_pex.reset()
      })
    }

    wire.use(ltDontHave())

    // Hook to allow user-defined `bittorrent-protocol` extensions
    // More info: https://github.com/webtorrent/bittorrent-protocol#extension-api
    this.emit('wire', wire, addr)

    if (this.metadata) {
      queueMicrotask(() => {
        // This allows wire.handshake() to be called (by Peer.onHandshake) before any
        // messages get sent on the wire
        this._onWireWithMetadata(wire)
      })
    }
  }

  _onWireWithMetadata (wire) {
    let timeoutId = null

    const onChokeTimeout = () => {
      if (this.destroyed || wire.destroyed) return

      if (this._numQueued > 2 * (this._numConns - this.numPeers) &&
        wire.amInterested) {
        wire.destroy()
      } else {
        timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT)
        if (timeoutId.unref) timeoutId.unref()
      }
    }

    let i
    const updateSeedStatus = () => {
      if (wire.peerPieces.buffer.length !== this.bitfield.buffer.length) return
      for (i = 0; i < this.pieces.length; ++i) {
        if (!wire.peerPieces.get(i)) return
      }
      wire.isSeeder = true
      wire.choke() // always choke seeders
    }

    wire.on('bitfield', () => {
      updateSeedStatus()
      this._update()
      this._updateWireInterest(wire)
    })

    wire.on('have', () => {
      updateSeedStatus()
      this._update()
      this._updateWireInterest(wire)
    })

    wire.lt_donthave.on('donthave', () => {
      updateSeedStatus()
      this._update()
      this._updateWireInterest(wire)
    })

    wire.once('interested', () => {
      wire.unchoke()
    })

    wire.once('close', () => {
      clearTimeout(timeoutId)
    })

    wire.on('choke', () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT)
      if (timeoutId.unref) timeoutId.unref()
    })

    wire.on('unchoke', () => {
      clearTimeout(timeoutId)
      this._update()
    })

    wire.on('request', (index, offset, length, cb) => {
      if (length > MAX_BLOCK_LENGTH) {
        // Per spec, disconnect from peers that request >128KB
        return wire.destroy()
      }
      if (this.pieces[index]) return
      this.store.get(index, { offset, length }, cb)
    })

    wire.bitfield(this.bitfield) // always send bitfield (required)

    // initialize interest in case bitfield message was already received before above handler was registered
    this._updateWireInterest(wire)

    // Send PORT message to peers that support DHT
    if (wire.peerExtensions.dht && this.client.dht && this.client.dht.listening) {
      wire.port(this.client.dht.address().port)
    }

    if (wire.type !== 'webSeed') { // do not choke on webseeds
      timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT)
      if (timeoutId.unref) timeoutId.unref()
    }

    wire.isSeeder = false
    updateSeedStatus()
  }

  /**
   * Called on selection changes.
   */
  _updateSelections () {
    if (!this.ready || this.destroyed) return

    queueMicrotask(() => {
      this._gcSelections()
    })
    this._updateInterest()
    this._update()
  }

  /**
   * Garbage collect selections with respect to the store's current state.
   */
  _gcSelections () {
    for (let i = 0; i < this._selections.length; ++i) {
      const s = this._selections[i]
      const oldOffset = s.offset

      // check for newly downloaded pieces in selection
      while (this.bitfield.get(s.from + s.offset) && s.from + s.offset < s.to) {
        s.offset += 1
      }

      if (oldOffset !== s.offset) s.notify()
      if (s.to !== s.from + s.offset) continue
      if (!this.bitfield.get(s.from + s.offset)) continue

      this._selections.splice(i, 1) // remove fully downloaded selection
      i -= 1 // decrement i to offset splice

      s.notify()
      this._updateInterest()
    }

    if (!this._selections.length) this.emit('idle')
  }

  /**
   * Update interested status for all peers.
   */
  _updateInterest () {
    const prev = this._amInterested
    this._amInterested = !!this._selections.length

    this.wires.forEach(wire => this._updateWireInterest(wire))

    if (prev === this._amInterested) return
    if (this._amInterested) this.emit('interested')
    else this.emit('uninterested')
  }

  _updateWireInterest (wire) {
    let interested = false
    for (let index = 0; index < this.pieces.length; ++index) {
      if (this.pieces[index] && wire.peerPieces.get(index)) {
        interested = true
        break
      }
    }

    if (interested) wire.interested()
    else wire.uninterested()
  }

  /**
   * Heartbeat to update all peers and their requests.
   */
  _update () {
    if (this.destroyed) return

    // update wires in random order for better request distribution
    const ite = randomIterate(this.wires)
    let wire
    while ((wire = ite())) {
      this._updateWireWrapper(wire)
    }
  }

  _updateWireWrapper (wire) {
    const self = this

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(function () { self._updateWire(wire) }, { timeout: 250 })
    } else {
      self._updateWire(wire)
    }
  }

  /**
   * Attempts to update a peer's requests
   */
  _updateWire (wire) {
    // to allow function hoisting
    const self = this

    if (wire.peerChoking) return
    if (!wire.downloaded) return validateWire()

    const minOutstandingRequests = getBlockPipelineLength(wire, PIPELINE_MIN_DURATION)
    if (wire.requests.length >= minOutstandingRequests) return
    const maxOutstandingRequests = getBlockPipelineLength(wire, PIPELINE_MAX_DURATION)

    trySelectWire(false) || trySelectWire(true)

    function genPieceFilterFunc (start, end, tried, rank) {
      return i => i >= start && i <= end && !(i in tried) && wire.peerPieces.get(i) && (!rank || rank(i))
    }

    // TODO: Do we need both validateWire and trySelectWire?
    function validateWire () {
      if (wire.requests.length) return

      let i = self._selections.length
      while (i--) {
        const next = self._selections[i]
        let piece
        if (self.strategy === 'rarest') {
          const start = next.from + next.offset
          const end = next.to
          const len = end - start + 1
          const tried = {}
          let tries = 0
          const filter = genPieceFilterFunc(start, end, tried)

          while (tries < len) {
            piece = self._rarityMap.getRarestPiece(filter)
            if (piece < 0) break
            if (self._request(wire, piece, false)) return
            tried[piece] = true
            tries += 1
          }
        } else {
          for (piece = next.to; piece >= next.from + next.offset; --piece) {
            if (!wire.peerPieces.get(piece)) continue
            if (self._request(wire, piece, false)) return
          }
        }
      }

      // TODO: wire failed to validate as useful; should we close it?
      // probably not, since 'have' and 'bitfield' messages might be coming
    }

    function speedRanker () {
      const speed = wire.downloadSpeed() || 1
      if (speed > SPEED_THRESHOLD) return () => true

      const secs = Math.max(1, wire.requests.length) * Piece.BLOCK_LENGTH / speed
      let tries = 10
      let ptr = 0

      return index => {
        if (!tries || self.bitfield.get(index)) return true

        let missing = self.pieces[index].missing

        for (; ptr < self.wires.length; ptr++) {
          const otherWire = self.wires[ptr]
          const otherSpeed = otherWire.downloadSpeed()

          if (otherSpeed < SPEED_THRESHOLD) continue
          if (otherSpeed <= speed) continue
          if (!otherWire.peerPieces.get(index)) continue
          if ((missing -= otherSpeed * secs) > 0) continue

          tries--
          return false
        }

        return true
      }
    }

    function shufflePriority (i) {
      let last = i
      for (let j = i; j < self._selections.length && self._selections[j].priority; j++) {
        last = j
      }
      const tmp = self._selections[i]
      self._selections[i] = self._selections[last]
      self._selections[last] = tmp
    }

    function trySelectWire (hotswap) {
      if (wire.requests.length >= maxOutstandingRequests) return true
      const rank = speedRanker()

      for (let i = 0; i < self._selections.length; i++) {
        const next = self._selections[i]

        let piece
        if (self.strategy === 'rarest') {
          const start = next.from + next.offset
          const end = next.to
          const len = end - start + 1
          const tried = {}
          let tries = 0
          const filter = genPieceFilterFunc(start, end, tried, rank)

          while (tries < len) {
            piece = self._rarityMap.getRarestPiece(filter)
            if (piece < 0) break

            while (self._request(wire, piece, self._critical[piece] || hotswap)) {
              // body intentionally empty
              // request all non-reserved blocks in this piece
            }

            if (wire.requests.length < maxOutstandingRequests) {
              tried[piece] = true
              tries++
              continue
            }

            if (next.priority) shufflePriority(i)
            return true
          }
        } else {
          for (piece = next.from + next.offset; piece <= next.to; piece++) {
            if (!wire.peerPieces.get(piece) || !rank(piece)) continue

            while (self._request(wire, piece, self._critical[piece] || hotswap)) {
              // body intentionally empty
              // request all non-reserved blocks in piece
            }

            if (wire.requests.length < maxOutstandingRequests) continue

            if (next.priority) shufflePriority(i)
            return true
          }
        }
      }

      return false
    }
  }

  /**
   * Called periodically to update the choked status of all peers, handling optimistic
   * unchoking as described in BEP3.
   */
  _rechoke () {
    if (!this.ready) return

    // wires in increasing order of quality (pop() gives next best peer)
    const wireStack =
      this.wires
        .map(wire => ({ wire, random: Math.random() })) // insert a random seed for randomizing the sort
        .sort((objA, objB) => {
          const wireA = objA.wire
          const wireB = objB.wire

          // prefer peers that send us data faster
          if (wireA.downloadSpeed() !== wireB.downloadSpeed()) {
            return wireA.downloadSpeed() - wireB.downloadSpeed()
          }

          // then prefer peers that can download data from us faster
          if (wireA.uploadSpeed() !== wireB.uploadSpeed()) {
            return wireA.uploadSpeed() - wireB.uploadSpeed()
          }

          // then prefer already unchoked peers (to minimize fibrillation)
          if (wireA.amChoking !== wireB.amChoking) {
            return wireA.amChoking ? -1 : 1 // choking < unchoked
          }

          // otherwise random order
          return objA.random - objB.random
        })
        .map(obj => obj.wire) // return array of wires (remove random seed)

    if (this._rechokeOptimisticTime <= 0) {
      // clear old optimistic peer, so it can be rechoked normally and then replaced
      this._rechokeOptimisticWire = null
    } else {
      this._rechokeOptimisticTime -= 1
    }

    let numInterestedUnchoked = 0
    // leave one rechoke slot open for optimistic unchoking
    while (wireStack.length > 0 && numInterestedUnchoked < this._rechokeNumSlots - 1) {
      const wire = wireStack.pop() // next best quality peer

      if (wire.isSeeder || wire === this._rechokeOptimisticWire) {
        continue
      }

      wire.unchoke()

      // only stop unchoking once we fill the slots with interested peers that will actually download
      if (wire.peerInterested) {
        numInterestedUnchoked++
      }
    }

    // fill optimistic unchoke slot if empty
    if (this._rechokeOptimisticWire === null && this._rechokeNumSlots > 0) {
      // don't optimistically unchoke uninterested peers
      const remaining = wireStack.filter(wire => wire.peerInterested)

      if (remaining.length > 0) {
        // select random remaining (not yet unchoked) peer
        const newOptimisticPeer = remaining[randomInt(remaining.length)]

        newOptimisticPeer.unchoke()

        this._rechokeOptimisticWire = newOptimisticPeer

        this._rechokeOptimisticTime = RECHOKE_OPTIMISTIC_DURATION
      }
    }

    // choke the rest
    wireStack
      .filter(wire => wire !== this._rechokeOptimisticWire) // except the optimistically unchoked peer
      .forEach(wire => wire.choke())
  }

  /**
   * Attempts to cancel a slow block request from another wire such that the
   * given wire may effectively swap out the request for one of its own.
   */
  _hotswap (wire, index) {
    const speed = wire.downloadSpeed()
    if (speed < Piece.BLOCK_LENGTH) return false
    if (!this._reservations[index]) return false

    const r = this._reservations[index]
    if (!r) {
      return false
    }

    let minSpeed = Infinity
    let minWire

    let i
    for (i = 0; i < r.length; i++) {
      const otherWire = r[i]
      if (!otherWire || otherWire === wire) continue

      const otherSpeed = otherWire.downloadSpeed()
      if (otherSpeed >= SPEED_THRESHOLD) continue
      if (2 * otherSpeed > speed || otherSpeed > minSpeed) continue

      minWire = otherWire
      minSpeed = otherSpeed
    }

    if (!minWire) return false

    for (i = 0; i < r.length; i++) {
      if (r[i] === minWire) r[i] = null
    }

    for (i = 0; i < minWire.requests.length; i++) {
      const req = minWire.requests[i]
      if (req.piece !== index) continue

      this.pieces[index].cancel((req.offset / Piece.BLOCK_LENGTH) | 0)
    }

    this.emit('hotswap', minWire, wire, index)
    return true
  }

  /**
   * Attempts to request a block from the given wire.
   */
  _request (wire, index, hotswap) {
    const self = this
    const numRequests = wire.requests.length
    const isWebSeed = wire.type === 'webSeed'

    if (self.bitfield.get(index)) return false

    const maxOutstandingRequests = isWebSeed
      ? Math.min(
          getPiecePipelineLength(wire, PIPELINE_MAX_DURATION, self.pieceLength),
          self.maxWebConns
        )
      : getBlockPipelineLength(wire, PIPELINE_MAX_DURATION)

    if (numRequests >= maxOutstandingRequests) return false
    // var endGame = (wire.requests.length === 0 && self.store.numMissing < 30)

    const piece = self.pieces[index]
    let reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve()

    if (reservation === -1 && hotswap && self._hotswap(wire, index)) {
      reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve()
    }
    if (reservation === -1) return false

    let r = self._reservations[index]
    if (!r) r = self._reservations[index] = []
    let i = r.indexOf(null)
    if (i === -1) i = r.length
    r[i] = wire

    const chunkOffset = piece.chunkOffset(reservation)
    const chunkLength = isWebSeed ? piece.chunkLengthRemaining(reservation) : piece.chunkLength(reservation)

    wire.request(index, chunkOffset, chunkLength, function onChunk (err, chunk) {
      if (self.destroyed) return

      // TODO: what is this for?
      if (!self.ready) return self.once('ready', () => { onChunk(err, chunk) })

      if (r[i] === wire) r[i] = null

      if (piece !== self.pieces[index]) return onUpdateTick()

      if (err) {
        self._debug(
          'error getting piece %s (offset: %s length: %s) from %s: %s',
          index, chunkOffset, chunkLength, `${wire.remoteAddress}:${wire.remotePort}`,
          err.message
        )
        isWebSeed ? piece.cancelRemaining(reservation) : piece.cancel(reservation)
        onUpdateTick()
        return
      }

      self._debug(
        'got piece %s (offset: %s length: %s) from %s',
        index, chunkOffset, chunkLength, `${wire.remoteAddress}:${wire.remotePort}`
      )

      if (!piece.set(reservation, chunk, wire)) return onUpdateTick()

      const buf = piece.flush()

      // TODO: might need to set self.pieces[index] = null here since sha1 is async

      sha1(buf, hash => {
        if (self.destroyed) return

        if (hash === self._hashes[index]) {
          if (!self.pieces[index]) return
          self._debug('piece verified %s', index)

          self.pieces[index] = null
          self._reservations[index] = null
          self.bitfield.set(index, true)

          self.store.put(index, buf, err => {
            if (err) self._destroy(err)
          })

          self.wires.forEach(wire => {
            wire.have(index)
          })

          // We also check `self.destroyed` since `torrent.destroy()` could have been
          // called in the `torrent.on('done')` handler, triggered by `_checkDone()`.
          if (self._checkDone() && !self.destroyed) self.discovery.complete()
        } else {
          self.pieces[index] = new Piece(piece.length)
          self.emit('warning', new Error(`Piece ${index} failed verification`))
        }
        onUpdateTick()
      })
    })

    function onUpdateTick () {
      queueMicrotask(() => { self._update() })
    }

    return true
  }

  _checkDone () {
    if (this.destroyed) return

    // are any new files done?
    this.files.forEach(file => {
      if (file.done) return
      for (let i = file._startPiece; i <= file._endPiece; ++i) {
        if (!this.bitfield.get(i)) return
      }
      file.done = true
      file.emit('done')
      this._debug(`file done: ${file.name}`)
    })

    // is the torrent done? (if all current selections are satisfied, or there are
    // no selections, then torrent is done)
    let done = true
    for (let i = 0; i < this._selections.length; i++) {
      const selection = this._selections[i]
      for (let piece = selection.from; piece <= selection.to; piece++) {
        if (!this.bitfield.get(piece)) {
          done = false
          break
        }
      }
      if (!done) break
    }
    if (!this.done && done) {
      this.done = true
      this._debug(`torrent done: ${this.infoHash}`)
      this.emit('done')
    }
    this._gcSelections()

    return done
  }

  load (streams, cb) {
    if (this.destroyed) throw new Error('torrent is destroyed')
    if (!this.ready) return this.once('ready', () => { this.load(streams, cb) })

    if (!Array.isArray(streams)) streams = [streams]
    if (!cb) cb = noop

    const readable = new MultiStream(streams)
    const writable = new ChunkStoreWriteStream(this.store, this.pieceLength)

    pump(readable, writable, err => {
      if (err) return cb(err)
      this._markAllVerified()
      this._checkDone()
      cb(null)
    })
  }

  createServer (requestListener) {
    if (typeof Server !== 'function') throw new Error('node.js-only method')
    if (this.destroyed) throw new Error('torrent is destroyed')
    const server = new Server(this, requestListener)
    this._servers.push(server)
    return server
  }

  pause () {
    if (this.destroyed) return
    this._debug('pause')
    this.paused = true
  }

  resume () {
    if (this.destroyed) return
    this._debug('resume')
    this.paused = false
    this._drain()
  }

  _debug () {
    const args = [].slice.call(arguments)
    args[0] = `[${this.client ? this.client._debugId : 'No Client'}] [${this._debugId}] ${args[0]}`
    debug(...args)
  }

  /**
   * Pop a peer off the FIFO queue and connect to it. When _drain() gets called,
   * the queue will usually have only one peer in it, except when there are too
   * many peers (over `this.maxConns`) in which case they will just sit in the
   * queue until another connection closes.
   */
  _drain () {
    this._debug('_drain numConns %s maxConns %s', this._numConns, this.client.maxConns)
    if (typeof net.connect !== 'function' || this.destroyed || this.paused ||
        this._numConns >= this.client.maxConns) {
      return
    }
    this._debug('drain (%s queued, %s/%s peers)', this._numQueued, this.numPeers, this.client.maxConns)

    const peer = this._queue.shift()
    if (!peer) return // queue could be empty

    this._debug('%s connect attempt to %s', peer.type, peer.addr)

    const parts = addrToIPPort(peer.addr)
    const opts = {
      host: parts[0],
      port: parts[1]
    }

    if (peer.type === 'utpOutgoing') {
      peer.conn = utp.connect(opts.port, opts.host)
    } else {
      peer.conn = net.connect(opts)
    }

    const conn = peer.conn

    conn.once('connect', () => { peer.onConnect() })
    conn.once('error', err => { peer.destroy(err) })
    peer.startConnectTimeout()

    // When connection closes, attempt reconnect after timeout (with exponential backoff)
    conn.on('close', () => {
      if (this.destroyed) return

      if (peer.retries >= RECONNECT_WAIT.length) {
        if (this.client.utp) {
          const newPeer = this._addPeer(peer.addr, 'tcp')
          if (newPeer) newPeer.retries = 0
        } else {
          this._debug(
            'conn %s closed: will not re-add (max %s attempts)',
            peer.addr, RECONNECT_WAIT.length
          )
        }
        return
      }

      const ms = RECONNECT_WAIT[peer.retries]
      this._debug(
        'conn %s closed: will re-add to queue in %sms (attempt %s)',
        peer.addr, ms, peer.retries + 1
      )

      const reconnectTimeout = setTimeout(() => {
        if (this.destroyed) return
        const newPeer = this._addPeer(peer.addr, this.client.utp ? 'utp' : 'tcp')
        if (newPeer) newPeer.retries = peer.retries + 1
      }, ms)
      if (reconnectTimeout.unref) reconnectTimeout.unref()
    })
  }

  /**
   * Returns `true` if string is valid IPv4/6 address.
   * @param {string} addr
   * @return {boolean}
   */
  _validAddr (addr) {
    let parts
    try {
      parts = addrToIPPort(addr)
    } catch (e) {
      return false
    }
    const host = parts[0]
    const port = parts[1]
    return port > 0 && port < 65535 &&
      !(host === '127.0.0.1' && port === this.client.torrentPort)
  }
}

function getBlockPipelineLength (wire, duration) {
  return 2 + Math.ceil(duration * wire.downloadSpeed() / Piece.BLOCK_LENGTH)
}

function getPiecePipelineLength (wire, duration, pieceLength) {
  return 1 + Math.ceil(duration * wire.downloadSpeed() / pieceLength)
}

/**
 * Returns a random integer in [0,high)
 */
function randomInt (high) {
  return Math.random() * high | 0
}

function noop () {}

module.exports = Torrent

}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../package.json":337,"./file":317,"./peer":318,"./rarity-map":319,"./server":48,"./webconn":321,"_process":206,"addr-to-ip-port":3,"bitfield":10,"chunk-store-stream/write":69,"cpus":70,"debug":111,"events":117,"fs":48,"fs-chunk-store":161,"immediate-chunk-store":137,"lt_donthave":143,"multistream":184,"net":48,"os":48,"parse-torrent":202,"path":203,"pump":207,"queue-microtask":212,"random-iterate":213,"run-parallel":234,"run-parallel-limit":233,"simple-get":238,"simple-sha1":255,"speedometer":273,"torrent-discovery":303,"torrent-piece":304,"ut_metadata":311,"ut_pex":48,"utp-native":48}],321:[function(require,module,exports){
(function (Buffer){(function (){
const BitField = require('bitfield').default
const debug = require('debug')('webtorrent:webconn')
const get = require('simple-get')
const ltDontHave = require('lt_donthave')
const sha1 = require('simple-sha1')
const Wire = require('bittorrent-protocol')

const VERSION = require('../package.json').version

const SOCKET_TIMEOUT = 60000
const RETRY_DELAY = 10000

/**
 * Converts requests for torrent blocks into http range requests.
 * @param {string} url web seed url
 * @param {Object} torrent
 */
class WebConn extends Wire {
  constructor (url, torrent) {
    super()

    this.url = url
    this.connId = url // Unique id to deduplicate web seeds
    this.webPeerId = sha1.sync(url) // Used as the peerId for this fake remote peer
    this._torrent = torrent

    this._init()
  }

  _init () {
    this.setKeepAlive(true)

    this.use(ltDontHave())

    this.once('handshake', (infoHash, peerId) => {
      if (this.destroyed) return
      this.handshake(infoHash, this.webPeerId)
      const numPieces = this._torrent.pieces.length
      const bitfield = new BitField(numPieces)
      for (let i = 0; i <= numPieces; i++) {
        bitfield.set(i, true)
      }
      this.bitfield(bitfield)
    })

    this.once('interested', () => {
      debug('interested')
      this.unchoke()
    })

    this.on('uninterested', () => { debug('uninterested') })
    this.on('choke', () => { debug('choke') })
    this.on('unchoke', () => { debug('unchoke') })
    this.on('bitfield', () => { debug('bitfield') })
    this.lt_donthave.on('donthave', () => { debug('donthave') })

    this.on('request', (pieceIndex, offset, length, callback) => {
      debug('request pieceIndex=%d offset=%d length=%d', pieceIndex, offset, length)
      this.httpRequest(pieceIndex, offset, length, (err, data) => {
        if (err) {
          // Cancel all in progress requests for this piece
          this.lt_donthave.donthave(pieceIndex)

          // Wait a little while before saying the webseed has the failed piece again
          const retryTimeout = setTimeout(() => {
            if (this.destroyed) return

            this.have(pieceIndex)
          }, RETRY_DELAY)
          if (retryTimeout.unref) retryTimeout.unref()
        }

        callback(err, data)
      })
    })
  }

  httpRequest (pieceIndex, offset, length, cb) {
    const pieceOffset = pieceIndex * this._torrent.pieceLength
    const rangeStart = pieceOffset + offset /* offset within whole torrent */
    const rangeEnd = rangeStart + length - 1

    // Web seed URL format:
    // For single-file torrents, make HTTP range requests directly to the web seed URL
    // For multi-file torrents, add the torrent folder and file name to the URL
    const files = this._torrent.files
    let requests
    if (files.length <= 1) {
      requests = [{
        url: this.url,
        start: rangeStart,
        end: rangeEnd
      }]
    } else {
      const requestedFiles = files.filter(file => {
        return file.offset <= rangeEnd && (file.offset + file.length) > rangeStart
      })
      if (requestedFiles.length < 1) {
        return cb(new Error('Could not find file corresponding to web seed range request'))
      }

      requests = requestedFiles.map(requestedFile => {
        const fileEnd = requestedFile.offset + requestedFile.length - 1
        const url = this.url +
          (this.url[this.url.length - 1] === '/' ? '' : '/') +
          requestedFile.path
        return {
          url,
          fileOffsetInRange: Math.max(requestedFile.offset - rangeStart, 0),
          start: Math.max(rangeStart - requestedFile.offset, 0),
          end: Math.min(fileEnd, rangeEnd - requestedFile.offset)
        }
      })
    }

    // Now make all the HTTP requests we need in order to load this piece
    // Usually that's one requests, but sometimes it will be multiple
    // Send requests in parallel and wait for them all to come back
    let numRequestsSucceeded = 0
    let hasError = false

    let ret
    if (requests.length > 1) {
      ret = Buffer.alloc(length)
    }

    requests.forEach(request => {
      const url = request.url
      const start = request.start
      const end = request.end
      debug(
        'Requesting url=%s pieceIndex=%d offset=%d length=%d start=%d end=%d',
        url, pieceIndex, offset, length, start, end
      )
      const opts = {
        url,
        method: 'GET',
        headers: {
          'user-agent': `WebTorrent/${VERSION} (https://webtorrent.io)`,
          range: `bytes=${start}-${end}`
        },
        timeout: SOCKET_TIMEOUT
      }
      function onResponse (res, data) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          if (hasError) return
          hasError = true
          return cb(new Error(`Unexpected HTTP status code ${res.statusCode}`))
        }
        debug('Got data of length %d', data.length)

        if (requests.length === 1) {
          // Common case: fetch piece in a single HTTP request, return directly
          cb(null, data)
        } else {
          // Rare case: reconstruct multiple HTTP requests across 2+ files into one
          // piece buffer
          data.copy(ret, request.fileOffsetInRange)
          if (++numRequestsSucceeded === requests.length) {
            cb(null, ret)
          }
        }
      }
      get.concat(opts, (err, res, data) => {
        if (hasError) return
        if (err) {
          // Browsers allow HTTP redirects for simple cross-origin
          // requests but not for requests that require preflight.
          // Use a simple request to unravel any redirects and get the
          // final URL.  Retry the original request with the new URL if
          // it's different.
          //
          // This test is imperfect but it's simple and good for common
          // cases.  It catches all cross-origin cases but matches a few
          // same-origin cases too.
          if (typeof window === 'undefined' || url.startsWith(`${window.location.origin}/`)) {
            hasError = true
            return cb(err)
          }

          return get.head(url, (errHead, res) => {
            if (hasError) return
            if (errHead) {
              hasError = true
              return cb(errHead)
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              hasError = true
              return cb(new Error(`Unexpected HTTP status code ${res.statusCode}`))
            }
            if (res.url === url) {
              hasError = true
              return cb(err)
            }

            opts.url = res.url
            get.concat(opts, (err, res, data) => {
              if (hasError) return
              if (err) {
                hasError = true
                return cb(err)
              }
              onResponse(res, data)
            })
          })
        }
        onResponse(res, data)
      })
    })
  }

  destroy () {
    super.destroy()
    this._torrent = null
  }
}

module.exports = WebConn

}).call(this)}).call(this,require("buffer").Buffer)
},{"../package.json":337,"bitfield":10,"bittorrent-protocol":11,"buffer":52,"debug":111,"lt_donthave":143,"simple-get":238,"simple-sha1":255}],322:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12}],323:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"./_stream_readable":325,"./_stream_writable":327,"_process":206,"dup":13,"inherits":138}],324:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./_stream_transform":326,"dup":14,"inherits":138}],325:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"../errors":322,"./_stream_duplex":323,"./internal/streams/async_iterator":328,"./internal/streams/buffer_list":329,"./internal/streams/destroy":330,"./internal/streams/from":332,"./internal/streams/state":334,"./internal/streams/stream":335,"_process":206,"buffer":52,"dup":15,"events":117,"inherits":138,"string_decoder/":296,"util":48}],326:[function(require,module,exports){
arguments[4][16][0].apply(exports,arguments)
},{"../errors":322,"./_stream_duplex":323,"dup":16,"inherits":138}],327:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"../errors":322,"./_stream_duplex":323,"./internal/streams/destroy":330,"./internal/streams/state":334,"./internal/streams/stream":335,"_process":206,"buffer":52,"dup":17,"inherits":138,"util-deprecate":312}],328:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./end-of-stream":331,"_process":206,"dup":18}],329:[function(require,module,exports){
arguments[4][19][0].apply(exports,arguments)
},{"buffer":52,"dup":19,"util":48}],330:[function(require,module,exports){
arguments[4][20][0].apply(exports,arguments)
},{"_process":206,"dup":20}],331:[function(require,module,exports){
arguments[4][21][0].apply(exports,arguments)
},{"../../../errors":322,"dup":21}],332:[function(require,module,exports){
arguments[4][22][0].apply(exports,arguments)
},{"dup":22}],333:[function(require,module,exports){
arguments[4][23][0].apply(exports,arguments)
},{"../../../errors":322,"./end-of-stream":331,"dup":23}],334:[function(require,module,exports){
arguments[4][24][0].apply(exports,arguments)
},{"../../../errors":322,"dup":24}],335:[function(require,module,exports){
arguments[4][25][0].apply(exports,arguments)
},{"dup":25,"events":117}],336:[function(require,module,exports){
arguments[4][26][0].apply(exports,arguments)
},{"./lib/_stream_duplex.js":323,"./lib/_stream_passthrough.js":324,"./lib/_stream_readable.js":325,"./lib/_stream_transform.js":326,"./lib/_stream_writable.js":327,"./lib/internal/streams/end-of-stream.js":331,"./lib/internal/streams/pipeline.js":333,"dup":26}],337:[function(require,module,exports){
module.exports={
  "version": "0.118.0"
}
},{}],338:[function(require,module,exports){
// Returns a wrapper function that returns a wrapped callback
// The wrapper function should do some stuff, and return a
// presumably different callback function.
// This makes sure that own properties are retained, so that
// decorations and such are not lost along the way.
module.exports = wrappy
function wrappy (fn, cb) {
  if (fn && cb) return wrappy(fn)(cb)

  if (typeof fn !== 'function')
    throw new TypeError('need wrapper function')

  Object.keys(fn).forEach(function (k) {
    wrapper[k] = fn[k]
  })

  return wrapper

  function wrapper() {
    var args = new Array(arguments.length)
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i]
    }
    var ret = fn.apply(this, args)
    var cb = args[args.length-1]
    if (typeof ret === 'function' && ret !== cb) {
      Object.keys(cb).forEach(function (k) {
        ret[k] = cb[k]
      })
    }
    return ret
  }
}

},{}],339:[function(require,module,exports){
module.exports = extend

var hasOwnProperty = Object.prototype.hasOwnProperty;

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
                target[key] = source[key]
            }
        }
    }

    return target
}

},{}]},{},[2]);
