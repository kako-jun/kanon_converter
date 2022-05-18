"use strict";

import _ from "lodash";
import os from "os";
import fs from "fs";
import path from "path";
import moment from "moment";
import Jimp from "jimp";

import Logger from "../utils/logger";
import Common from "../utils/common";
import AppConfig from "../models/app_config";
import { AppConfigJSON } from "../models/app_config";
import { exit } from "process";

interface Size {
  width: number;
  height: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
}

interface PDTImage {
  length: number;
  size: Size;
  maskPosition: number;
  pixels: Color[];
  alphas: number[];
}

// ADV32はPDT形式
// RealLiveはG00形式
class Kanon {
  // class variables

  // instance variables
  private _appRootPath = "";
  private _appConfig: AppConfigJSON;

  constructor() {
    Logger.initLogger("egg_kanon", { level: "ALL", consoleEnabled: true });

    this._appRootPath = path.resolve(os.homedir(), ".egg_kanon");
    if (!Common.exist(path.resolve(this._appRootPath, "json"))) {
      fs.mkdirSync(path.resolve(this._appRootPath, "json"), { recursive: true });
    }

    // {USER_HOME}/.{appName}/json/app_config.json
    AppConfig.jsonPath = path.resolve(this._appRootPath, "json", "app_config.json");
    this._appConfig = AppConfig.load();
  }

  public async start(inputDirPath: string, outputDirPath: string, compress: boolean) {
    Logger.trace("start.");
    // Logger.trace("this._appConfig", this._appConfig);
    const ArrayX = [
      {
        user_id: "user 4",
        store_ids: ["store 2", "store 4", "store 1"],
      },
      {
        user_id: "user 6",
        store_ids: ["store 1", "store 2"],
      },
    ];

    const ArrayY = [
      {
        store_id: "store 4",
        store_name: "store D",
      },
      {
        store_id: "store 2",
        store_name: "store B",
      },
      {
        store_id: "store 1",
        store_name: "store A",
      },
      {
        store_id: "store 3",
        store_name: "store C",
      },
    ];

    const ArrayZ = ArrayX.map((x, i) => {
      const store_infos = [];
      for (const store_id of x.store_ids) {
        const store_info = ArrayY.find((y) => y.store_id === store_id);
        store_infos.push(store_info);
      }

      return {
        user_id: x.user_id,
        store_ids: x.store_ids,
        store_info: store_infos,
      };
    });

    console.log(JSON.stringify(ArrayZ, null, 2));

    if (compress) {
      const pngFilePaths = Common.enumFilePaths(inputDirPath, ["png"]);
      // const pngFilePaths = ["..\\PDT\\AYU_01.png"];
      // const pngFilePaths = ["..\\PDT\\TATE_1.png"];
      // const pngFilePaths = ["..\\PDT\\BG001.png"];
      for (const pngFilePath of pngFilePaths) {
        const jimpImage = await Jimp.read(pngFilePath);
        if (jimpImage) {
          const pdtImage = this._generatePDTImage(jimpImage);
          if (pdtImage) {
            const pngFileName = path.basename(pngFilePath, path.extname(pngFilePath));
            const outputPDTFilePath = path.join(outputDirPath, `${pngFileName}.pdt`);
            this._savePDT(pdtImage, outputPDTFilePath);
          }
        }
      }
    } else {
      // PDTファイルをPNGに変換する
      const pdtFilePaths = Common.enumFilePaths(inputDirPath, ["pdt"]);
      // const pdtFilePaths = ["..\\PDT\\AYU_01.PDT"];
      // const pdtFilePaths = ["..\\PDT\\AYU_03.PDT"];
      // const pdtFilePaths = ["..\\PDT\\TATE_1.PDT"];
      // const pdtFilePaths = ["..\\PDT\\BG001.PDT"];
      // const pdtFilePaths = ["..\\PDT\\YUKI.PDT"];
      // const pdtFilePaths = ["..\\compress\\AYU_01.PDT"];
      // const pdtFilePaths = ["..\\compress\\BG001.PDT"];

      for (const pdtFilePath of pdtFilePaths) {
        const pdtImage = this._parsePDT(pdtFilePath);
        if (pdtImage) {
          const jimpImage = await this._generateJimpImage(pdtImage);
          if (jimpImage) {
            const pdtFileName = path.basename(pdtFilePath, path.extname(pdtFilePath));
            const outputPNGFilePath = path.join(outputDirPath, `${pdtFileName}.png`);
            await this._saveJimpImageAsPNG(jimpImage, outputPNGFilePath);
          }
        }
      }
    }

    // AppConfig.save(this._appConfig);
    Logger.trace("end.");
  }

  private _parsePDT(pdtFilePath: string) {
    const buf = fs.readFileSync(pdtFilePath);

    const magicBytesText = this._getMagicBytesText(buf);
    if (magicBytesText === "PDT10") {
      const length = this._getLength(buf);
      const size = this._getSize(buf);
      const maskPosition = this._getMaskPosition(buf);
      const pixels = this._getPixels(buf, length, size);
      let alphas: number[] = [];
      if (maskPosition > 0) {
        alphas = this._getMaskPixels(buf, length, size, maskPosition);
        if (pixels.length !== alphas.length) {
          Logger.error("pixels.length", pixels.length, "alphas.length", alphas.length);
        }
      }

      return { length, size, maskPosition, pixels, alphas };
    }

    return null;
  }

  private _getMagicBytesText(buf: Buffer) {
    // TODO: 初めて00が現れるまで、という条件にする
    // 0Byte目から7Byte目まで
    // 50 44 54 31 30 00 00 00
    const magicBytes = buf.slice(0, 8);
    Logger.trace("magicBytes", magicBytes);

    // ASCIIコードに変換する
    // PDTの場合、「PDT10   」
    let magicBytesText = magicBytes.toString("ascii");
    magicBytesText = magicBytesText.replace(/\0/g, "");
    Logger.trace("magicBytesText", magicBytesText);
    return magicBytesText;
  }

