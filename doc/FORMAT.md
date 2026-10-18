# PPFUN Canvas File Format

All multi byte numbers are Big Endian

Header, Ident and Index chunks are not bound to alignment-size (4069 bytes),
they have to be first in file. Out of which Header needs to start.

Each Palette and Free has to be exactly alignment-sized.
Each Chunk has to be a multiple of alignment-size.

Header {
  uint8 [4] "PPFU";
  uint32 version;
  uint16 width (in chunks)256;
  uint16 height (in chunks)256;
  int64 offset_x (signed offset of canvas, it could be part of a larger one);
  int64 offset_y;
  uint16 flags 0; // unused
  uint16 alignment 4096;
  uint64 ident_offset;
  uint64 index_offset;
  uint64 data_offset (start of data area in which every chunk has to be a multiple of alignment-size, includes palette and
  uint64 first_free_offset;
  uint64 palette_offset; free);
}

Ident {
  uint8 [4] "IDEN";
  uint8 length;
  char[length] ident;
}

Index {
  uint8 [4] "INDX";
  Row {
    Column {
        uint64 chunk_offset;
    }[width]
  }[height]
}

FreeOffsets {
  uint4 [4] "FROF";
  uint64 first_offset_free_size_alignment*1;
  uint64 last_offset_free_size_alignment*1;
  uint64 first_offset_free_size_alignment*2;
  uint64 last_offset_free_size_alignment*2;
  uint64 first_offset_free_size_alignment*3;
  uint64 last_offset_free_size_alignment*3;
  ...continue till alignment size
}

FreeBitmap {
  uint8 [4] "FRBM";
  uint64 offset_next_free;
  uint8 [] bitmap till alignment size;
}

Palette {
  uint8 [4] "PALE";
  uint64 offset_next_palette;
  uint16 amount_used;
  COLOR {
    uint8 R;
    uint8 G;
    uint8 B;
    uint8 A;
  }[1020]
  uint8 [] padding to alignment size;
}

Free {
  uint8 [4] "FREE";
  uint64 offset_next_free;
  uint32 amount_used;
  Free {
    uint32 reserved_length (multiple of alignment);
    uint64 offset;
  }[340]
  uint8 [] padding to alignment size;
}

Chunk {
  uint8 [4] "CHUN"; // change it to "FREE" when its cleaned
  uint32 reserved_length (multiple of alignment, WHOLE chunk size, including 'CHUN');
  uint32 length;
  uint8 compression_method;
  data
  uint32 crc32_checksum;
  uint8 [] padding to alignment size;
}
