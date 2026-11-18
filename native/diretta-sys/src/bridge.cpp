#include <Diretta/Find>
#include <Diretta/Format>
#include <Diretta/Sync>

#if __has_include(<acqua/UDPV6.hpp>)
#include <acqua/Clock.hpp>
#include <acqua/UDPV6.hpp>
#define ATOM_DIRETTA_PACKET_REFERENCES
#else
#include <ACQUA/Clock>
#endif

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <utility>

namespace {

constexpr std::size_t kTextCapacity = 256;
thread_local std::string g_last_error;

using AtomDirettaNextBlock = bool (*)(void*, const std::uint8_t**, std::size_t*, const void**);
using AtomDirettaReleaseBlock = void (*)(void*);
using AtomDirettaChangeBlockRef = void (*)(const void*, bool);

void set_error(std::string message) {
  g_last_error = std::move(message);
}

void clear_error() {
  g_last_error.clear();
}

template <std::size_t N>
void copy_text(char (&dst)[N], const std::string& value) {
  static_assert(N > 0);
  const std::size_t count = std::min(value.size(), N - 1);
  std::memcpy(dst, value.data(), count);
  dst[count] = '\0';
}

struct SourceBlock {
  const std::uint8_t* data = nullptr;
  std::size_t size = 0;
  const void* token = nullptr;

  bool contains(const void* p, std::size_t len) const {
    auto offset = reinterpret_cast<std::uintptr_t>(p) - reinterpret_cast<std::uintptr_t>(data);
    return token != nullptr && offset < size && len <= size - offset;
  }
};

class DirectSource {
 public:
  DirectSource(
    void* context,
    AtomDirettaNextBlock next,
    AtomDirettaReleaseBlock release,
    AtomDirettaChangeBlockRef change_ref)
      : context_(context), next_(next), release_(release), change_ref_(change_ref) {}

  ~DirectSource() {
    drop(previous_);
    drop(current_);
  }

  void play() { playing_.store(true); }

  void pause() {
    playing_.store(false);
    // SDK stop 仅设暂停标志，重置解码状态前还需等取块回调退出。
    while (pulling_.load()) {
      std::this_thread::yield();
    }
    release_(context_);
  }

  bool pull(diretta_stream& stream) {
    pulling_.store(true);
    if (!playing_.load()) {
      pulling_.store(false);
      stream.Data.P = nullptr;
      stream.Size = 0;
      return true;
    }

    // 跨块组包会借用上一个块。再请求第三块前，Blue 已经把前两段复制到包里。
    drop(previous_);
    previous_ = std::exchange(current_, {});
    const bool available = next_(context_, &current_.data, &current_.size, &current_.token);
    stream.Data.P = const_cast<std::uint8_t*>(current_.data);
    stream.Size = current_.size;
    pulling_.store(false);
    return available;
  }

  const void* retain(const void* data, std::size_t size) const {
    const void* token = current_.contains(data, size) ? current_.token
      : previous_.contains(data, size) ? previous_.token : nullptr;
    if (token != nullptr) change_ref_(token, true);
    return token;
  }

  void release(const void* token) const {
    if (token != nullptr) change_ref_(token, false);
  }

 private:
  void drop(SourceBlock& block) { release(std::exchange(block, {}).token); }

  void* context_;
  AtomDirettaNextBlock next_;
  AtomDirettaReleaseBlock release_;
  AtomDirettaChangeBlockRef change_ref_;
  std::atomic_bool playing_{false};
  std::atomic_bool pulling_{false};
  SourceBlock previous_;
  SourceBlock current_;
};

#ifdef ATOM_DIRETTA_PACKET_REFERENCES
class DirectPacketBuffer final : public ACQUA::UDPV6EBuffer {
 public:
  DirectPacketBuffer(std::uint8_t* data, std::int32_t size, const DirectSource& source)
      : UDPV6EBuffer(data, size), source_(source) {}

  ~DirectPacketBuffer() override { release_payload(); }

  bool alloc(std::int32_t size, std::int32_t offset) override {
    release_payload();
    return UDPV6EBuffer::alloc(size, offset);
  }

  void calculate() override {
    UDPV6EBuffer::calculate();
    if (m_iovCnt == 0 || m_iovCnt > std::size(m_iov) || tokens_[0] != nullptr) return;
    // 重传也会更新包头。只有新装入的 iovec 才需要取得引用。
    std::size_t count = 0;
    for (std::size_t i = 0; i < m_iovCnt && count < tokens_.size(); ++i) {
      if (const void* token = source_.retain(m_iov[i].base, m_iov[i].len)) {
        tokens_[count++] = token;
      }
    }
  }