  private _getLength(buf: Buffer) {
    // 長さの情報は8Byte目から11Byte目
    // 25 5A 01 00
    // 15A25 なので、88613Byte
    const lengthBytes = buf.slice(8, 8 + 4);
    Logger.trace("Common.convertToHexTextArray(lengthBytes)", Common.convertToHexTextArray(lengthBytes));
    const length = lengthBytes.readUIntLE(0, 4);

    Logger.trace("length", length);
    return length;
  }

  private _getSize(buf: Buffer) {
    // 幅の情報は12Byte目から15Byte目
    // 80 02 00 00
    const widthBytes = buf.slice(12, 12 + 4);
    Logger.trace("Common.convertToHexTextArray(widthBytes)", Common.convertToHexTextArray(widthBytes));
    const width = widthBytes.readUIntLE(0, 4);

    // 高さの情報は16Byte目から19Byte目
    // E0 01 00 00
    const heightBytes = buf.slice(16, 16 + 4);
    Logger.trace("Common.convertToHexTextArray(heightBytes)", Common.convertToHexTextArray(heightBytes));
    const height = heightBytes.readUIntLE(0, 4);

    const size = { width, height };
    Logger.trace("size", size);
    return size;
  }

  private _getMaskPosition(buf: Buffer) {
    // 透過の情報は28Byte目
    const maskPositionBytes = buf.slice(28, 28 + 4);
    Logger.trace("Common.convertToHexTextArray(maskPositionBytes)", Common.convertToHexTextArray(maskPositionBytes));
    const maskPosition = maskPositionBytes.readUIntLE(0, 4);

    Logger.trace("maskPosition", maskPosition);
    return maskPosition;
  }

  private _getPixels(buf: Buffer, length: number, size: Size) {
    // ピクセルの情報は32Byte目から
    Logger.trace("buf.length", buf.length);
    Logger.trace("buf.length.toString(16)", buf.length.toString(16));
    let pixels = [];

    Common.dumpPDTBufferAsJSON(buf);
    const compressList = [];

    let buf_i = 32;
    let flag = 0;
    let flagMask = 0;

    // リングバッファを初期化する
    // const ring = new Array(0x1000).fill(0);
    const ring = new Array(0x1000).fill({ r: -1, g: -1, b: -1 });
    let ring_push_i = 0;
    let ring_pop_i = 0;

    let nextStartX = 0;
    for (let y = 0; y < size.height; y++) {
      // console.log("y", y);
      // console.log("nextStartX", Common.convertToHexTextArray([nextStartX]));
      // Logger.trace("nextStartX", Common.convertToHexTextArray([nextStartX]));
      for (let x = nextStartX; x < size.width; ) {
        // Logger.trace("x", x);
        // Logger.trace("y", y);
        // Logger.trace("buf_i", Common.convertToHexTextArray([buf_i]));

        if (x === 508 && y === 0) {
          console.log();
        }

        flagMask >>= 1;
        if (flagMask === 0) {
          flagMask = 0x80;

          // 80
          flag = buf[buf_i];
          // Logger.trace("flag", Common.convertToBinTextArray([flag]));
          buf_i++;
        }

        if (flag & flagMask) {
          // ピクセル情報のByteである
          // FF FF FF
          // Logger.trace("直値");
          // Logger.trace("直値 rgb", buf[buf_i + 2], buf[buf_i + 1], buf[buf_i]);
          // Logger.trace("ring_push_i", Common.convertToHexTextArray([ring_push_i]));
          // ring[ring_push_i] = buf[buf_i] + (buf[buf_i + 1] << 8) + (buf[buf_i + 2] << 16);
          // ring[ring_push_i] = buf.readUIntLE(buf_i, 3);
          const pixel = buf.readUIntLE(buf_i, 3);
          const r = (pixel >> 16) & 0xff;
          const g = (pixel >> 8) & 0xff;
          const b = pixel & 0xff;
          // Common.dumpRawRingAsJSON(ring, x, y, buf_i, ring_push_i, { r, g, b }, "raw_0before");
          ring[ring_push_i] = { r, g, b };
          // Common.dumpRawRingAsJSON(ring, x, y, buf_i, ring_push_i, { r, g, b }, "raw_1after");
          buf_i += 3;
          ring_push_i = (ring_push_i + 1) & 0x0fff;

          x++;
        } else {
          // Logger.trace("圧縮");
          // リングバッファ内の位置情報のByteである
          // 0F 00
          // const compressedLengthBytes = buf.slice(buf_i, buf_i + 2);
          // Logger.trace(
          //   "Common.convertToHexTextArray(compressedLengthBytes)",
          //   Common.convertToHexTextArray(compressedLengthBytes)
          // );

          // let compressedLength = compressedLengthBytes.readUIntLE(0, 2);
          const compressed = buf.readUIntLE(buf_i, 2);
          buf_i += 2;

          const position = compressed >> 4;
          const length = (compressed & 0x0f) + 1;

          compressList.push({
            x,
            y,
            buf_i: Common.toHexText8(buf_i),
            ring_push_i,
            bytes: Common.toHexText2(compressed & 0x00ff) + " " + Common.toHexText2(compressed >> 8),
            position,
            length,
          });

          // let upper = buf[buf_i];
          // buf_i++;

          // let lower = buf[buf_i];
          // buf_i++;

          // const length = (upper & 0x0f) + 1;
          // const position = (upper >> 4) + (lower << 4);
          // Logger.trace("length", length);
          // Logger.trace("position", Common.convertToHexTextArray([position]));

          // let ring_prev_i = ring_i - (compressedLength >> 4) - 1;
          let ring_prev_i = (ring_push_i - position - 1) & 0x0fff;

          // Common.dumpCompressRingAsJSON(
          //   ring,
          //   x,
          //   y,
          //   buf_i - 2,
          //   ring_push_i,
          //   ring_prev_i,
          //   length,
          //   ring[ring_prev_i],
          //   "compress_0before"
          // );

          for (let i = 0; i < length; i++) {
            // Logger.trace("ring_push_i", Common.convertToHexTextArray([ring_push_i]));
            // Logger.trace("ring_prev_i", Common.convertToHexTextArray([ring_prev_i]));
            // Logger.trace("圧縮 rgb", ring[ring_prev_i]);
            ring[ring_push_i] = ring[ring_prev_i];
            ring_push_i = (ring_push_i + 1) & 0x0fff;
            ring_prev_i = (ring_prev_i + 1) & 0x0fff;
          }

          // Common.dumpCompressRingAsJSON(
          //   ring,
          //   x,
          //   y,
          //   buf_i - 2,
          //   ring_push_i,
          //   ring_prev_i,
          //   length,
          //   ring[(ring_prev_i - 1) & 0x0fff],
          //   "compress_1after"
          // );

          x += length;
        }

        if (x >= size.width) {
          nextStartX = x - size.width;

          for (let i = 0; i < size.width; i++) {
            const pixel = ring[ring_pop_i];
            ring_pop_i = (ring_pop_i + 1) & 0x0fff;

            if (pixel.r < 0 || pixel.g < 0 || pixel.b < 0) {
              console.error(i);
            }

            // const r = (pixel >> 16) & 0xff;
            // const g = (pixel >> 8) & 0xff;
            // const b = pixel & 0xff;
            // const r = pixel.r >= 0 ? pixel.r : 0;
            // const g = pixel.g >= 0 ? pixel.g : 0;
            // const b = pixel.b >= 0 ? pixel.b : 0;
            // pixels.push({ r, g, b });
            pixels.push(pixel);
          }
        }
      }
    }

    Common.dumpCompressList(compressList);

    // Logger.trace("pixels", pixels);
    return pixels;
  }

