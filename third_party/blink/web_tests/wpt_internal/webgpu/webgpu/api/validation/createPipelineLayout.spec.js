/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ export const description = `
createPipelineLayout validation tests.

TODO: review existing tests, write descriptions, and make sure tests are complete.
`;
import { poptions, params } from '../../../common/framework/params_builder.js';
import { makeTestGroup } from '../../../common/framework/test_group.js';
import { kBindingTypeInfo } from '../../capability_info.js';

import { ValidationTest } from './validation_test.js';

function clone(descriptor) {
  return JSON.parse(JSON.stringify(descriptor));
}

export const g = makeTestGroup(ValidationTest);

g.test('number_of_dynamic_buffers_exceeds_the_maximum_value')
  .desc(
    `TODO: describe

TODO(#230): Update to enforce per-stage and per-pipeline-layout limits on BGLs as well.`
  )
  .params(
    params()
      .combine(poptions('visibility', [0, 2, 4, 6]))
      .combine(poptions('type', ['uniform-buffer', 'storage-buffer', 'readonly-storage-buffer']))
  )
  .fn(async t => {
    const { type, visibility } = t.params;
    const { maxDynamic } = kBindingTypeInfo[type].perPipelineLimitClass;

    const maxDynamicBufferBindings = [];
    for (let binding = 0; binding < maxDynamic; binding++) {
      maxDynamicBufferBindings.push({ binding, visibility, type, hasDynamicOffset: true });
    }

    const maxDynamicBufferBindGroupLayout = t.device.createBindGroupLayout({
      entries: maxDynamicBufferBindings,
    });

    const goodDescriptor = {
      entries: [{ binding: 0, visibility, type, hasDynamicOffset: false }],
    };

    const goodPipelineLayoutDescriptor = {
      bindGroupLayouts: [
        maxDynamicBufferBindGroupLayout,
        t.device.createBindGroupLayout(goodDescriptor),
      ],
    };

    // Control case
    t.device.createPipelineLayout(goodPipelineLayoutDescriptor);

    // Check dynamic buffers exceed maximum in pipeline layout.
    const badDescriptor = clone(goodDescriptor);
    badDescriptor.entries[0].hasDynamicOffset = true;

    const badPipelineLayoutDescriptor = {
      bindGroupLayouts: [
        maxDynamicBufferBindGroupLayout,
        t.device.createBindGroupLayout(badDescriptor),
      ],
    };

    t.expectValidationError(() => {
      t.device.createPipelineLayout(badPipelineLayoutDescriptor);
    });
  });

g.test('number_of_bind_group_layouts_exceeds_the_maximum_value').fn(async t => {
  const bindGroupLayoutDescriptor = {
    entries: [],
  };

  // 4 is the maximum number of bind group layouts.
  const maxBindGroupLayouts = [1, 2, 3, 4].map(() =>
    t.device.createBindGroupLayout(bindGroupLayoutDescriptor)
  );

  const goodPipelineLayoutDescriptor = {
    bindGroupLayouts: maxBindGroupLayouts,
  };

  // Control case
  t.device.createPipelineLayout(goodPipelineLayoutDescriptor);

  // Check bind group layouts exceed maximum in pipeline layout.
  const badPipelineLayoutDescriptor = {
    bindGroupLayouts: [
      ...maxBindGroupLayouts,
      t.device.createBindGroupLayout(bindGroupLayoutDescriptor),
    ],
  };

  t.expectValidationError(() => {
    t.device.createPipelineLayout(badPipelineLayoutDescriptor);
  });
});