 private:
  void release_payload() {
    for (auto& token : tokens_) source_.release(std::exchange(token, nullptr));
  }

  const DirectSource& source_;
  std::array<const void*, 2> tokens_{};
};

class DirectSocket final : public ACQUA::UDPV6 {
 public:
  explicit DirectSocket(const DirectSource& source) : source_(source) {}

  ACQUA::EthernetBuffer* alloc(std::uint8_t* data, std::int32_t size, bool) override {
    return new DirectPacketBuffer(data, size, source_);
  }

 private:
  const DirectSource& source_;
};
#endif

class DirectSync final : public DIRETTA::Sync {
 public:
#ifdef ATOM_DIRETTA_PACKET_REFERENCES
  DirectSync(DirectSource& source, DirectSocket& udp, DirectSocket& raw)
      : Sync(udp, &raw), source_(source) {
    setZeroCopy(true);
  }
#else
  explicit DirectSync(DirectSource& source) : source_(source) {
    disableUntrackedZeroCopy(*this);
  }

 private:
  static void disableUntrackedZeroCopy(auto& sync) {
    if constexpr (requires { sync.setZeroCopy(false); }) {
      sync.setZeroCopy(false);
    }
  }
#endif

 protected:
  bool getNewStream(diretta_stream& stream) override { return source_.pull(stream); }

 private:
  DirectSource& source_;
};

struct DirettaConnection {
  DirettaConnection(
    void* source_context,
    AtomDirettaNextBlock next_block,
    AtomDirettaReleaseBlock release_block,
    AtomDirettaChangeBlockRef change_ref)
      : source(source_context, next_block, release_block, change_ref) {}

  DirectSource source;
#ifdef ATOM_DIRETTA_PACKET_REFERENCES
  DirectSocket udp{source};
  DirectSocket raw{source};
#endif
  std::unique_ptr<DIRETTA::Find> find;
  std::unique_ptr<DirectSync> sync;
  DIRETTA::FormatConfigure format;

  ~DirettaConnection() {
    shutdown();
  }