  private _getMaskPixels(buf: Buffer, length: number, size: Size, maskPosition: number) {
    let alphas = [];

    let buf_i = maskPosition;
    let flag = 0;
    let flagMask = 0;

    // リングバッファを0で初期化する
    const ring = new Array(0x1000).fill(0);
    let ring_push_i = 0;
    let ring_pop_i = 0;

    let nextStartX = 0;
    for (let y = 0; y < size.height; y++) {
      // console.log("y", y);
      // console.log("nextStartX", Common.convertToHexTextArray([nextStartX]));
      // Logger.trace("nextStartX", Common.convertToHexTextArray([nextStartX]));
      for (let x = nextStartX; x < size.width; ) {
        // Logger.trace("x", x);
        // Logger.trace("y", y);
        // Logger.trace("buf_i", Common.convertToHexTextArray([buf_i]));

        flagMask >>= 1;
        if (flagMask === 0) {
          flagMask = 0x80;

          // 80
          flag = buf[buf_i];
          // Logger.trace("flag", Common.convertToBinTextArray([flag]));
          buf_i++;
        }

        if (flag & flagMask) {
          // ピクセル情報のByteである
          // FF FF FF
          // Logger.trace("直値");
          // Logger.trace("直値 rgb", buf[buf_i + 2], buf[buf_i + 1], buf[buf_i]);
          // Logger.trace("ring_push_i", Common.convertToHexTextArray([ring_push_i]));
          // ring[ring_push_i] = buf[buf_i] + (buf[buf_i + 1] << 8) + (buf[buf_i + 2] << 16);
          ring[ring_push_i] = buf[buf_i];
          buf_i++;
          ring_push_i = (ring_push_i + 1) & 0x0fff;

          x++;
        } else {
          // Logger.trace("圧縮");
          // リングバッファ内の位置情報のByteである
          // 0F 00
          // const compressedLengthBytes = buf.slice(buf_i, buf_i + 2);
          // Logger.trace(
          //   "Common.convertToHexTextArray(compressedLengthBytes)",
          //   Common.convertToHexTextArray(compressedLengthBytes)
          // );

          // let compressedLength = compressedLengthBytes.readUIntLE(0, 2);
          const compressed = buf.readUIntLE(buf_i, 2);
          buf_i += 2;

          const position = compressed >> 8;
          const length = (compressed & 0xff) + 2;

          // let upper = buf[buf_i];
          // buf_i++;

          // let lower = buf[buf_i];
          // buf_i++;

          // const length = (upper & 0x0f) + 1;
          // const position = (upper >> 4) + (lower << 4);
          // Logger.trace("length", length);
          // Logger.trace("position", Common.convertToHexTextArray([position]));

          // let ring_prev_i = ring_i - (compressedLength >> 4) - 1;
          let ring_prev_i = (ring_push_i - position - 1) & 0x0fff;

          for (let i = 0; i < length; i++) {
            // Logger.trace("ring_push_i", Common.convertToHexTextArray([ring_push_i]));
            // Logger.trace("ring_prev_i", Common.convertToHexTextArray([ring_prev_i]));
            // Logger.trace("圧縮 rgb", ring[ring_prev_i]);
            ring[ring_push_i] = ring[ring_prev_i];
            ring_push_i = (ring_push_i + 1) & 0x0fff;
            ring_prev_i = (ring_prev_i + 1) & 0x0fff;
          }

          x += length;
        }

        if (x >= size.width) {
          nextStartX = x - size.width;

          for (let i = 0; i < size.width; i++) {
            const transparent = ring[ring_pop_i];
            ring_pop_i = (ring_pop_i + 1) & 0x0fff;

            alphas.push(transparent);
          }
        }
      }
    }

    // Logger.trace("alphas", alphas);
    return alphas;
  }

