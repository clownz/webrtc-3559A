/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ export const description = `
createView validation tests.

TODO: review existing tests and merge with this plan:
> All x= every texture format for the underlying texture
>
> - view format doesn't match/isn't compatible
>     - with/without flag set <- I don't think this flag exists yet
>     - x= every possible view format
> - dimension isn't one of the following compatible options:
>     - texture 1d -> view 1d
>     - texture 2d -> view 2d, 2d-array, cube, cube-array
>     - texture 3d -> view 3d
> - {cube, cube-array} not enough layers
> - all aspects
>     - "depth-only" only allowed for D and DS
>     - "stencil-only" only allowed for S and DS
>     - "all" allowed for any format
> - baseMipLevel+mipLevelCount various values {in, out of} range
> - baseArrayLayer+arrayLayerCount various values {in, out of} range
`;
import { makeTestGroup } from '../../../common/framework/test_group.js';

import { ValidationTest } from './validation_test.js';

const ARRAY_LAYER_COUNT_2D = 6;
const MIP_LEVEL_COUNT = 6;
const FORMAT = 'rgba8unorm';

class F extends ValidationTest {
  createTexture(options = {}) {
    const {
      width = 32,
      height = 32,
      arrayLayerCount = 1,
      mipLevelCount = MIP_LEVEL_COUNT,
      sampleCount = 1,
    } = options;

    return this.device.createTexture({
      size: { width, height, depthOrArrayLayers: arrayLayerCount },
      mipLevelCount,
      sampleCount,
      dimension: '2d',
      format: FORMAT,
      usage: GPUTextureUsage.SAMPLED,
    });
  }

  getDescriptor(options = {}) {
    const {
      format = FORMAT,
      dimension = '2d',
      baseMipLevel = 0,
      mipLevelCount = MIP_LEVEL_COUNT,
      baseArrayLayer = 0,
      arrayLayerCount = 1,
    } = options;
    return {
      format,
      dimension,
      baseMipLevel,
      mipLevelCount,
      baseArrayLayer,
      arrayLayerCount,
    };
  }
}

export const g = makeTestGroup(F);

g.test('creating_texture_view_on_a_2D_non_array_texture')
  .desc(
    `TODO: write description, and shorten name

  TODO: mipLevelCount == 0 should mean 0, not "auto". "undefined" means "auto".`
  )
  .params([
    { _success: true }, // default view works
    { arrayLayerCount: 1, _success: true }, // it is OK to create a 2D texture view on a 2D texture
    { arrayLayerCount: 2, _success: false }, // it is an error to view a layer past the end of the texture
    { dimension: '2d-array', arrayLayerCount: 1, _success: true }, // it is OK to create a 1-layer 2D array texture view on a 2D texture
    // mip level is in range
    { mipLevelCount: 1, baseMipLevel: MIP_LEVEL_COUNT - 1, _success: true },
    { mipLevelCount: 2, baseMipLevel: MIP_LEVEL_COUNT - 2, _success: true },
    // baseMipLevel == k && mipLevelCount == 0 means to use levels k..end
    { mipLevelCount: 0, baseMipLevel: 0, _success: true },
    { mipLevelCount: 0, baseMipLevel: 1, _success: true },
    { mipLevelCount: 0, baseMipLevel: MIP_LEVEL_COUNT - 1, _success: true },
    { mipLevelCount: 0, baseMipLevel: MIP_LEVEL_COUNT, _success: false },
    // it is an error to make the mip level out of range
    { mipLevelCount: MIP_LEVEL_COUNT + 1, baseMipLevel: 0, _success: false },
    { mipLevelCount: MIP_LEVEL_COUNT, baseMipLevel: 1, _success: false },
    { mipLevelCount: 2, baseMipLevel: MIP_LEVEL_COUNT - 1, _success: false },
    { mipLevelCount: 1, baseMipLevel: MIP_LEVEL_COUNT, _success: false },
  ])
  .fn(async t => {
    const { dimension = '2d', arrayLayerCount, mipLevelCount, baseMipLevel, _success } = t.params;

    const texture = t.createTexture({ arrayLayerCount: 1 });

    const descriptor = t.getDescriptor({
      dimension,
      arrayLayerCount,
      mipLevelCount,
      baseMipLevel,
    });

    t.expectValidationError(() => {
      texture.createView(descriptor);
    }, !_success);
  });

