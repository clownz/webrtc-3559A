// -*- C++ -*-
//===----------------------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

// This test checks that we retain extern template instantiation declarations
// for members of <locale> even when the debug mode is enabled, which is
// necessary for correctness. See https://llvm.org/D94718 for details.

// UNSUPPORTED: libcxx-no-debug-mode
// UNSUPPORTED: libcpp-has-no-localization

// RUN: %{cxx} %{flags} %{compile_flags} %s %{link_flags} -fPIC -DTU1 -D_LIBCPP_DEBUG=1 -fvisibility=hidden -shared -o %t.lib
// RUN: cd %T && %{cxx} %{flags} %{compile_flags} %s ./%basename_t.tmp.lib %{link_flags} -fPIC -DTU2 -D_LIBCPP_DEBUG=1 -fvisibility=hidden -o %t.exe
// RUN: %{exec} %t.exe

#include <cassert>
#include <cstdio>
#include <sstream>
#include <string>

std::string __attribute__((visibility("default"))) numToString(int x);

#if defined(TU1)

std::string numToString(int x) {
  std::stringstream ss;
  ss << x;
  return ss.str();
}

#elif defined(TU2)

int main(int, char**) {
  std::string s = numToString(42);
  assert(s == "42");

  return 0;
}

#endif