  private async _generateJimpImage(pdtImage: PDTImage) {
    const jimpImage = await Jimp.create(pdtImage.size.width, pdtImage.size.height, Jimp.rgbaToInt(0, 0, 0, 0));
    if (jimpImage) {
      for (let i = 0; i < pdtImage.pixels.length; i++) {
        const x = i % pdtImage.size.width;
        const y = Math.floor(i / pdtImage.size.width);
        let hex = Jimp.rgbaToInt(0, 0, 0, 0);
        // let hex = Jimp.rgbaToInt(0xff, 0, 0, 0xff);
        // let hex = Jimp.rgbaToInt(0, 0xff, 0, 0xff);
        // let hex = Jimp.rgbaToInt(0, 0, 0xff, 0xff);

        const pixel = pdtImage.pixels[i];

        if (i < pdtImage.alphas.length) {
          const alpha = pdtImage.alphas[i];
          hex = Jimp.rgbaToInt(pixel.r, pixel.g, pixel.b, alpha);
        } else {
          hex = Jimp.rgbaToInt(pixel.r, pixel.g, pixel.b, 0xff);
        }
        // Logger.trace("i", i);
        // Logger.trace("r", pixel.r);
        // Logger.trace("g", pixel.g);
        // Logger.trace("b", pixel.b);
        // if (pixel === pdtImage.transparent) {
        // } else {
        //   const color = pdtImage.palette[pixel];
        //   if (color) {
        //     hex = Jimp.rgbaToInt(color.r, color.g, color.b, 0xff);
        //   }
        // }

        jimpImage.setPixelColor(hex, x, y);
      }

      return jimpImage;
    }

    return null;
  }

  private async _saveJimpImageAsPNG(jimpImage: Jimp, outputFilePath: string) {
    // console.log(jimpImage.hasAlpha());
    await jimpImage.writeAsync(outputFilePath);
  }

  private _generatePDTImage(jimpImage: Jimp) {
    const length = 0;
    const size = { width: jimpImage.bitmap.width, height: jimpImage.bitmap.height };
    const maskPosition = 0;

    const pixels = [];
    for (let j = 0; j < jimpImage.bitmap.height; j++) {
      for (let i = 0; i < jimpImage.bitmap.width; i++) {
        const rgba = jimpImage.getPixelColor(i, j);
        const r = (rgba >> 24) & 0xff;
        const g = (rgba >> 16) & 0xff;
        const b = (rgba >> 8) & 0xff;
        pixels.push({ r, g, b });
      }
    }

    const alphas = [];
    for (let j = 0; j < jimpImage.bitmap.height; j++) {
      for (let i = 0; i < jimpImage.bitmap.width; i++) {
        const rgba = jimpImage.getPixelColor(i, j);
        const a = rgba & 0xff;
        alphas.push(a);
      }
    }

    const pdtImage = { length, size, maskPosition, pixels, alphas };
    return pdtImage;
  }

  private _savePDT(pdtImage: PDTImage, outputFilePath: string) {
    // console.log(jimpImage.hasAlpha());
    const buf = this._compress(pdtImage);
    Common.writeBufferToFile(outputFilePath, buf);
  }

  private _compress(pdtImage: PDTImage) {
    // console.log(jimpImage.hasAlpha());
    let hasMask = false;
    for (const alpha of pdtImage.alphas) {
      if (alpha !== 0xff) {
        hasMask = true;
        break;
      }
    }

    let bytes: number[] = [];

    // PDT10\0\0\0
    const magicBytes = [0x50, 0x44, 0x54, 0x31, 0x30, 0, 0, 0];
    bytes = bytes.concat(magicBytes);

    const lengthBytes = [0, 0, 0, 0];
    bytes = bytes.concat(lengthBytes);

    const widthBytes = [
      pdtImage.size.width & 0xff,
      (pdtImage.size.width >> 8) & 0xff,
      (pdtImage.size.width >> 16) & 0xff,
      (pdtImage.size.width >> 24) & 0xff,
    ];
    bytes = bytes.concat(widthBytes);

    const heightBytes = [
      pdtImage.size.height & 0xff,
      (pdtImage.size.height >> 8) & 0xff,
      (pdtImage.size.height >> 16) & 0xff,
      (pdtImage.size.height >> 24) & 0xff,
    ];
    bytes = bytes.concat(heightBytes);

    for (let i = 0; i < 12; i++) {
      bytes.push(0);
    }

    // const pixelBytes = this._generatePixelBytes(pdtImage);
    const pixelBytes = this._generatePixelBytes2(pdtImage);
    bytes = bytes.concat(pixelBytes);

    if (hasMask) {
    }

    // length
    bytes[8] = bytes.length & 0xff;
    bytes[9] = (bytes.length >> 8) & 0xff;
    bytes[10] = (bytes.length >> 16) & 0xff;
    bytes[11] = (bytes.length >> 24) & 0xff;

    const buf = Buffer.from(bytes);
    return buf;
  }

