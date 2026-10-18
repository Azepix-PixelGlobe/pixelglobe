/*
 * Manage stored canvas files
 * Format description in doc/FORMAT.md
 */

/* eslint-disable */
import fs, { promises as fsPromises } from 'fs';

class StoredCanvas {
  static ALIGNMENT = 4096;
  static VERSION = 1;

  ready = false;
  #file;
  #alignment;
  width;
  height;
  offset_x;
  offset_y;
  /*
   * offsets of important chunks in file
   */
  chunkIndexOffset;
  chunkIndex;
  /*
   * identifier of canvas, usually one char
   */
  ident;
  /*
   * list of sparse holes in files, Map<Set<number>>
   */
  dataOffset;
  freeOffsetOffset;
  free = new Map();
  /*
   * byte offsets of chunks, Uint8Array[width * height * 8 + 4]
   */
  index;
  /*
   * whether or not we cache chunks
   */
  cache = true;
  /*
   * Chunk cache in RAM, chunks will dynamically load and get removed from it
   * chunkId => chunk
   * ((i << 8) | j) => Uint8Array
   */
  chunkCache = new Map();
  /*
   * memory limits for chunks in kB
   */
  memoryLimit;
  usedMemory = 0;
  /*
   * track filesize
   */
  fileSize;

  /**
   * convert number to uint64 buffer
   * @param number
   * @return Buffer(8)
   */
  static getUInt64Buffer(number) {
    const buffer = Buffer.allocUnsafe(8);
    if (number > 0xFFFFFFFF) {
      buffer.writeUInt32BE(Math.floor(number / 0x100000000), 0);
      buffer.writeUInt32BE(number & 0xFFFFFFFF, 4);
    } else {
      buffer.writeUInt32BE(0, 0);
      buffer.writeUInt32BE(number, 4);
    }
  }

  /**
   * write uint64 to buffer
   * @param buffer
   * @param position
   * @param number
   */
  static writeUInt64BEToBuffer(buffer, position, number) {
    buffer.writeInt32BE(number & 0xFFFFFFFF, position);
    buffer.writeInt32BE(Math.floor(number / 0x100000000), position + 4);
  }

  /**
   * reads a UInt64 from a buffer
   * @param buffer
   * @param position
   * @return number
   */
  static readUInt64OfBuffer(buffer, position = 0) {
    const hb = buffer.readUInt32BE(position);
    const lb = buffer.readUInt32BE(position + 4);
    return hb * 0x100000000 + lb;
  }

  /**
   * reads a UInt64 from a buffer
   * @param buffer
   * @param position
   * @return number
   */
  static readInt64OfBuffer(buffer, position = 0) {
    const hb = buffer.readInt32BE(position);
    const lb = buffer.readUInt32BE(position + 4);
    return hb * 0x100000000 + lb;
  }

  /**
   * @param memoryLimit memory limit in kB
   */
  constructor(memoryLimit = 1024 * 1024) {
    this.memoryLimit = memoryLimit;
  }

  /**
   * load chunk file
   * @param filepath path to file
   * @param opions parameters to apply when creating new file {
   *   ident: identifier of canvas, usually a single letter,
   *   colors: Array colors of the palette in [[r, g, b], ...],
   *   width, height: size of convas, usually square,
   * }
   * @return success boolean
   */
  async load(filepath, options) {
    const file = await fsPromises.open(filepath, 'r+');
    /*
     * Header:
     *   'PPFUN' + version + width + height + offset_x + offset_y + flags + alignment
     *   + index_start_offset + first_free_offset + palette_offset + ident_offset
     * Ident:
     *   'IDEN' + length + chars[]
     * Palette:
     *   'PALE' + offset_next_palette + used + 256 * rgb
     * Index:
     *   'INDX' + width * height * 8
     */
    let length = 4 + 4 + 2 + 2 + 8 + 8 + 2 + 2 + 8 + 8 + 8 + 8;
    let buffer = Buffer.allocUnsafe(length);
    let { bytesRead } = await file.read(buffer);
    if (bytesRead !== length
      || buffer.toString('ascii', 0, 4) !== 'PPFU'
    ) {
      throw new Error('Not a PPFUN Canvas File');
    }
    let offset = 8;
    this.width = buffer.readUInt16BE(buffer, 8);
    offset += 4;
    this.height = buffer.readUInt16BE(buffer, 8);
    offset += 4;
    this.offset_x = StoredCanvas.readInt64OfBuffer(buffer, offset);
    offset += 8;
    this.offset_y = StoredCanvas.readInt64OfBuffer(buffer, offset);
    offset += 8 + 2;
    this.#alignment = buffer.readUInt16BE(buffer, offset);
    offset += 2;
    const identOffset = StoredCanvas.readUInt64OfBuffer(buffer, offset);
    offset += 8;
    const paletteOffset = StoredCanvas.readUInt64OfBuffer(buffer, offset);
    offset += 8;
    this.chunkIndexOffset = StoredCanvas.readUInt64OfBuffer(buffer, offset);
    offset += 8;
    const firstFreeOffset = StoredCanvas.readUInt64OfBuffer(buffer, offset);
    /* ident */
    length = 5;
    ({ bytesRead } = await file.read(buffer, 0, length, identOffset));
    if (bytesRead !== length
      || buffer.toString('ascii', 0, 4) !== 'IDEN'
    ) {
      throw new Error('No ident in chunk file');
    }
    length = buffer.readUInt8(4);
    if (length > buffer.byteLength) {
      buffer = Buffer.allocUnsafe(length);
    }
    ({ bytesRead } = await file.read(buffer, 0, length, identOffset + 5));
    if (bytesRead !== length) {
      throw new Error('No ident in chunk file');
    }
    this.ident = buffer.toString('ascii', 0, length);
    /* chunk index */
    length = 4;
    ({ bytesRead } = await file.read(buffer, 0, length, this.chunkIndexOffset));
    if (bytesRead !== length
      || buffer.toString('ascii', 0, 4) !== 'INDX'
    ) {
      throw new Error('No index in chunk file');
    }
    length = this.width * this.height * 8;
    this.chunkIndex = Buffer.allocUnsafe(length);
    ({ bytesRead } = await file.read(buffer, 0, length, this.chunkIndexOffset + 4));
    if (bytesRead !== length) {
      throw new Error('No index in chunk file');
    }
    this.#file = file;
  }

