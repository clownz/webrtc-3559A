// Copyright 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/p2p/empty_network_manager.h"

#include "base/bind.h"
#include "base/check_op.h"
#include "base/location.h"
#include "base/threading/thread_task_runner_handle.h"
#include "third_party/blink/renderer/platform/p2p/ipc_network_manager.h"
#include "third_party/blink/renderer/platform/p2p/network_manager_uma.h"

namespace blink {

EmptyNetworkManager::EmptyNetworkManager(IpcNetworkManager* network_manager)
    : EmptyNetworkManager(network_manager, network_manager->AsWeakPtr()) {}

// DO NOT dereference/check `network_manager_weak` in the ctor! Doing so would
// bind its WeakFactory to the constructing thread (main thread) instead of
// the thread `this` lives in (signaling thread).
EmptyNetworkManager::EmptyNetworkManager(
    rtc::NetworkManager* network_manager,
    base::WeakPtr<rtc::NetworkManager> network_manager_weak)
    : network_manager_(network_manager_weak) {
  DCHECK(network_manager);
  DETACH_FROM_THREAD(thread_checker_);
  set_enumeration_permission(ENUMERATION_BLOCKED);
  network_manager->SignalNetworksChanged.connect(
      this, &EmptyNetworkManager::OnNetworksChanged);
}

EmptyNetworkManager::~EmptyNetworkManager() {
  DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
}

void EmptyNetworkManager::StartUpdating() {
  DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
  DCHECK(network_manager_);
  ++start_count_;
  network_manager_->StartUpdating();
}

void EmptyNetworkManager::StopUpdating() {
  DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);

  if (network_manager_)
    network_manager_->StopUpdating();

  --start_count_;
  DCHECK_GE(start_count_, 0);
}

void EmptyNetworkManager::GetNetworks(NetworkList* networks) const {
  DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
  networks->clear();
}

bool EmptyNetworkManager::GetDefaultLocalAddress(
    int family,
    rtc::IPAddress* ipaddress) const {
  DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
  DCHECK(network_manager_);
  return network_manager_->GetDefaultLocalAddress(family, ipaddress);
}

void EmptyNetworkManager::OnNetworksChanged() {
  DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);

  if (!start_count_)
    return;

  if (!sent_first_update_)
    blink::ReportIPPermissionStatus(blink::PERMISSION_NOT_REQUESTED);

  sent_first_update_ = true;
  SignalNetworksChanged();
}

}  // namespace blink
