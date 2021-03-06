/*
 * Copyright (C) 2019 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "perfetto/profiling/pprof_builder.h"

#include "perfetto/base/build_config.h"

#if !PERFETTO_BUILDFLAG(PERFETTO_OS_WIN)
#include <cxxabi.h>
#endif

#include <inttypes.h>

#include <algorithm>
#include <map>
#include <set>
#include <utility>
#include <vector>

#include "tools/trace_to_text/utils.h"

#include "perfetto/base/logging.h"
#include "perfetto/base/time.h"
#include "perfetto/ext/base/string_utils.h"
#include "perfetto/ext/base/utils.h"
#include "perfetto/protozero/packed_repeated_fields.h"
#include "perfetto/protozero/scattered_heap_buffer.h"
#include "perfetto/trace_processor/trace_processor.h"

#include "src/profiling/symbolizer/symbolize_database.h"
#include "src/profiling/symbolizer/symbolizer.h"

#include "protos/perfetto/trace/trace.pbzero.h"
#include "protos/perfetto/trace/trace_packet.pbzero.h"
#include "protos/third_party/pprof/profile.pbzero.h"

namespace perfetto {
namespace trace_to_text {

namespace {

using ::perfetto::trace_processor::Iterator;

void MaybeDemangle(std::string* name) {
#if PERFETTO_BUILDFLAG(PERFETTO_OS_WIN)
  char* data = nullptr;
#else
  int ignored;
  char* data = abi::__cxa_demangle(name->c_str(), nullptr, nullptr, &ignored);
#endif
  if (data) {
    *name = data;
    free(data);
  }
}

uint64_t ToPprofId(int64_t id) {
  PERFETTO_DCHECK(id >= 0);
  return static_cast<uint64_t>(id) + 1;
}

std::string AsCsvString(std::vector<uint64_t> vals) {
  std::string ret;
  for (size_t i = 0; i < vals.size(); i++) {
    if (i != 0) {
      ret += ",";
    }
    ret += std::to_string(vals[i]);
  }
  return ret;
}

// Return map from callsite_id to list of frame_ids that make up the callstack.
std::vector<std::vector<int64_t>> GetCallsiteToFrames(
    trace_processor::TraceProcessor* tp) {
  Iterator count_it =
      tp->ExecuteQuery("select count(*) from stack_profile_callsite;");
  if (!count_it.Next()) {
    PERFETTO_DFATAL_OR_ELOG("Failed to get number of callsites: %s",
                            count_it.Status().message().c_str());
    return {};
  }
  int64_t count = count_it.Get(0).AsLong();

  Iterator it = tp->ExecuteQuery(
      "select id, parent_id, frame_id from stack_profile_callsite order by "
      "depth;");
  std::vector<std::vector<int64_t>> result(static_cast<size_t>(count));
  while (it.Next()) {
    int64_t id = it.Get(0).AsLong();
    int64_t frame_id = it.Get(2).AsLong();
    std::vector<int64_t>& path = result[static_cast<size_t>(id)];
    path.push_back(frame_id);

    auto parent_id_value = it.Get(1);
    if (!parent_id_value.is_null()) {
      const std::vector<int64_t>& parent_path =
          result[static_cast<size_t>(parent_id_value.AsLong())];
      path.insert(path.end(), parent_path.begin(), parent_path.end());
    }
  }

  if (!it.Status().ok()) {
    PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                            it.Status().message().c_str());
    return {};
  }
  return result;
}

base::Optional<int64_t> GetMaxSymbolId(trace_processor::TraceProcessor* tp) {
  auto max_symbol_id_it =
      tp->ExecuteQuery("select max(id) from stack_profile_symbol");
  if (!max_symbol_id_it.Next()) {
    PERFETTO_DFATAL_OR_ELOG("Failed to get max symbol set id: %s",
                            max_symbol_id_it.Status().message().c_str());
    return base::nullopt;
  }
  auto value = max_symbol_id_it.Get(0);
  if (value.is_null())
    return base::nullopt;
  return base::make_optional(value.AsLong());
}

struct Line {
  int64_t symbol_id;
  uint32_t line_number;
};

std::map<int64_t, std::vector<Line>> GetSymbolSetIdToLines(
    trace_processor::TraceProcessor* tp) {
  std::map<int64_t, std::vector<Line>> result;
  Iterator it = tp->ExecuteQuery(
      "SELECT symbol_set_id, id, line_number FROM stack_profile_symbol;");
  while (it.Next()) {
    int64_t symbol_set_id = it.Get(0).AsLong();
    int64_t id = it.Get(1).AsLong();
    int64_t line_number = it.Get(2).AsLong();
    result[symbol_set_id].emplace_back(
        Line{id, static_cast<uint32_t>(line_number)});
  }

  if (!it.Status().ok()) {
    PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                            it.Status().message().c_str());
    return {};
  }
  return result;
}

base::Optional<int64_t> GetStatsEntry(
    trace_processor::TraceProcessor* tp,
    const std::string& name,
    base::Optional<uint64_t> idx = base::nullopt) {
  std::string query = "select value from stats where name == '" + name + "'";
  if (idx.has_value())
    query += " and idx == " + std::to_string(idx.value());

  auto it = tp->ExecuteQuery(query);
  if (!it.Next()) {
    if (!it.Status().ok()) {
      PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                              it.Status().message().c_str());
      return base::nullopt;
    }
    // some stats are not present unless non-zero
    return base::make_optional(0);
  }
  return base::make_optional(it.Get(0).AsLong());
}

// Helper for constructing |perftools.profiles.Profile| protos.
class GProfileBuilder {
 public:
  GProfileBuilder(
      const std::vector<std::vector<int64_t>>& callsite_to_frames,
      const std::map<int64_t, std::vector<Line>>& symbol_set_id_to_lines,
      int64_t max_symbol_id)
      : callsite_to_frames_(callsite_to_frames),
        symbol_set_id_to_lines_(symbol_set_id_to_lines),
        max_symbol_id_(max_symbol_id) {
    // The pprof format expects the first entry in the string table to be the
    // empty string.
    int64_t empty_id = Intern("");
    PERFETTO_CHECK(empty_id == 0);
  }

  void WriteSampleTypes(
      const std::vector<std::pair<std::string, std::string>>& sample_types) {
    // The interner might eagerly append to the profile proto, prevent it from
    // breaking up other messages by making a separate pass.
    for (const auto& st : sample_types) {
      Intern(st.first);
      Intern(st.second);
    }
    for (const auto& st : sample_types) {
      auto* sample_type = result_->add_sample_type();
      sample_type->set_type(Intern(st.first));
      sample_type->set_unit(Intern(st.second));
    }
  }

  bool AddSample(const protozero::PackedVarInt& values, int64_t callstack_id) {
    const auto& frames = FramesForCallstack(callstack_id);
    if (frames.empty()) {
      PERFETTO_DFATAL_OR_ELOG(
          "Failed to find frames for callstack id %" PRIi64 "", callstack_id);
      return false;
    }
    protozero::PackedVarInt location_ids;
    for (int64_t frame : frames)
      location_ids.Append(ToPprofId(frame));

    auto* gsample = result_->add_sample();
    gsample->set_value(values);
    gsample->set_location_id(location_ids);

    // remember frames to be emitted
    seen_frames_.insert(frames.cbegin(), frames.cend());

    return true;
  }

  std::string CompleteProfile(trace_processor::TraceProcessor* tp) {
    std::set<int64_t> seen_mappings;
    std::set<int64_t> seen_symbol_ids;

    // Write the location info for frames referenced by the added samples.
    if (!WriteFrames(tp, &seen_mappings, &seen_symbol_ids))
      return {};
    if (!WriteMappings(tp, seen_mappings))
      return {};
    if (!WriteSymbols(tp, seen_symbol_ids))
      return {};
    return result_.SerializeAsString();
  }

 private:
  bool WriteMappings(trace_processor::TraceProcessor* tp,
                     const std::set<int64_t>& seen_mappings) {
    Iterator mapping_it = tp->ExecuteQuery(
        "SELECT id, exact_offset, start, end, name "
        "FROM stack_profile_mapping;");
    size_t mappings_no = 0;
    while (mapping_it.Next()) {
      int64_t id = mapping_it.Get(0).AsLong();
      if (seen_mappings.find(id) == seen_mappings.end())
        continue;
      ++mappings_no;
      auto interned_filename = Intern(mapping_it.Get(4).AsString());
      auto* gmapping = result_->add_mapping();
      gmapping->set_id(ToPprofId(id));
      // Do not set the build_id here to avoid downstream services
      // trying to symbolize (e.g. b/141735056)
      gmapping->set_file_offset(
          static_cast<uint64_t>(mapping_it.Get(1).AsLong()));
      gmapping->set_memory_start(
          static_cast<uint64_t>(mapping_it.Get(2).AsLong()));
      gmapping->set_memory_limit(
          static_cast<uint64_t>(mapping_it.Get(3).AsLong()));
      gmapping->set_filename(interned_filename);
    }
    if (!mapping_it.Status().ok()) {
      PERFETTO_DFATAL_OR_ELOG("Invalid mapping iterator: %s",
                              mapping_it.Status().message().c_str());
      return false;
    }
    if (mappings_no != seen_mappings.size()) {
      PERFETTO_DFATAL_OR_ELOG("Missing mappings.");
      return false;
    }
    return true;
  }

  bool WriteSymbols(trace_processor::TraceProcessor* tp,
                    const std::set<int64_t>& seen_symbol_ids) {
    Iterator symbol_it = tp->ExecuteQuery(
        "SELECT id, name, source_file FROM stack_profile_symbol");
    size_t symbols_no = 0;
    while (symbol_it.Next()) {
      int64_t id = symbol_it.Get(0).AsLong();
      if (seen_symbol_ids.find(id) == seen_symbol_ids.end())
        continue;
      ++symbols_no;
      const std::string& name = symbol_it.Get(1).AsString();
      std::string demangled_name = name;
      MaybeDemangle(&demangled_name);

      auto interned_demangled_name = Intern(demangled_name);
      auto interned_system_name = Intern(name);
      auto interned_filename = Intern(symbol_it.Get(2).AsString());
      auto* gfunction = result_->add_function();
      gfunction->set_id(ToPprofId(id));
      gfunction->set_name(interned_demangled_name);
      gfunction->set_system_name(interned_system_name);
      gfunction->set_filename(interned_filename);
    }

    if (!symbol_it.Status().ok()) {
      PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                              symbol_it.Status().message().c_str());
      return false;
    }

    if (symbols_no != seen_symbol_ids.size()) {
      PERFETTO_DFATAL_OR_ELOG("Missing symbols.");
      return false;
    }
    return true;
  }

  bool WriteFrames(trace_processor::TraceProcessor* tp,
                   std::set<int64_t>* seen_mappings,
                   std::set<int64_t>* seen_symbol_ids) {
    Iterator frame_it = tp->ExecuteQuery(
        "SELECT spf.id, IFNULL(spf.deobfuscated_name, spf.name), spf.mapping, "
        "spf.rel_pc, spf.symbol_set_id "
        "FROM stack_profile_frame spf;");
    size_t frames_no = 0;
    while (frame_it.Next()) {
      int64_t frame_id = frame_it.Get(0).AsLong();
      if (seen_frames_.find(frame_id) == seen_frames_.end())
        continue;
      frames_no++;
      std::string frame_name = frame_it.Get(1).AsString();
      int64_t mapping_id = frame_it.Get(2).AsLong();
      int64_t rel_pc = frame_it.Get(3).AsLong();
      base::Optional<int64_t> symbol_set_id;
      if (!frame_it.Get(4).is_null())
        symbol_set_id = frame_it.Get(4).AsLong();

      seen_mappings->emplace(mapping_id);
      auto* glocation = result_->add_location();
      glocation->set_id(ToPprofId(frame_id));
      glocation->set_mapping_id(ToPprofId(mapping_id));
      // TODO(fmayer): Convert to abspc.
      // relpc + (mapping.start - (mapping.exact_offset -
      //                           mapping.start_offset)).
      glocation->set_address(static_cast<uint64_t>(rel_pc));
      if (symbol_set_id) {
        for (const Line& line : LineForSymbolSetId(*symbol_set_id)) {
          seen_symbol_ids->emplace(line.symbol_id);
          auto* gline = glocation->add_line();
          gline->set_line(line.line_number);
          gline->set_function_id(ToPprofId(line.symbol_id));
        }
      } else {
        int64_t synthesized_symbol_id = ++max_symbol_id_;
        std::string demangled_name = frame_name;
        MaybeDemangle(&demangled_name);

        auto* gline = glocation->add_line();
        gline->set_line(0);
        gline->set_function_id(ToPprofId(synthesized_symbol_id));

        auto interned_demangled_name = Intern(demangled_name);
        auto interned_system_name = Intern(frame_name);
        auto* gfunction = result_->add_function();
        gfunction->set_id(ToPprofId(synthesized_symbol_id));
        gfunction->set_name(interned_demangled_name);
        gfunction->set_system_name(interned_system_name);
      }
    }

    if (!frame_it.Status().ok()) {
      PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                              frame_it.Status().message().c_str());
      return false;
    }
    if (frames_no != seen_frames_.size()) {
      PERFETTO_DFATAL_OR_ELOG("Missing frames.");
      return false;
    }
    return true;
  }

  const std::vector<int64_t>& FramesForCallstack(int64_t callstack_id) {
    size_t callsite_idx = static_cast<size_t>(callstack_id);
    PERFETTO_CHECK(callstack_id >= 0 &&
                   callsite_idx < callsite_to_frames_.size());
    return callsite_to_frames_[callsite_idx];
  }

  const std::vector<Line>& LineForSymbolSetId(int64_t symbol_set_id) {
    auto it = symbol_set_id_to_lines_.find(symbol_set_id);
    if (it == symbol_set_id_to_lines_.end())
      return empty_line_vector_;
    return it->second;
  }

  int64_t Intern(const std::string& s) {
    auto it = string_table_.find(s);
    if (it == string_table_.end()) {
      std::tie(it, std::ignore) =
          string_table_.emplace(s, string_table_.size());
      result_->add_string_table(s);
    }
    return it->second;
  }

  protozero::HeapBuffered<third_party::perftools::profiles::pbzero::Profile>
      result_;
  std::map<std::string, int64_t> string_table_;
  const std::vector<std::vector<int64_t>>& callsite_to_frames_;
  const std::map<int64_t, std::vector<Line>>& symbol_set_id_to_lines_;
  const std::vector<Line> empty_line_vector_;
  int64_t max_symbol_id_;

  std::set<int64_t> seen_frames_;
};

}  // namespace

namespace heap_profile {
struct View {
  const char* type;
  const char* unit;
  const char* aggregator;
  const char* filter;
};
const View kSpaceView{"space", "bytes", "SUM(size)", nullptr};
const View kAllocSpaceView{"alloc_space", "bytes", "SUM(size)", "size >= 0"};
const View kAllocObjectsView{"alloc_objects", "count", "sum(count)",
                             "size >= 0"};
const View kObjectsView{"objects", "count", "SUM(count)", nullptr};

const View kViews[] = {kAllocObjectsView, kObjectsView, kAllocSpaceView,
                       kSpaceView};

static bool VerifyPIDStats(trace_processor::TraceProcessor* tp, uint64_t pid) {
  bool success = true;
  base::Optional<int64_t> stat =
      GetStatsEntry(tp, "heapprofd_buffer_corrupted", base::make_optional(pid));
  if (!stat.has_value()) {
    PERFETTO_DFATAL_OR_ELOG("Failed to get heapprofd_buffer_corrupted stat");
  } else if (stat.value() > 0) {
    success = false;
    PERFETTO_ELOG("WARNING: The profile for %" PRIu64
                  " ended early due to a buffer corruption."
                  " THIS IS ALWAYS A BUG IN HEAPPROFD OR"
                  " CLIENT MEMORY CORRUPTION.",
                  pid);
  }
  stat =
      GetStatsEntry(tp, "heapprofd_buffer_overran", base::make_optional(pid));
  if (!stat.has_value()) {
    PERFETTO_DFATAL_OR_ELOG("Failed to get heapprofd_buffer_overran stat");
  } else if (stat.value() > 0) {
    success = false;
    PERFETTO_ELOG("WARNING: The profile for %" PRIu64
                  " ended early due to a buffer overrun.",
                  pid);
  }

  stat = GetStatsEntry(tp, "heapprofd_rejected_concurrent", pid);
  if (!stat.has_value()) {
    PERFETTO_DFATAL_OR_ELOG("Failed to get heapprofd_rejected_concurrent stat");
  } else if (stat.value() > 0) {
    success = false;
    PERFETTO_ELOG("WARNING: The profile for %" PRIu64
                  " was rejected due to a concurrent profile.",
                  pid);
  }
  return success;
}

static std::vector<Iterator> BuildViewIterators(
    trace_processor::TraceProcessor* tp,
    uint64_t upid,
    uint64_t ts,
    const char* heap_name) {
  std::vector<Iterator> view_its;
  for (size_t i = 0; i < base::ArraySize(kViews); ++i) {
    const View& v = kViews[i];
    std::string query = "SELECT hpa.callsite_id ";
    query +=
        ", " + std::string(v.aggregator) + " FROM heap_profile_allocation hpa ";
    // TODO(fmayer): Figure out where negative callsite_id comes from.
    query += "WHERE hpa.callsite_id >= 0 ";
    query += "AND hpa.upid = " + std::to_string(upid) + " ";
    query += "AND hpa.ts <= " + std::to_string(ts) + " ";
    query += "AND hpa.heap_name = '" + std::string(heap_name) + "' ";
    if (v.filter)
      query += "AND " + std::string(v.filter) + " ";
    query += "GROUP BY hpa.callsite_id;";
    view_its.emplace_back(tp->ExecuteQuery(query));
  }
  return view_its;
}

static bool WriteAllocations(GProfileBuilder* builder,
                             std::vector<Iterator>* view_its) {
  for (;;) {
    bool all_next = true;
    bool any_next = false;
    for (size_t i = 0; i < base::ArraySize(kViews); ++i) {
      Iterator& it = (*view_its)[i];
      bool next = it.Next();
      if (!it.Status().ok()) {
        PERFETTO_DFATAL_OR_ELOG("Invalid view iterator: %s",
                                it.Status().message().c_str());
        return false;
      }
      all_next = all_next && next;
      any_next = any_next || next;
    }

    if (!all_next) {
      PERFETTO_CHECK(!any_next);
      break;
    }

    protozero::PackedVarInt sample_values;
    int64_t callstack_id = -1;
    for (size_t i = 0; i < base::ArraySize(kViews); ++i) {
      if (i == 0) {
        callstack_id = (*view_its)[i].Get(0).AsLong();
      } else if (callstack_id != (*view_its)[i].Get(0).AsLong()) {
        PERFETTO_DFATAL_OR_ELOG("Wrong callstack.");
        return false;
      }
      sample_values.Append((*view_its)[i].Get(1).AsLong());
    }

    if (!builder->AddSample(sample_values, callstack_id))
      return false;
  }
  return true;
}

static bool TraceToHeapPprof(trace_processor::TraceProcessor* tp,
                             std::vector<SerializedProfile>* output,
                             uint64_t target_pid,
                             const std::vector<uint64_t>& target_timestamps) {
  const auto callsite_to_frames = GetCallsiteToFrames(tp);
  const auto symbol_set_id_to_lines = GetSymbolSetIdToLines(tp);
  base::Optional<int64_t> max_symbol_id = GetMaxSymbolId(tp);
  if (!max_symbol_id.has_value())
    return false;

  bool any_fail = false;
  Iterator it = tp->ExecuteQuery(
      "select distinct hpa.upid, hpa.ts, p.pid, hpa.heap_name "
      "from heap_profile_allocation hpa, "
      "process p where p.upid = hpa.upid;");
  while (it.Next()) {
    GProfileBuilder builder(callsite_to_frames, symbol_set_id_to_lines,
                            max_symbol_id.value());
    uint64_t upid = static_cast<uint64_t>(it.Get(0).AsLong());
    uint64_t ts = static_cast<uint64_t>(it.Get(1).AsLong());
    uint64_t profile_pid = static_cast<uint64_t>(it.Get(2).AsLong());
    const char* heap_name = it.Get(3).AsString();
    if ((target_pid > 0 && profile_pid != target_pid) ||
        (!target_timestamps.empty() &&
         std::find(target_timestamps.begin(), target_timestamps.end(), ts) ==
             target_timestamps.end())) {
      continue;
    }

    if (!VerifyPIDStats(tp, profile_pid))
      any_fail = true;

    std::vector<std::pair<std::string, std::string>> sample_types;
    for (size_t i = 0; i < base::ArraySize(kViews); ++i) {
      sample_types.emplace_back(std::string(kViews[i].type),
                                std::string(kViews[i].unit));
    }
    builder.WriteSampleTypes(sample_types);

    std::vector<Iterator> view_its =
        BuildViewIterators(tp, upid, ts, heap_name);
    std::string profile_proto;
    if (WriteAllocations(&builder, &view_its)) {
      profile_proto = builder.CompleteProfile(tp);
    }
    output->emplace_back(
        SerializedProfile{ProfileType::kHeapProfile, profile_pid,
                          std::move(profile_proto), heap_name});
  }

  if (!it.Status().ok()) {
    PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                            it.Status().message().c_str());
    return false;
  }
  if (any_fail) {
    PERFETTO_ELOG(
        "One or more of your profiles had an issue. Please consult "
        "https://perfetto.dev/docs/data-sources/"
        "native-heap-profiler#troubleshooting");
  }
  return true;
}
}  // namespace heap_profile

namespace perf_profile {
struct ProcessInfo {
  uint64_t pid;
  std::vector<uint64_t> utids;
};

// Returns a map of upid -> {pid, utids[]} for sampled processes.
static std::map<uint64_t, ProcessInfo> GetProcessMap(
    trace_processor::TraceProcessor* tp) {
  Iterator it = tp->ExecuteQuery(
      "select distinct process.upid, process.pid, thread.utid from perf_sample "
      "join thread using (utid) join process using (upid) where callsite_id is "
      "not null order by process.upid asc");
  std::map<uint64_t, ProcessInfo> process_map;
  while (it.Next()) {
    uint64_t upid = static_cast<uint64_t>(it.Get(0).AsLong());
    uint64_t pid = static_cast<uint64_t>(it.Get(1).AsLong());
    uint64_t utid = static_cast<uint64_t>(it.Get(2).AsLong());
    process_map[upid].pid = pid;
    process_map[upid].utids.push_back(utid);
  }
  if (!it.Status().ok()) {
    PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                            it.Status().message().c_str());
    return {};
  }
  return process_map;
}

static void LogTracePerfEventIssues(trace_processor::TraceProcessor* tp) {
  base::Optional<int64_t> stat = GetStatsEntry(tp, "perf_samples_skipped");
  if (!stat.has_value()) {
    PERFETTO_DFATAL_OR_ELOG("Failed to look up perf_samples_skipped stat");
  } else if (stat.value() > 0) {
    PERFETTO_ELOG(
        "Warning: the trace recorded %" PRIi64
        " skipped samples, which otherwise matched the tracing config. This "
        "would cause a process to be completely absent from the trace, but "
        "does *not* imply data loss in any of the output profiles.",
        stat.value());
  }

  stat = GetStatsEntry(tp, "perf_samples_skipped_dataloss");
  if (!stat.has_value()) {
    PERFETTO_DFATAL_OR_ELOG(
        "Failed to look up perf_samples_skipped_dataloss stat");
  } else if (stat.value() > 0) {
    PERFETTO_ELOG("DATA LOSS: the trace recorded %" PRIi64
                  " lost perf samples (within traced_perf). This means that "
                  "the trace is missing information, but it is not known "
                  "which profile that affected.",
                  stat.value());
  }

  // Check if any per-cpu ringbuffers encountered dataloss (as recorded by the
  // kernel).
  Iterator it = tp->ExecuteQuery(
      "select idx, value from stats where name == 'perf_cpu_lost_records' and "
      "value > 0 order by idx asc");
  while (it.Next()) {
    PERFETTO_ELOG(
        "DATA LOSS: during the trace, the per-cpu kernel ring buffer for cpu "
        "%" PRIi64 " recorded %" PRIi64
        " lost samples. This means that the trace is missing information, "
        "but it is not known which profile that affected.",
        static_cast<int64_t>(it.Get(0).AsLong()),
        static_cast<int64_t>(it.Get(1).AsLong()));
  }
  if (!it.Status().ok()) {
    PERFETTO_DFATAL_OR_ELOG("Invalid iterator: %s",
                            it.Status().message().c_str());
  }
}

// TODO(rsavitski): decide whether errors in |AddSample| should result in an
// empty profile (and/or whether they should make the overall conversion
// unsuccessful). Furthermore, clarify the return value's semantics for both
// perf and heap profiles.
static bool TraceToPerfPprof(trace_processor::TraceProcessor* tp,
                             std::vector<SerializedProfile>* output,
                             uint64_t target_pid) {
  const auto callsite_to_frames = GetCallsiteToFrames(tp);
  const auto symbol_set_id_to_lines = GetSymbolSetIdToLines(tp);
  base::Optional<int64_t> max_symbol_id = GetMaxSymbolId(tp);
  if (!max_symbol_id.has_value())
    return false;

  LogTracePerfEventIssues(tp);

  // Aggregate samples by upid when building profiles.
  std::map<uint64_t, ProcessInfo> process_map = GetProcessMap(tp);
  for (const auto& p : process_map) {
    const ProcessInfo& process = p.second;

    if (target_pid != 0 && process.pid != target_pid)
      continue;

    GProfileBuilder builder(callsite_to_frames, symbol_set_id_to_lines,
                            max_symbol_id.value());

    builder.WriteSampleTypes({{"samples", "count"}});

    std::string query = "select callsite_id from perf_sample where utid in (" +
                        AsCsvString(process.utids) +
                        ") and callsite_id is not null order by ts asc;";

    protozero::PackedVarInt single_count_value;
    single_count_value.Append(1);

    Iterator it = tp->ExecuteQuery(query);
    while (it.Next()) {
      int64_t callsite_id = static_cast<int64_t>(it.Get(0).AsLong());
      builder.AddSample(single_count_value, callsite_id);
    }
    if (!it.Status().ok()) {
      PERFETTO_DFATAL_OR_ELOG("Failed to iterate over samples: %s",
                              it.Status().c_message());
      return false;
    }

    std::string profile_proto = builder.CompleteProfile(tp);
    output->emplace_back(SerializedProfile{
        ProfileType::kPerfProfile, process.pid, std::move(profile_proto), ""});
  }
  return true;
}
}  // namespace perf_profile

bool TraceToPprof(trace_processor::TraceProcessor* tp,
                  std::vector<SerializedProfile>* output,
                  ConversionMode mode,
                  uint64_t pid,
                  const std::vector<uint64_t>& timestamps) {
  switch (mode) {
    case (ConversionMode::kHeapProfile):
      return heap_profile::TraceToHeapPprof(tp, output, pid, timestamps);
    case (ConversionMode::kPerfProfile):
      return perf_profile::TraceToPerfPprof(tp, output, pid);
  }
  PERFETTO_FATAL("unknown conversion option");  // for gcc
}

}  // namespace trace_to_text
}  // namespace perfetto