  private _generatePixelBytes(pdtImage: PDTImage) {
    const pixelBytes = [];
    let flag = [];
    let flagMask = 0;
    let flagPosition = 0;

    // リングバッファを初期化する
    const ring = new Array(0x1000).fill({ r: -1, g: -1, b: -1 });
    let ring_push_i = 0;

    for (let i = 0; i < pdtImage.pixels.length; i++) {
      const x = i % pdtImage.size.width;
      const y = Math.floor(i / pdtImage.size.width);

      flagMask >>= 1;
      if (flagMask === 0) {
        // 最後の1周にも同じ処理が必要
        let flagByte = 0;
        for (let j = 0; j < flag.length; j++) {
          flagByte += flag[j] << (flag.length - j - 1);
        }

        if (flagPosition < pixelBytes.length) {
          pixelBytes[flagPosition] = flagByte;
        }

        flagMask = 0x80;
        flag = [];
        flagPosition = pixelBytes.length;
        pixelBytes.push(0);
      }

      const pixel = pdtImage.pixels[i];

      // if (pixel.r === 0xf3) {
      // if (pixel.r === 137) {
      if (pixel.r === 252 && pixel.g === 255 && pixel.b === 255) {
        console.log();
      }

      // 無圧縮にする場合は、foundをfalse固定にする
      // AYU_01.PDTは86.5KBは、無圧縮では938KBだった
      const foundPosition = this._findInRing(ring, pixel, ring_push_i);
      if (foundPosition >= 0) {
        flag.push(0);

        // 圧縮できるlengthは16までなので、16pixel先まで調べる
        // TODO: 終端判定をする
        // const position = ring_push_i - foundPosition - 1;
        let length = 0;

        // ringは1ピクセルごとの色そのものなので、pixelsをそのまま入れていい
        // TODO: 16Byte先まで読み込み、ringにコピーしてしまう
        const targetBytes = pdtImage.pixels.slice(i, i + 16);
        // for (let j = 0; j < targetBytes.length; j++) {
        //   if (j === 0) {
        //     ring[ring_push_i] = targetBytes[j];
        //     ring_push_i = (ring_push_i + 1) & 0x0fff;
        //   } else {
        //     if (targetBytes[j] === targetBytes[j - 1]) {
        //       ring[ring_push_i] = targetBytes[j];
        //       ring_push_i = (ring_push_i + 1) & 0x0fff;
        //     }
        //   }
        // }

        // let endPosition = i + 16;
        // if (endPosition > pdtImage.pixels.length) {
        //   endPosition = pdtImage.pixels.length;
        // }

        // const targetBytes = pdtImage.pixels.slice(i, i + 16);
        // Logger.trace("i", i);
        // Logger.trace("targetBytes", targetBytes);

        // let ring_prev_i = foundPosition;
        const ring_origin_i = ring_push_i;

        Common.dumpCompressRingAsJSON(
          ring,
          x,
          y,
          pixelBytes.length,
          ring_origin_i,
          ring_push_i,
          length,
          targetBytes[0],
          "compress_0before"
        );

        for (let j = 0; j < targetBytes.length; j++) {
          if (
            targetBytes[j].r === targetBytes[0].r &&
            targetBytes[j].g === targetBytes[0].g &&
            targetBytes[j].b === targetBytes[0].b
          ) {
            length++;

            // ring[ring_push_i] = ring[foundPosition + j];
            // ring[ring_push_i] = ring[foundPosition];
            ring[ring_push_i] = targetBytes[0];
            // ring[ring_push_i] = { r: ring[foundPosition].r, g: ring[foundPosition].g, b: ring[foundPosition].b };
            ring_push_i = (ring_push_i + 1) & 0x0fff;
            // ring_prev_i = (ring_prev_i + 1) & 0x0fff;
          } else {
            break;
          }

          // ring[ring_push_i] = targetBytes[j];
          // ring_push_i = (ring_push_i + 1) & 0x0fff;
        }

        Common.dumpCompressRingAsJSON(
          ring,
          x,
          y,
          pixelBytes.length,
          ring_origin_i,
          ring_push_i,
          length,
          targetBytes[0],
          "compress_1after"
        );

        // for (let j = 0; j < targetBytes.length; j++) {
        //   if (targetBytes[j] === pdtImage.pixels[i + j]) {
        //     length = j + 1;

        //     ring[ring_push_i] = ring[foundPosition + j];
        //     ring_push_i = (ring_push_i + 1) & 0x0fff;
        //   }
        // }

        // const resultOfFind = this._findInRing(ring, ring_push_i, targetBytes);
        // const position = resultOfFind.position;
        // const length = resultOfFind.length;

        const ret = this._findArrayInRing(ring, ring_origin_i, foundPosition, length);

        pixelBytes.push(((ret.position << 4) & 0xf0) + ((ret.length - 1) & 0x0f));
        pixelBytes.push((ret.position >> 4) & 0xff);

        // let ring_prev_i = (ring_push_i - position - 1) & 0x0fff;

        // for (let i = 0; i < length; i++) {
        //   ring[ring_push_i] = ring[ring_prev_i];
        //   ring_push_i = (ring_push_i + 1) & 0x0fff;
        //   ring_prev_i = (ring_prev_i + 1) & 0x0fff;
        // }
        i += ret.length - 1;
      } else {
        flag.push(1);

        const r = pixel.r;
        const g = pixel.g;
        const b = pixel.b;
        pixelBytes.push(b);
        pixelBytes.push(g);
        pixelBytes.push(r);

        Common.dumpRawRingAsJSON(ring, x, y, pixelBytes.length, ring_push_i, { r, g, b }, "raw_0before");
        // ring[ring_push_i] = (b << 16) + (g << 8) + r;
        ring[ring_push_i] = pixel;
        Common.dumpRawRingAsJSON(ring, x, y, pixelBytes.length, ring_push_i, { r, g, b }, "raw_1after");
        ring_push_i = (ring_push_i + 1) & 0x0fff;
      }

      Common.dumpPDTBytesAsJSON(pixelBytes, i, pdtImage.size.width, pdtImage.size.height);
    }

    return pixelBytes;
  }