  /**
   * create new chunk file
   * @param filepath path to file
   * @param opions parameters to apply when creating new file {
   *   ident: identifier of canvas, usually a single letter,
   *   colors: Array colors of the palette in [[r, g, b], ...],
   *   width, height: size of convas, usually square,
   * }
   * @return success boolean
   */
  async create(filepath, {
    ident, colors, width, height, offset_x = 0, offset_y = 0,
  }) {
    const file = await fsPromises.open(filepath, 'wx+');
    /*
     * Header:
     *   'PPFUN' + version + width + height + offset_x + offset_y + flags + alignment
     *   + index_start_offset + first_free_offset + palette_offset + ident_offset
     *   + data_offset
     * Ident:
     *   'IDEN' + length + chars[]
     * Palette:
     *   'PALE' + offset_next_palette + used + 256 * rgb
     * Index:
     *   'INDX' + width * height * 8
     */
    const headerLength = 4 + 4 + 2 + 2 + 8 + 8 + 2 + 2 + 8 + 8 + 8 + 8 + 8;
    const identLength = 4 + 1 + ident.length;
    const indexLength = 4 + 8 * width * height;
    const buffer = Buffer.alloc(
      headerLength + identLength + indexLength,
    );
    this.ident = ident;
    this.width = width;
    this.height = height;
    this.#alignment = StoredCanvas.ALIGNMENT;
    this.chunkIndexOffset = headerLength + identLength;
    this.dataOffset = headerLength + identLength + indexLength;
    this.chunkIndex = Buffer.alloc(width * height * 8);
    this.freeOffsetOffset = 4 + 4 + 2 + 2 + 8 + 8 + 2 + 2 + 8 + 8 + 8;
    this.fileSize = buffer.length;
    this.#file = file;

    buffer.write('PPFU', 0, 4, 'ascii');
    let offset = 4;
    buffer.writeUInt32BE(StoredCanvas.VERSION, offset);
    offset += 4;
    buffer.writeUInt16BE(width, offset);
    offset += 2;
    buffer.writeUInt16BE(height, offset);
    offset += 2;
    StoredCanvas.writeUInt64BEToBuffer(buffer, offset, offset_x);
    offset += 8;
    StoredCanvas.writeUInt64BEToBuffer(buffer, offset, offset_y);
    /* flags */
    offset += 8 + 2;
    buffer.writeUInt16BE(StoredCanvas.ALIGNMENT, offset);
    offset += 2 + 4;
    buffer.writeUInt32BE(headerLength, offset);
    offset += 4 + 4;
    buffer.writeUInt32BE(this.chunkIndexOffset, offset);
    offset += 4 + 4;
    buffer.writeUInt32BE(this.dataOffset, offset);
    offset += 4 + 8 + 8;
    buffer.write('IDEN', offset, offset += 4, 'ascii');
    buffer.writeUInt8(ident.length, offset);
    offset += 1;
    buffer.write(ident, offset, offset += ident.length, 'ascii');
    buffer.write('INDX', offset, offset += 4, 'ascii');

    this.loadPaletteFromColors(colors);
    await file.write(buffer, 0);
    await this.writePaletteFromColors(colors);
    this.ready = true;
  }