  void shutdown() noexcept {
    if (!sync) return;
    try {
      sync->stop();
      source.pause();
      if (sync->is_connect()) {
        sync->disconnect_flgset();
        sync->disconnect(true);
        sync->disconnectWait();
      }
    } catch (...) {
      // SDK cleanup must never cross the C ABI/destructor boundary.
    }
    try {
      sync->close();
    } catch (...) {
    }
  }
};

bool discover(DIRETTA::Find& find, DIRETTA::Find::PortResalts& results) {
  if (!find.open()) {
    set_error("failed to open Diretta discovery socket");
    return false;
  }
  if (!find.findOutput(results)) {
    set_error("Diretta target discovery failed");
    return false;
  }
  return true;
}

DIRETTA::FormatID pcm_format(std::uint8_t storage_bits) {
  switch (storage_bits) {
    case 16:
      return DIRETTA::FormatID::FMT_PCM_SIGNED_16;
    case 32:
      return DIRETTA::FormatID::FMT_PCM_SIGNED_32;
    default:
      return DIRETTA::FormatID::NONE;
  }
}

void* open_direct_with_format(
  const char* target_id,
  std::uint32_t sample_rate,
  std::uint16_t channels,
  DIRETTA::FormatID format_id,
  DIRETTA::FormatID alternate_format_id,
  void* source_context,
  AtomDirettaNextBlock next_block,
  AtomDirettaReleaseBlock release_block,
  AtomDirettaChangeBlockRef change_ref,
  const char* format_name,
  bool* used_alternate_format) {
  try {
    auto connection = std::make_unique<DirettaConnection>(
      source_context, next_block, release_block, change_ref);

    DIRETTA::Find::Setting setting;
    setting.Loopback = false;
    setting.ProductID = 0;
    connection->find = std::make_unique<DIRETTA::Find>(setting);

    DIRETTA::Find::PortResalts results;
    if (!discover(*connection->find, results) || results.empty()) {
      if (g_last_error.empty()) set_error("no Diretta targets found");
      return nullptr;
    }

    ACQUA::IPAddress target;
    for (const auto& [address, _info] : results) {
      if (address.get_full_str() == target_id) {
        target = address;
        break;
      }
    }
    if (target.is_empty()) {
      set_error("requested Diretta target was not found");
      return nullptr;
    }

    std::uint32_t mtu = 0;
    if (!connection->find->measSendMTU(target, mtu) || mtu == 0) {
      mtu = 1500;
    }

#ifdef ATOM_DIRETTA_PACKET_REFERENCES
    ACQUA::IPAddress bind_address;
    connection->udp.setRecvTargetSize(0x1000);
    if (!connection->udp.open() || !connection->udp.bind(bind_address)) {
      set_error("failed to open Diretta stream socket");
      return nullptr;
    }
    connection->raw.raw_open();
    connection->sync = std::make_unique<DirectSync>(
      connection->source, connection->udp, connection->raw);
#else
    connection->sync = std::make_unique<DirectSync>(connection->source);
#endif
    // 保留发送线程优先级，使用 SDK 默认等待策略，避免忙等持续占核。
    const auto thread_mode = DIRETTA::Sync::CRITICAL;
    const auto ifno = static_cast<std::uint16_t>(target.get_ifno());
    if (!connection->sync->open(
          thread_mode,
          ACQUA::Clock::MilliSeconds(100),
          ifno,
          "SPlayer Atom",
          0,
          0,
          0,
          0,
          DIRETTA::Sync::MSMODE_AUTO)) {
      set_error("failed to open Diretta Source Direct sync");
      return nullptr;
    }

    if (!connection->sync->setSink(target, ACQUA::Clock::MilliSeconds(100), true, mtu)) {
      set_error("failed to configure Diretta sink");
      return nullptr;
    }

    DIRETTA::FormatConfigure format;
    if (!format.setSpeed(sample_rate) || !format.setChannel(channels)) {
      set_error(std::string("Diretta SDK rejected exact Source Direct ") + format_name + " rate/channels");
      return nullptr;
    }
    if (used_alternate_format != nullptr) {
      *used_alternate_format = false;
    }
    bool supported = format.setFormat(format_id) && connection->sync->checkSinkSupport(format);
    if (!supported && alternate_format_id != DIRETTA::FormatID::NONE) {
      supported = format.setFormat(alternate_format_id) && connection->sync->checkSinkSupport(format);
      if (supported && used_alternate_format != nullptr) {
        *used_alternate_format = true;
      }
    }
    if (!supported) {
      set_error(std::string("Diretta target does not support Source Direct ") + format_name + " format");
      return nullptr;
    }
    if (!connection->sync->setSinkConfigure(format)) {
      set_error("failed to apply exact Diretta Source Direct format");
      return nullptr;
    }

    connection->sync->configTransferAuto(
      ACQUA::Clock::MicroSeconds(200),
      ACQUA::Clock(),
      ACQUA::Clock::MicroSeconds(100000));

    if (!connection->sync->connectPrepare()) {
      set_error("failed to prepare Diretta Source Direct connection");
      return nullptr;
    }
    if (!connection->sync->connect(0)) {
      set_error("failed to start Diretta Source Direct connection");
      return nullptr;
    }
    if (!connection->sync->connectWait()) {
      set_error("failed to complete Diretta Source Direct connection");
      return nullptr;
    }

    connection->format = connection->sync->getSinkConfigure();
    return connection.release();
  } catch (const std::exception& error) {
    set_error(error.what());
  } catch (...) {
    set_error("unknown exception while opening Diretta Source Direct target");
  }
  return nullptr;
}

} // namespace