  private _generatePixelBytes2(pdtImage: PDTImage) {
    const pixelBytes = [];
    let flag = [];
    let flagMask = 0;
    let flagPosition = 0;

    // リングバッファより小さな画像はpdt化できない(200px x 20px)

    // 最初にリングバッファに埋まっているのはFF？→違う。それなら1ピクセル目に既存が見つかるはず
    // 最初にリングバッファに埋まっているのは00？→違う。左上が黒の画像で試したが、1ピクセル目がrawと判定された

    // 探す色が、まさにリングバッファの今の位置にあり、ほかからコピーしてくる必要がなかったとしても探す

    // まずリングバッファを現在位置から16個で埋める。1周前の最後16個が消えてしまい、そこから探せなくなるが？
    // 後でのコピーなどはしない。iを移動させるだけ

    // 16連続が欲しい場合は、既存の16連続を探しに行く。なので探しに行く前に自分が何連続なのか知っておく必要がある
    // 探し当てた位置として返るのは16連続の1つ目の位置
    // 探すのが9連続で、16連続から9連続を取得する場合、右側9個として検出され7要素目が検出位置となる

    // 1連続だろうと探す

    // compress内に複数の色は混じる
    // 同じ色1ピクセルだけを探しに行くわけではない。現在位置から右16ピクセルぶんが完全一致するパターンが左側にあるか、なければ15ピクセルが、
    // のように探しに行く
    // 左に見つからない場合は、右を探すが、位置が最も左寄りなものを見つける。右17個先から右方向に探している？

    // 右端に見つかった時、右端と次のループの左端がくっついて16連続だとしても、ちゃんと16連続だと認識されて見つかっている
    // なので、またいでも連続とみなしているということ

    // ×同じ色のピクセルがリングバッファ内にあるかは、1つ左を探す
    // ×同じ色のピクセルがリングバッファ内にあるかは、右方向に探す。右になかったら0から探す

    // 7AF（2241）でなぜ1つ左にあるのに、12個左（2228）と計算されたのか？
    // コピーした長さは3
    // 1つ左になかった？→デコードしたら1つ左にもあった
    // リングバッファの開始が異なり、終端をまたいだ？→開始は0だし、またいでいない
    // 同じ色を探す優先順位がそうなっている？→
    // その後の7F8（2267）でもFFを計算した場所は2228だった。コピーした長さは16。その時1つ右もFFだったので、右を探すのは無い
    // 左に探したら最初に見つかるのは2243なはずなのに、なぜ2228になったのか？
    // その後の7FA（2283）からは、ちゃんと1つ左からコピーするように戻る
    // 16個コピーしない限りリングバッファには入らない？
    // デコードの時のリングバッファへの入れ方が間違っていると考えられる。rawの場合は必ずringに入れるが、
    // compressの場合は、コピー元から入れなくても良いという条件があるようだ
    // ただし、番号ズレは起きていないことから挿入はしているはず。
    // 発見されないような、別の値を挿入している？
    // でも、最後にそのリングバッファを元にpngにしているので、別の値が入っているはずがない→それはデコードの時。エンコードの時には無関係
    // 正しい値を入れたとしてもデコード時に使われないだけであり問題ない。公式エンコーダには別の値を入れる条件がありそう。
    // 16連続がすでにringにあるので、それより短い連続は入れる意味がない、という判定っぽい
    // そうやって入れないまま、再び16連続が来ることなく既存の16連続が消え、その後16連続が必要な機会が来るともったいないが

    // 16連続がすでにringにある場合、それより短い連続でもringに入れるが、辞書に入れないため、次回のために指し示す位置は最後の16連続のままになる
    // 辞書を使って高速化しているように見える。LZ88アルゴリズム？
    // 記号列を探す範囲をスライド窓と呼び、これを辞書として使用するので、辞書式圧縮法
    // LZSS
    // http://www.snap-tck.com/room03/c02/comp/comp052.html
    // 辞書は無限に持ちたいが、リングバッファからなくなれば辞書にあっても意味がない。辞書から消すという動作もある？
    //

    // 長さ3の時、2240になるはずが2228 差は12
    // 長さ5の時、2874になるはずが2864 差は10
    // 長さ11の時、3505になるはずが3501 差は4

    // 長さ9の時でも、ちゃんとコピーされているものもある

    // 16個先まで常に読んでいる。最後に16連続が見つかった場所だけ特別扱いで控えているのでは？何個まで？
    // 16個全て同じ色のときのみ？
    // 同じ色が16連続以上の場合、例えば100連続の場合、一気にどこまで連続しているかを計算し、逆順に詰めているのでは？
    //

    // リングバッファの更新はrawのときは書き換え。
    // ×compressのときは挿入であり、右に1ずれる。終端は消えていく。例えば、最初にFFが16連続あった場合、16個挿入され、-1が右に16個消える
    // compressのときも上書き。

    // リングバッファの終端をまたぐ処理は全て可能。compressの中間もありえる
    // compressのコピー元を複製することはできない。現在位置から同じ色が2連続だったとしても、コピー元が2連続していなかったら1つだけコピーする
    //
    //
    //

    // リングバッファを初期化する
    const ring = new Array(0x1000).fill({ r: -1, g: -1, b: -1 });
    let ring_push_i = 0;

    // Mapを初期化する
    // この色の並びは、ringのどの位置にあるよ
    const colorMap = new Map<string, number>();
    // リングのこの位置には、Map内のこれが対応しているよ
    const positionMap = new Map<number, string[]>();

    for (let i = 0; i < pdtImage.pixels.length; i++) {
      const x = i % pdtImage.size.width;
      const y = Math.floor(i / pdtImage.size.width);
      console.log(y);

      flagMask >>= 1;
      if (flagMask === 0) {
        // 最後の1周にも同じ処理が必要
        let flagByte = 0;
        for (let j = 0; j < flag.length; j++) {
          flagByte += flag[j] << (flag.length - j - 1);
        }

        if (flagPosition < pixelBytes.length) {
          pixelBytes[flagPosition] = flagByte;
        }

        flagMask = 0x80;
        flag = [];
        flagPosition = pixelBytes.length;
        pixelBytes.push(0);
      }

      // この先の16Byteをringにコピー
      const currentBytes = pdtImage.pixels.slice(i, i + 16);
      for (let j = 0; j < currentBytes.length; j++) {
        ring[(ring_push_i + j) & 0x0fff] = currentBytes[j];
      }

      // Common.dumpColorMap(colorMap, x, y, "update_0before");
      // Common.dumpPositionMap(positionMap, x, y, "update_0before");

      // 減った16Byteぶんを加味して、木を更新
      // そのpositionを使っていた枝を消す
      this._removeFromMap(colorMap, positionMap, (ring_push_i - 16) & 0x0fff, 16);

      // 増えた16Byteぶんを加味して、木を更新
      // 影響あるのはリングバッファの最新計32Byteぶんのみ
      this._updateMap(colorMap, positionMap, ring, (ring_push_i - 16) & 0x0fff, 16);

      // Common.dumpColorMap(colorMap, x, y, "update_1after");
      // Common.dumpPositionMap(positionMap, x, y, "update_1after");

      // この先の16Byteがすでにringに含まれているかを調べる
      // ない場合は15Byteで調べる
      // まず現在地の1個左から左方向に探す。左端まで探したら、現在地の17個先から右方向に探す
      const resultOfFind = this._findInMap(colorMap, currentBytes);
      if (resultOfFind.position === -1) {
        // 見つからなかったので、圧縮されていない
        flag.push(1);

        // this._addToMap(colorMap, positionMap, currentBytes[0], ring_push_i);

        const pixel = currentBytes[0];
        ring[ring_push_i] = pixel;

        // Common.dumpRawRingAsJSON(ring, x, y, pixelBytes.length + 32, ring_push_i, pixel, "raw_0before");
        // // ringの現在位置を上書きする
        // Common.dumpRawRingAsJSON(ring, x, y, pixelBytes.length + 32, ring_push_i, pixel, "raw_1after");

        ring_push_i = (ring_push_i + 1) & 0x0fff;

        this._removeFromMap(colorMap, positionMap, ring_push_i, 1);

        // Common.dumpColorMap(colorMap, x, y, "update_2after");
        // Common.dumpPositionMap(positionMap, x, y, "update_2after");

        pixelBytes.push(pixel.b);
        pixelBytes.push(pixel.g);
        pixelBytes.push(pixel.r);
      } else {
        // 圧縮されている
        flag.push(0);

        // ringの現在位置から上書きする
        let ring_prev_i = resultOfFind.position;

        // Common.dumpCompressRingAsJSON(
        //   ring,
        //   x,
        //   y,
        //   pixelBytes.length + 32,
        //   ring_push_i,
        //   ring_prev_i,
        //   resultOfFind.length,
        //   currentBytes[0],
        //   "compress_0before"
        // );

        for (let j = 0; j < resultOfFind.length; j++) {
          ring[ring_push_i] = ring[ring_prev_i];
          ring_push_i = (ring_push_i + 1) & 0x0fff;
          ring_prev_i = (ring_prev_i + 1) & 0x0fff;
        }

        // マッチした長さだけリングバッファが進む
        // 減ったByteぶんを加味して、木を更新
        // そのpositionを使っていた枝を消す
        this._removeFromMap(colorMap, positionMap, ring_push_i, resultOfFind.length);

        // Common.dumpColorMap(colorMap, x, y, "update_3after");
        // Common.dumpPositionMap(positionMap, x, y, "update_3after");

        // Common.dumpCompressRingAsJSON(
        //   ring,
        //   x,
        //   y,
        //   pixelBytes.length + 32,
        //   ring_push_i,
        //   ring_prev_i,
        //   resultOfFind.length,
        //   currentBytes[resultOfFind.length - 1],
        //   "compress_1after"
        // );

        const offset = (ring_push_i - ring_prev_i - 1) & 0x0fff;

        pixelBytes.push(((offset << 4) & 0xf0) + ((resultOfFind.length - 1) & 0x0f));
        pixelBytes.push((offset >> 4) & 0xff);

        i += resultOfFind.length - 1;
      }

      // Common.dumpPDTBytesAsJSON(pixelBytes, i, pdtImage.size.width, pdtImage.size.height);
    }

    return pixelBytes;
  }

