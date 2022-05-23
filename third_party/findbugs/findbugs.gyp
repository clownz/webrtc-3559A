# Copyright 2015 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

{
  'targets': [
    {
      # GN: //third_party/findbugs:format_string_java
      'target_name': 'format_string_jar',
      'type': 'none',
      'variables': {
        'jar_path': 'lib/jFormatString.jar',
      },
      'includes': [
        '../../build/host_prebuilt_jar.gypi',
      ]
    },
  ]
}