extern "C" {

struct AtomDirettaDevice {
  char id[kTextCapacity];
  char name[kTextCapacity];
};

const char* atom_diretta_last_error() {
  return g_last_error.c_str();
}

std::size_t atom_diretta_scan(AtomDirettaDevice* devices, std::size_t capacity) {
  clear_error();
  try {
    DIRETTA::Find::Setting setting;
    setting.Loopback = false;
    setting.ProductID = 0;
    DIRETTA::Find find(setting);
    DIRETTA::Find::PortResalts results;
    if (!discover(find, results)) return 0;

    const std::size_t count = std::min(capacity, results.size());
    std::size_t index = 0;
    for (const auto& [address, info] : results) {
      if (index >= count) break;
      const std::string id = address.get_full_str();
      const std::string label = !info.outputName.empty()
        ? info.outputName
        : (!info.targetName.empty() ? info.targetName : "Diretta Target");
      if (devices != nullptr) {
        copy_text(devices[index].id, id);
        copy_text(devices[index].name, label);
      }
      ++index;
    }
    return results.size();
  } catch (const std::exception& error) {
    set_error(error.what());
  } catch (...) {
    set_error("unknown exception during Diretta discovery");
  }
  return 0;
}

void* atom_diretta_open_direct(
  const char* target_id,
  std::uint32_t sample_rate,
  std::uint16_t channels,
  std::uint8_t storage_bits,
  std::uint8_t* wire_storage_bits,
  void* source_context,
  AtomDirettaNextBlock next_block,
  AtomDirettaReleaseBlock release_block,
  AtomDirettaChangeBlockRef change_ref) {
  clear_error();
  if (target_id == nullptr || *target_id == '\0') {
    set_error("Diretta target id is required");
    return nullptr;
  }
  if (sample_rate == 0 || channels == 0 || wire_storage_bits == nullptr || source_context == nullptr ||
      next_block == nullptr || release_block == nullptr || change_ref == nullptr) {
    set_error("invalid Diretta Source Direct configuration");
    return nullptr;
  }
  const auto format_id = pcm_format(storage_bits);
  if (format_id == DIRETTA::FormatID::NONE) {
    set_error("Diretta Source Direct supports only packed PCM16/PCM32 storage");
    return nullptr;
  }

  const auto alternate = storage_bits == 16
    ? DIRETTA::FormatID::FMT_PCM_SIGNED_32 : DIRETTA::FormatID::NONE;
  bool widened = false;
  auto* connection = open_direct_with_format(
    target_id,
    sample_rate,
    channels,
    format_id,
    alternate,
    source_context,
    next_block,
    release_block,
    change_ref,
    "PCM",
    &widened);
  if (connection != nullptr) {
    *wire_storage_bits = widened ? 32 : storage_bits;
  }
  return connection;
}

void* atom_diretta_open_dsd_direct(
  const char* target_id,
  std::uint32_t bit_rate,
  std::uint16_t channels,
  bool source_lsb_first,
  bool* wire_lsb_first,
  void* source_context,
  AtomDirettaNextBlock next_block,
  AtomDirettaReleaseBlock release_block,
  AtomDirettaChangeBlockRef change_ref) {
  clear_error();
  if (target_id == nullptr || *target_id == '\0') {
    set_error("Diretta target id is required");
    return nullptr;
  }
  if (bit_rate == 0 || channels == 0 || wire_lsb_first == nullptr ||
      source_context == nullptr || next_block == nullptr || release_block == nullptr || change_ref == nullptr) {
    set_error("invalid Diretta Native DSD configuration");
    return nullptr;
  }

  const auto base_format_id = DIRETTA::FormatID::FMT_DSD1 |
                              DIRETTA::FormatID::FMT_DSD_SIZ_32 |
                              DIRETTA::FormatID::FMT_DSD_BIG;
  const auto source_format_id = base_format_id |
    (source_lsb_first ? DIRETTA::FormatID::FMT_DSD_LSB : DIRETTA::FormatID::FMT_DSD_MSB);
  const auto alternate_format_id = base_format_id |
    (source_lsb_first ? DIRETTA::FormatID::FMT_DSD_MSB : DIRETTA::FormatID::FMT_DSD_LSB);
  bool used_alternate_format = false;
  auto* connection = open_direct_with_format(
    target_id,
    bit_rate,
    channels,
    source_format_id,
    alternate_format_id,
    source_context,
    next_block,
    release_block,
    change_ref,
    "Native DSD",
    &used_alternate_format);
  if (connection != nullptr) {
    *wire_lsb_first = used_alternate_format ? !source_lsb_first : source_lsb_first;
  }
  return connection;
}

bool atom_diretta_play(void* opaque) {
  clear_error();
  auto* connection = static_cast<DirettaConnection*>(opaque);
  if (connection == nullptr || !connection->sync) {
    set_error("invalid Diretta connection");
    return false;
  }
  try {
    connection->source.play();
    connection->sync->play();
    return true;
  } catch (const std::exception& error) {
    set_error(error.what());
  } catch (...) {
    set_error("unknown exception while starting Diretta playback");
  }
  return false;
}

bool atom_diretta_pause(void* opaque) {
  clear_error();
  auto* connection = static_cast<DirettaConnection*>(opaque);
  if (connection == nullptr || !connection->sync) {
    set_error("invalid Diretta connection");
    return false;
  }
  try {
    connection->sync->stop();
    connection->source.pause();
    return true;
  } catch (const std::exception& error) {
    set_error(error.what());
  } catch (...) {
    set_error("unknown exception while pausing Diretta playback");
  }
  return false;
}

void atom_diretta_close(void* opaque) {
  clear_error();
  auto connection = std::unique_ptr<DirettaConnection>(static_cast<DirettaConnection*>(opaque));
}

} // extern "C"