  private _findInMap(colorMap: Map<string, number>, currentBytes: Color[]) {
    for (let i = 0; i < currentBytes.length; i++) {
      const sub = currentBytes.slice(0, currentBytes.length - i);
      const colorsText = JSON.stringify(sub);
      const position = colorMap.get(colorsText);
      if (position !== undefined) {
        return { position, length: sub.length };
      }
    }

    return { position: -1, length: 0 };
  }

  private _addToMap(
    colorMap: Map<string, number>,
    positionMap: Map<number, string[]>,
    color: Color,
    ring_push_i: number
  ) {
    Logger.trace("colorMap", colorMap);
    Logger.trace("positionMap", positionMap);
    Logger.trace("color", color);
    Logger.trace("ring_push_i", ring_push_i);

    const colorsText = JSON.stringify([color]);
    colorMap.set(colorsText, ring_push_i);
    let colorss = positionMap.get(ring_push_i);
    if (colorss) {
      colorss.push(colorsText);
    } else {
      colorss = [colorsText];
    }

    positionMap.set(ring_push_i, colorss);
  }

  private _removeFromMap(
    colorMap: Map<string, number>,
    positionMap: Map<number, string[]>,
    startPosition: number,
    length: number
  ) {
    for (let i = 0; i < length; i++) {
      const position = (startPosition + i) & 0x0fff;
      const colorss = positionMap.get(position);
      if (colorss) {
        for (const colors of colorss) {
          colorMap.delete(colors);
        }
      }

      positionMap.delete(position);
    }
  }