g.test('creating_texture_view_on_a_2D_array_texture')
  .desc(
    `TODO: write description, and shorten name

  TODO: arrayLayerCount == 0 should mean 0, not "auto". "undefined" means "auto".`
  )
  .params([
    { _success: true }, // default view works
    { dimension: '2d', arrayLayerCount: 1, _success: true }, // it is OK to create a 2D texture view on a 2D array texture
    { arrayLayerCount: ARRAY_LAYER_COUNT_2D, _success: true }, // it is OK to create a 2D array texture view on a 2D array texture
    // baseArrayLayer == k && arrayLayerCount == 0 means to use layers k..end.
    { arrayLayerCount: 0, baseArrayLayer: 0, _success: true },
    { arrayLayerCount: 0, baseArrayLayer: 1, _success: true },
    { arrayLayerCount: 0, baseArrayLayer: ARRAY_LAYER_COUNT_2D - 1, _success: true },
    { arrayLayerCount: 0, baseArrayLayer: ARRAY_LAYER_COUNT_2D, _success: false },
    // It is an error for the array layer range of the view to exceed that of the texture
    { arrayLayerCount: ARRAY_LAYER_COUNT_2D + 1, baseArrayLayer: 0, _success: false },
    { arrayLayerCount: ARRAY_LAYER_COUNT_2D, baseArrayLayer: 1, _success: false },
    { arrayLayerCount: 2, baseArrayLayer: ARRAY_LAYER_COUNT_2D - 1, _success: false },
    { arrayLayerCount: 1, baseArrayLayer: ARRAY_LAYER_COUNT_2D, _success: false },
  ])
  .fn(async t => {
    const { dimension = '2d-array', arrayLayerCount, baseArrayLayer, _success } = t.params;

    const texture = t.createTexture({ arrayLayerCount: ARRAY_LAYER_COUNT_2D });

    const descriptor = t.getDescriptor({
      dimension,
      arrayLayerCount,
      baseArrayLayer,
    });

    t.expectValidationError(() => {
      texture.createView(descriptor);
    }, !_success);
  });

g.test('Using_defaults_validates_the_same_as_setting_values_for_more_than_1_array_layer')
  .params([
    { _success: true },
    { format: 'rgba8unorm', _success: true },
    { format: 'r8unorm', _success: false },
    { dimension: '2d-array', _success: true },
    { dimension: '2d', _success: false },
    { arrayLayerCount: ARRAY_LAYER_COUNT_2D, _success: false }, // setting array layers to non-0 means the dimensionality will default to 2D so by itself it causes an error.
    { arrayLayerCount: ARRAY_LAYER_COUNT_2D, dimension: '2d-array', _success: true },
    {
      arrayLayerCount: ARRAY_LAYER_COUNT_2D,
      dimension: '2d-array',
      mipLevelCount: MIP_LEVEL_COUNT,
      _success: true,
    },
  ])
  .fn(async t => {
    const { format, dimension, arrayLayerCount, mipLevelCount, _success } = t.params;

    const texture = t.createTexture({ arrayLayerCount: ARRAY_LAYER_COUNT_2D });

    const descriptor = { format, dimension, arrayLayerCount, mipLevelCount };

    t.expectValidationError(() => {
      texture.createView(descriptor);
    }, !_success);
  });

