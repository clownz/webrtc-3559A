// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "base/power_monitor/test/fake_power_monitor_source.h"

#include <memory>

#include "base/power_monitor/power_monitor.h"
#include "base/power_monitor/power_monitor_source.h"

namespace base {
namespace test {

class FakePowerMonitorSource : public base::PowerMonitorSource {
 public:
  void Resume() { ProcessPowerEvent(RESUME_EVENT); }
  void Suspend() { ProcessPowerEvent(SUSPEND_EVENT); }

  void SetOnBatteryPower(bool on_battery_power) {
    on_battery_power_ = on_battery_power;
    PowerMonitorSource::ProcessPowerEvent(POWER_STATE_EVENT);
  }

  // base::PowerMonitorSource:
  bool IsOnBatteryPower() override { return on_battery_power_; }

 private:
  bool on_battery_power_ = false;
};

// ScopedFakePowerMonitorSource implementation
ScopedFakePowerMonitorSource::ScopedFakePowerMonitorSource() {
  auto fake_power_monitor_source = std::make_unique<FakePowerMonitorSource>();
  fake_power_monitor_source_ = fake_power_monitor_source.get();
  base::PowerMonitor::Initialize(std::move(fake_power_monitor_source));
}

ScopedFakePowerMonitorSource::~ScopedFakePowerMonitorSource() {
  base::PowerMonitor::ShutdownForTesting();
}

void ScopedFakePowerMonitorSource::Resume() {
  fake_power_monitor_source_->Resume();
}

void ScopedFakePowerMonitorSource::Suspend() {
  fake_power_monitor_source_->Suspend();
}

void ScopedFakePowerMonitorSource::SetOnBatteryPower(bool on_battery_power) {
  fake_power_monitor_source_->SetOnBatteryPower(on_battery_power);
}

}  // namespace test
}  // namespace base