  private _updateMap(
    colorMap: Map<string, number>,
    positionMap: Map<number, string[]>,
    ring: Color[],
    startPosition: number,
    length: number
  ) {
    for (let i = 0; i < length; i++) {
      for (let j = 0; j < 16; j++) {
        const currentStartPosition = (startPosition + i) & 0x0fff;
        const firstColor = ring[currentStartPosition];
        if (firstColor.r !== -1) {
          const colors = [];
          for (let k = 0; k < j + 1; k++) {
            const currentCopyPosition = (currentStartPosition + k) & 0x0fff;
            colors.push(ring[currentCopyPosition]);
          }

          if (colors.length > 0) {
            const colorsText = JSON.stringify(colors);
            colorMap.set(colorsText, currentStartPosition);
            let colorss = positionMap.get(currentStartPosition);
            if (colorss) {
              colorss.push(colorsText);
            } else {
              colorss = [colorsText];
            }

            positionMap.set(currentStartPosition, colorss);
          }
        }
      }
    }
  }

  private _findArrayInRing2(ring: Color[], currentBytes: Color[], ring_push_i: number) {
    const maxLength = currentBytes.length;
    let length;
    for (length = maxLength; length > 0; length--) {
      const targetBytes = [];
      for (let i = 0; i < length; i++) {
        const ring_k = (ring_push_i + i) & 0xfff;
        targetBytes.push(ring[ring_k]);
      }

      // 左方向に探す
      // ちょうど左端の場合、探さなくて良い
      let ring_prev_i = ring_push_i - 1;
      while (ring_prev_i >= 0) {
        const prevBytes = [];
        for (let i = 0; i < length; i++) {
          const ring_k = (ring_prev_i + i) & 0xfff;
          prevBytes.push(ring[ring_k]);
        }

        if (JSON.stringify(prevBytes) === JSON.stringify(targetBytes)) {
          const position = (ring_push_i - ring_prev_i - 1) & 0xfff;
          return { position, length, ring_prev_i };
        }

        ring_prev_i = ring_prev_i - 1;
      }

      // 右方向に探す
      // ちょうど右端の場合、探さなくて良い
      ring_prev_i = ring_push_i + 16;
      while (ring_prev_i <= 0x0fff) {
        const prevBytes = [];
        for (let i = 0; i < length; i++) {
          const ring_k = (ring_prev_i + i) & 0xfff;
          prevBytes.push(ring[ring_k]);
        }

        if (JSON.stringify(prevBytes) === JSON.stringify(targetBytes)) {
          const position = (ring_push_i - ring_prev_i - 1) & 0xfff;
          return { position, length, ring_prev_i };
        }

        ring_prev_i = ring_prev_i + 1;
      }
    }

    return { position: -1, length: 0, ring_prev_i: 0 };
  }

  private _findInRing(ring: Color[], pixel: Color, ring_push_i: number) {
    // console.log("pixel", pixel);
    for (let i = 0; i < ring.length - 1; i++) {
      let foundPosition = ring_push_i - 1 - i;
      if (foundPosition < 0) {
        foundPosition = ring.length - 1;
      }

      const p = ring[foundPosition];
      if (p.r === pixel.r && p.g === pixel.g && p.b === pixel.b) {
        return foundPosition;
      }
    }

    return -1;
  }

  private _findArrayInRing(ring: Color[], ring_origin_i: number, foundPosition: number, length: number) {
    let l = 0;
    let r = 0;
    for (l = 0; l < length; l++) {
      const currents = [];
      for (let k = 0; k < length - l; k++) {
        const ring_k = (ring_origin_i + k) & 0xfff;
        currents.push(ring[ring_k]);
      }

      for (r = 0; r < ring.length - length - (ring_origin_i - foundPosition); r++) {
        // let position = ring_push_i - 1 - ii;
        // if (position < 0) {
        //   position = ring.length - 1;
        // }

        const prevs = [];
        for (let k = 0; k < length - l; k++) {
          const ring_k = (foundPosition - r + k) & 0xfff;
          prevs.push(ring[ring_k]);
        }

        if (JSON.stringify(currents) === JSON.stringify(prevs)) {
          length = length - l;
          const position = ring_origin_i - foundPosition + r - 1;
          // const position = ring_origin_i - foundPosition + r;
          return { position, length };
          // break;
        }
      }
    }

    // length = length - j;
    // const position = r;

    return { position: -1, length: 0 };
  }

  // private _findInRing(ring: Color[], ring_push_i: number, targetBytes: Color[]) {
  //   let position = 0;
  //   let length = 0;

  //   const ringText = ring
  //     .map((r) => {
  //       return String.fromCharCode(r.r) + String.fromCharCode(r.g) + String.fromCharCode(r.b);
  //     })
  //     .join();

  //   // // まず16Byteぶん一致するかを調べる
  //   // // 一致しなかった場合、15Byteぶん一致するかを調べる
  //   for (let i = 0; i < 16; i++) {
  //     const targetText = targetBytes
  //       .slice(0, 16 - i)
  //       .map((r) => {
  //         return String.fromCharCode(r.r) + String.fromCharCode(r.g) + String.fromCharCode(r.b);
  //       })
  //       .join();

  //     const index = ringText.indexOf(targetText);
  //     if (index >= 0) {
  //       position = (ring_push_i - index - 1) & 0x0fff;
  //       length = 16 - i;
  //       break;
  //     }
  //   }

  // const foundPosition = _.findIndex(ring, (pixel) => {
  //   if (pixel.r === r && pixel.g === g && pixel.b === b) {
  //     return true;
  //   }

  //   return false;
  // });

  // if (foundPosition >= 0) {
  //   position = (ring_push_i - foundPosition - 1) & 0x0fff;
  //   length = 1;
  // }

  //   return { position, length };
  // }
}

export default Kanon;
