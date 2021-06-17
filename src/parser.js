"use strict";
/**
 * Thanks:Давид Мзареулян
 * https://github.com/davidmz/apng-js
 */

import crc32 from './crc32.js';


// "\x89PNG\x0d\x0a\x1a\x0a"
var PNG_SIGNATURE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {ArrayBuffer} buffer
 * @return {Object} Animation{width,height,frames[]}
 */
export default function(buffer) {
    var bytes = new Uint8Array(buffer);

    for (var i = 0; i < PNG_SIGNATURE_BYTES.length; i++) {
        if (PNG_SIGNATURE_BYTES[i] != bytes[i]) {
            reject("Not a PNG file (invalid file signature)");
            return;
        }
    }

    // fast animation test
    var isAnimated = false;
    parseChunks(bytes, function(type) {
        if (type == "acTL") {
            isAnimated = true;
            return false;
        }
        return true;
    });
    if (!isAnimated) {
        reject("Not an animated PNG");
        return;
    }

    var
        preDataParts = [],
        postDataParts = [],
        headerDataBytes = null,
        frame = null,
        anim = {
            playTime: 0,
            frames: []
        };

    parseChunks(bytes, function(type, bytes, off, length) {
        switch (type) {
            case "IHDR":
                headerDataBytes = bytes.subarray(off + 8, off + 8 + length);
                anim.width = readDWord(bytes, off + 8);
                anim.height = readDWord(bytes, off + 12);
                break;
            case "acTL":
                anim.numPlays = readDWord(bytes, off + 8 + 4);
                break;
            case "fcTL":
                if (frame) anim.frames.push(frame);
                frame = {};
                frame.width = readDWord(bytes, off + 8 + 4);
                frame.height = readDWord(bytes, off + 8 + 8);
                frame.left = readDWord(bytes, off + 8 + 12);
                frame.top = readDWord(bytes, off + 8 + 16);
                var delayN = readWord(bytes, off + 8 + 20);
                var delayD = readWord(bytes, off + 8 + 22);
                if (delayD == 0) delayD = 100;
                frame.delay = 1000 * delayN / delayD;
                // see http://mxr.mozilla.org/mozilla/source/gfx/src/shared/gfxImageFrame.cpp#343
                if (frame.delay <= 10) frame.delay = 100;
                anim.playTime += frame.delay;
                frame.disposeOp = readByte(bytes, off + 8 + 24);
                frame.blendOp = readByte(bytes, off + 8 + 25);
                frame.dataParts = [];
                break;
            case "fdAT":
                if (frame) frame.dataParts.push(bytes.subarray(off + 8 + 4, off + 8 + length));
                break;
            case "IDAT":
                if (frame) frame.dataParts.push(bytes.subarray(off + 8, off + 8 + length));
                break;
            case "IEND":
                postDataParts.push(subBuffer(bytes, off, 12 + length));
                break;
            default:
                preDataParts.push(subBuffer(bytes, off, 12 + length));
        }
    });

    if (frame) anim.frames.push(frame);

    if (anim.frames.length == 0) {
        reject("Not an animated PNG");
        return;
    }

    // creating images
    var preBlob = preDataParts,
        postBlob = postDataParts;
    for (var f = 0; f < anim.frames.length; f++) {
        frame = anim.frames[f];
        var bb = [];
        bb.push(PNG_SIGNATURE_BYTES);
        headerDataBytes.set(makeDWordArray(frame.width), 0);
        headerDataBytes.set(makeDWordArray(frame.height), 4);
        bb.push(makeChunkBytes("IHDR", headerDataBytes));
        bb.push(preBlob);
        for (var j = 0; j < frame.dataParts.length; j++) {
            bb.push(makeChunkBytes("IDAT", frame.dataParts[j]));
        }
        bb.push(postBlob);
        let bf = new Uint8Array();
        bb.flat().forEach(u8a => {
            let t = [].concat(Array.from(bf), Array.from(u8a));
            bf = new Uint8Array(t);
        });
        delete frame.dataParts;
        frame.data = bf;
    }
    return anim;
};

/**
 * @param {Uint8Array} bytes
 * @param {function(string, Uint8Array, int, int)} callback
 */
var parseChunks = function(bytes, callback) {
    var off = 8;
    do {
        var length = readDWord(bytes, off);
        var type = readString(bytes, off + 4, 4);
        var res = callback(type, bytes, off, length);
        off += 12 + length;
    } while (res !== false && type != "IEND" && off < bytes.length);
};

/**
 * @param {Uint8Array} bytes
 * @param {int} off
 * @return {int}
 */
var readDWord = function(bytes, off) {
    var x = 0;
    // Force the most-significant byte to unsigned.
    x += ((bytes[0 + off] << 24) >>> 0);
    for (var i = 1; i < 4; i++) x += ((bytes[i + off] << ((3 - i) * 8)));
    return x;
};

/**
 * @param {Uint8Array} bytes
 * @param {int} off
 * @return {int}
 */
var readWord = function(bytes, off) {
    var x = 0;
    for (var i = 0; i < 2; i++) x += (bytes[i + off] << ((1 - i) * 8));
    return x;
};

/**
 * @param {Uint8Array} bytes
 * @param {int} off
 * @return {int}
 */
var readByte = function(bytes, off) {
    return bytes[off];
};

/**
 * @param {Uint8Array} bytes
 * @param {int} start
 * @param {int} length
 * @return {Uint8Array}
 */
var subBuffer = function(bytes, start, length) {
    var a = new Uint8Array(length);
    a.set(bytes.subarray(start, start + length));
    return a;
};

var readString = function(bytes, off, length) {
    var chars = Array.prototype.slice.call(bytes.subarray(off, off + length));
    return String.fromCharCode.apply(String, chars);
};

var makeDWordArray = function(x) {
    return [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff];
};
var makeStringArray = function(x) {
    var res = [];
    for (var i = 0; i < x.length; i++) res.push(x.charCodeAt(i));
    return res;
};
/**
 * @param {string} type
 * @param {Uint8Array} dataBytes
 * @return {Uint8Array}
 */
var makeChunkBytes = function(type, dataBytes) {
    var crcLen = type.length + dataBytes.length;
    var bytes = new Uint8Array(new ArrayBuffer(crcLen + 8));
    bytes.set(makeDWordArray(dataBytes.length), 0);
    bytes.set(makeStringArray(type), 4);
    bytes.set(dataBytes, 8);
    var crc = crc32(bytes, 4, crcLen);
    bytes.set(makeDWordArray(crc), crcLen + 4);
    return bytes;
};