  /**
   * reads a UInt64 from a file
   * @param position position to read or null to use current
   * @return Number() or BigInt(), depending on its size
   */
  async readUInt64(position = null) {
    const buffer64 = Buffer.allocUnsafe(8);
    const { bytesRead } = await this.#file.read(buffer64, 0, 8, position);
    if (bytesRead !== 8) {
      return 0;
    }
    const hb = buffer64.readUInt32BE(0);
    const lb = buffer64.readUInt32BE(4);
    return hb * 0x100000000 + lb;
  }

  /**
   * append buffer to file,
   * @param buffer
   * @param padding size after buffer to leave free
   * @return offset where we appended as Buffer
   */
  async appendToFile(buffer, padding = 0) {
    const position = this.fileSize;
    await this.#file.write(buffer, 0, buffer.length, position);
    this.fileSize = position + buffer.length + padding;
    return position;
  }

  /*
   * populate this.free from file
   */
  async readAllFreeSpaces() {
    const { free, '#file': file } = this;
    free.clear();
    let freeOffset = await this.readUInt64(
      4 + 4 + 2 + 2 + 8 + 8 + 2 + 2 + 8 + 8 + 8,
    );
    const tempBuffer = Buffer.allocUnsafe(4 + 8 + 4);
    const freeBuffer = Buffer.allocUnsafe(this.#alignment);

    while (freeOffset !== 0) {
      let { bytesRead } = await file.read(
        tempBuffer, 0, tempBuffer.length, freeOffset,
      );
      if (bytesRead !== tempBuffer.length
        || tempBuffer.toString('ascii', 0, 4) !== 'FREE'
      ) {
        throw new Error('Could not read free index chunk');
      }
      let length = tempBuffer.readUInt32BE(4 + 8) * 12;
      ({ bytesRead } = await file.read(
        freeBuffer, 0, length, freeOffset + 4 + 8 + 1,
      ));
      if (bytesRead !== length) {
        throw new Error('Could not read free index chunk');
      }

      while (length > 0) {
        length -= 8;
        const offset = StoredCanvas.readUInt64OfBuffer(freeBuffer, length);
        length -= 4;
        const alignmentSize = Math.floor(
          freeBuffer.readUInt32BE(freeBuffer, length) / this.#alignment,
        );
        let alignmentSet = free.get(alignmentSize);
        if (!alignmentSet) {
          alignmentSet = new Set();
          free.set(alignmentSize, alignmentSet);
        }
        alignmentSet.add(offset);
      }

      freeOffset = StoredCanvas.readUInt64OfBuffer(tempBuffer, 4);
    }
  }

  /**
   * write palette into file
   * @param colors Array colors of the palette in [[r, g, b], ...]
   */
  async writePaletteFromColors(colors) {
    let offsetOffset = 4 + 4 + 2 + 2 + 8 + 8 + 2 + 2 + 8 + 8 + 8 + 8;
    let paletteOffset = await this.readUInt64(offsetOffset);
    /*
     * palette is split into alignment sized chunks
     */
    const alignment = this.#alignment;
    const maxColors = Math.floor((alignment - 2 - 8 - 4) / 4);

    const buffer = Buffer.allocUnsafe(alignment);
    buffer.write('PALE', 0, 4, 'ascii');

    let i = 0;
    while (i < colors.length) {
      const colorsPart = colors.slice(i, i += maxColors);
      const colorsAmount = colorsPart.length;
      let offset = 4 + 8;
      buffer.writeUInt16BE(colorsAmount, offset);
      offset += 2;
      for (let c = 0; c < colorsPart.length; c += 1) {
        const [r, g, b] = colorsPart[c];
        buffer.writeUInt8(r, offset);
        offset += 1;
        buffer.writeUInt8(g, offset);
        offset += 1;
        buffer.writeUInt8(b, offset);
        offset += 1;
        buffer.writeUInt8(0, offset);
        offset += 1;
      }
      buffer.fill(0, offset);

      if (paletteOffset === 0) {
        paletteOffset = await this.appendToFile(buffer);
        await this.#file.write(
          StoredCanvas.getUInt64Buffer(paletteOffset), 0, 8, offsetOffset,
        );
        offsetOffset = paletteOffset + 4;
        paletteOffset = 0;
      } else {
        offsetOffset = paletteOffset + 4;
        const nextOffset = await this.readUInt64(offsetOffset);
        if (nextOffset !== 0) {
          StoredCanvas.writeUInt64BEToBuffer(buffer, 4, nextOffset);
        }
        await this.#file.write(buffer, 0, alignment, paletteOffset);
        paletteOffset = nextOffset;
      }
    }
  }
}

export default StoredCanvas;