g.test('Using_defaults_validates_the_same_as_setting_values_for_only_1_array_layer')
  .params([
    { _success: true },
    { format: 'rgba8unorm', _success: true },
    { format: 'r8unorm', _success: false },
    { dimension: '2d-array', _success: true },
    { dimension: '2d', _success: true },
    { arrayLayerCount: 0, _success: true },
    { arrayLayerCount: 1, _success: true },
    { arrayLayerCount: 2, _success: false },
    { mipLevelCount: MIP_LEVEL_COUNT, _success: true },
    { mipLevelCount: 1, _success: true },
  ])
  .fn(async t => {
    const { format, dimension, arrayLayerCount, mipLevelCount, _success } = t.params;

    const texture = t.createTexture({ arrayLayerCount: 1 });

    const descriptor = { format, dimension, arrayLayerCount, mipLevelCount };

    t.expectValidationError(() => {
      texture.createView(descriptor);
    }, !_success);
  });

g.test('creating_cube_map_texture_view')
  .params([
    { dimension: 'cube', arrayLayerCount: 6, _success: true }, // it is OK to create a cube map texture view with arrayLayerCount == 6
    // it is an error to create a cube map texture view with arrayLayerCount != 6
    { dimension: 'cube', arrayLayerCount: 3, _success: false },
    { dimension: 'cube', arrayLayerCount: 7, _success: false },
    { dimension: 'cube', arrayLayerCount: 12, _success: false },
    { dimension: 'cube', _success: false },
    { dimension: 'cube-array', arrayLayerCount: 12, _success: true }, // it is OK to create a cube map array texture view with arrayLayerCount % 6 == 0
    // it is an error to create a cube map array texture view with arrayLayerCount % 6 != 0
    { dimension: 'cube-array', arrayLayerCount: 11, _success: false },
    { dimension: 'cube-array', arrayLayerCount: 13, _success: false },
  ])
  .fn(async t => {
    const { dimension = '2d-array', arrayLayerCount, _success } = t.params;

    const texture = t.createTexture({ arrayLayerCount: 16 });

    const descriptor = t.getDescriptor({
      dimension,
      arrayLayerCount,
    });

    t.expectValidationError(() => {
      texture.createView(descriptor);
    }, !_success);
  });

g.test('creating_cube_map_texture_view_with_a_non_square_texture')
  .params([
    { dimension: 'cube', arrayLayerCount: 6 }, // it is an error to create a cube map texture view with width != height.
    { dimension: 'cube-array', arrayLayerCount: 12 }, // it is an error to create a cube map array texture view with width != height.
  ])
  .fn(async t => {
    const { dimension, arrayLayerCount } = t.params;

    const nonSquareTexture = t.createTexture({
      arrayLayerCount: 18,
      width: 32,
      height: 16,
      mipLevelCount: 5,
    });

    const descriptor = t.getDescriptor({
      dimension,
      arrayLayerCount,
    });

    t.expectValidationError(() => {
      nonSquareTexture.createView(descriptor);
    });
  });

// TODO: add more tests when rules are fully implemented.
g.test('test_the_format_compatibility_rules_when_creating_a_texture_view').fn(async t => {
  const texture = t.createTexture({ arrayLayerCount: 1 });

  const descriptor = t.getDescriptor({
    format: 'depth24plus-stencil8',
  });

  // it is invalid to create a view in depth-stencil format on a RGBA texture
  t.expectValidationError(() => {
    texture.createView(descriptor);
  });
});

g.test('it_is_invalid_to_use_a_texture_view_created_from_a_destroyed_texture').fn(async t => {
  const texture = t.createTexture({ arrayLayerCount: 1 });

  const commandEncoder = t.device.createCommandEncoder();
  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        attachment: texture.createView(),
        loadValue: { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
      },
    ],
  });

  renderPass.endPass();

  texture.destroy();

  t.expectValidationError(() => {
    commandEncoder.finish();
  });
});

// TODO: Add tests for TextureAspect
