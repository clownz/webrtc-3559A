/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ import { assert, unreachable } from '../../../common/framework/util/util.js';
import { kSizedTextureFormatInfo } from '../../capability_info.js';
import { align, isAligned } from '../math.js';

import { bytesInACompleteRow } from './image_copy.js';

export const kBytesPerRowAlignment = 256;
export const kBufferCopyAlignment = 4;

const kDefaultLayoutOptions = { mipLevel: 0, bytesPerRow: undefined, rowsPerImage: undefined };

export function getMipSizePassthroughLayers(dimension, size, mipLevel) {
  const shiftMinOne = n => Math.max(1, n >> mipLevel);
  switch (dimension) {
    case '1d':
      assert(size[2] === 1);
      return [shiftMinOne(size[0]), size[1], size[2]];
    case '2d':
      return [shiftMinOne(size[0]), shiftMinOne(size[1]), size[2]];
    case '3d':
      return [shiftMinOne(size[0]), shiftMinOne(size[1]), shiftMinOne(size[2])];
    default:
      unreachable();
  }
}

export function getTextureCopyLayout(format, dimension, size, options = kDefaultLayoutOptions) {
  const { mipLevel } = options;
  let { bytesPerRow, rowsPerImage } = options;

  const mipSize = getMipSizePassthroughLayers(dimension, size, mipLevel);

  const { blockWidth, blockHeight, bytesPerBlock } = kSizedTextureFormatInfo[format];

  // We align mipSize to be the physical size of the texture subresource.
  mipSize[0] = align(mipSize[0], blockWidth);
  mipSize[1] = align(mipSize[1], blockHeight);

  const minBytesPerRow = bytesInACompleteRow(mipSize[0], format);
  const alignedMinBytesPerRow = align(minBytesPerRow, kBytesPerRowAlignment);
  if (bytesPerRow !== undefined) {
    assert(bytesPerRow >= alignedMinBytesPerRow);
    assert(isAligned(bytesPerRow, kBytesPerRowAlignment));
  } else {
    bytesPerRow = alignedMinBytesPerRow;
  }

  if (rowsPerImage !== undefined) {
    assert(rowsPerImage >= mipSize[1]);
  } else {
    rowsPerImage = mipSize[1];
  }

  const bytesPerSlice = bytesPerRow * rowsPerImage;
  const sliceSize =
    bytesPerRow * (mipSize[1] / blockHeight - 1) + bytesPerBlock * (mipSize[0] / blockWidth);
  const byteLength = bytesPerSlice * (mipSize[2] - 1) + sliceSize;

  return {
    bytesPerBlock,
    byteLength: align(byteLength, kBufferCopyAlignment),
    minBytesPerRow,
    bytesPerRow,
    rowsPerImage,
    mipSize,
  };
}

export function fillTextureDataWithTexelValue(
  texelValue,
  format,
  dimension,
  outputBuffer,
  size,
  options = kDefaultLayoutOptions
) {
  const { blockWidth, blockHeight, bytesPerBlock } = kSizedTextureFormatInfo[format];
  assert(bytesPerBlock === texelValue.byteLength);

  const { byteLength, rowsPerImage, bytesPerRow } = getTextureCopyLayout(
    format,
    dimension,
    size,
    options
  );

  assert(byteLength <= outputBuffer.byteLength);

  const mipSize = getMipSizePassthroughLayers(dimension, size, options.mipLevel);

  const texelValueBytes = new Uint8Array(texelValue);
  const outputTexelValueBytes = new Uint8Array(outputBuffer);
  for (let slice = 0; slice < mipSize[2]; ++slice) {
    for (let row = 0; row < mipSize[1]; row += blockHeight) {
      for (let col = 0; col < mipSize[0]; col += blockWidth) {
        const byteOffset =
          slice * rowsPerImage * bytesPerRow + row * bytesPerRow + col * texelValue.byteLength;
        outputTexelValueBytes.set(texelValueBytes, byteOffset);
      }
    }
  }
}

export function createTextureUploadBuffer(
  texelValue,
  device,
  format,
  dimension,
  size,
  options = kDefaultLayoutOptions
) {
  const { byteLength, bytesPerRow, rowsPerImage, bytesPerBlock } = getTextureCopyLayout(
    format,
    dimension,
    size,
    options
  );

  const buffer = device.createBuffer({
    mappedAtCreation: true,
    size: byteLength,
    usage: GPUBufferUsage.COPY_SRC,
  });

  const mapping = buffer.getMappedRange();

  assert(texelValue.byteLength === bytesPerBlock);
  fillTextureDataWithTexelValue(texelValue, format, dimension, mapping, size, options);
  buffer.unmap();

  return {
    buffer,
    bytesPerRow,
    rowsPerImage,
  };
}
