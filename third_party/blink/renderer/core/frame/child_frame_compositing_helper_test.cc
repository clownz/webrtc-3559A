// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/frame/child_frame_compositing_helper.h"

#include "cc/layers/layer.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/renderer/core/frame/child_frame_compositor.h"

namespace blink {

namespace {

class MockChildFrameCompositor : public ChildFrameCompositor {
 public:
  MockChildFrameCompositor() {
    constexpr int width = 32;
    constexpr int height = 32;
    sad_page_bitmap_.allocN32Pixels(width, height);
  }

  const scoped_refptr<cc::Layer>& GetCcLayer() override { return layer_; }

  void SetCcLayer(scoped_refptr<cc::Layer> layer,
                  bool is_surface_layer) override {
    layer_ = std::move(layer);
  }

  SkBitmap* GetSadPageBitmap() override { return &sad_page_bitmap_; }

 private:
  scoped_refptr<cc::Layer> layer_;
  SkBitmap sad_page_bitmap_;

  DISALLOW_COPY_AND_ASSIGN(MockChildFrameCompositor);
};

viz::SurfaceId MakeSurfaceId(const viz::FrameSinkId& frame_sink_id,
                             uint32_t parent_sequence_number,
                             uint32_t child_sequence_number = 1u) {
  return viz::SurfaceId(
      frame_sink_id,
      viz::LocalSurfaceId(parent_sequence_number, child_sequence_number,
                          base::UnguessableToken::Deserialize(0, 1u)));
}

}  // namespace

class ChildFrameCompositingHelperTest : public testing::Test {
 public:
  ChildFrameCompositingHelperTest() : compositing_helper_(&compositor_) {}

  ~ChildFrameCompositingHelperTest() override {}

  ChildFrameCompositingHelper* compositing_helper() {
    return &compositing_helper_;
  }

 private:
  MockChildFrameCompositor compositor_;
  ChildFrameCompositingHelper compositing_helper_;
  DISALLOW_COPY_AND_ASSIGN(ChildFrameCompositingHelperTest);
};

// This test verifies that the fallback surfaceId is cleared when the child
// frame is reported as being gone and a sad page is displayed.
TEST_F(ChildFrameCompositingHelperTest, ChildFrameGoneClearsFallback) {
  // The primary and fallback surface IDs should start out as invalid.
  EXPECT_FALSE(compositing_helper()->surface_id().is_valid());

  const viz::SurfaceId surface_id = MakeSurfaceId(viz::FrameSinkId(1, 1), 1);
  const gfx::Size frame_size_in_dip(100, 100);
  compositing_helper()->SetSurfaceId(surface_id, frame_size_in_dip, false);
  EXPECT_EQ(surface_id, compositing_helper()->surface_id());

  // Reporting that the child frame is gone should clear the surface id.
  compositing_helper()->ChildFrameGone(1.f);
  EXPECT_FALSE(compositing_helper()->surface_id().is_valid());
}

}  // namespace blink
